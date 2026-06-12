use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use nix::sys::signal::{kill, Signal};
use nix::unistd::Pid;
use portable_pty::PtySize;
use tauri::async_runtime::{channel, spawn, spawn_blocking, Mutex, Receiver, RwLock, Sender};
use tokio::time::timeout;

use crate::session::cell_frame::CellFrame;
use crate::session::error::SessionError;
use crate::session::handle::{SessionHandle, SessionTasks};
use crate::session::id::SessionId;
use crate::session::key::KeyStroke;
use crate::session::pty::{self, PtySession};
use crate::session::sink::OutputSink;
use mizraj_term::MouseInput;

const SHUTDOWN_GRACE: Duration = Duration::from_secs(2);

/// How long a frame pull may wait for the render thread before reporting the
/// session frameless. The snapshot itself is microseconds; the budget covers a
/// render thread busy waiting out a pacing window.
const FRAME_REQUEST_TIMEOUT: Duration = Duration::from_millis(500);

const INPUT_CHANNEL_CAPACITY: usize = 64;
const PTY_READ_BUFFER_SIZE: usize = 4096;

/// Snapshot the sink registry (Arc clones, then the read lock is released),
/// then invoke `call` on each sink *outside* the lock. Per `OutputSink`'s
/// contract a sink call is supposed to be ~1ms, but holding the registry's
/// RwLock across user-supplied code is still a deadlock hazard the dossier
/// explicitly flags — so the snapshot/dispatch discipline lives here, once.
async fn dispatch_to_sinks(
    sinks: &Arc<RwLock<Vec<Arc<dyn OutputSink>>>>,
    call: impl Fn(&Arc<dyn OutputSink>),
) {
    let snapshot: Vec<Arc<dyn OutputSink>> = {
        let guard = sinks.read().await;
        guard.iter().cloned().collect()
    };
    for sink in &snapshot {
        call(sink);
    }
}

/// Drain `reader` in 4KB chunks until EOF, fanning each chunk out to every
/// sink currently registered in `sinks` (D4 mechanism (a)).
async fn pty_read_loop(
    mut reader: Box<dyn Read + Send>,
    sinks: Arc<RwLock<Vec<Arc<dyn OutputSink>>>>,
) {
    let mut buf = vec![0u8; PTY_READ_BUFFER_SIZE];
    loop {
        let join = spawn_blocking(move || {
            let mut buf = buf;
            let result = reader.read(&mut buf);
            (reader, buf, result)
        })
        .await;
        let Ok((returned_reader, returned_buf, read_result)) = join else {
            return;
        };
        reader = returned_reader;
        buf = returned_buf;
        let n = match read_result {
            Ok(0) => return,
            Ok(n) => n,
            Err(err) => {
                tracing::warn!(error = %err, "pty_read_loop reader returned error; ending");
                return;
            }
        };
        let chunk = &buf[..n];
        dispatch_to_sinks(&sinks, |sink| sink.write(chunk)).await;
    }
}

/// Drain `rx` and forward each `Vec<u8>` chunk to `writer` (D4 mechanism (b)).
///
/// The blocking `write_all` + `flush` pair runs under `spawn_blocking` so the
/// async runtime stays free even if the PTY's kernel buffer is briefly full.
/// Any write error or a closed channel terminates the loop, which drops
/// `writer` and lets the kernel close the PTY master.
async fn pty_write_loop(mut writer: Box<dyn Write + Send>, mut rx: Receiver<Vec<u8>>) {
    while let Some(chunk) = rx.recv().await {
        let join = spawn_blocking(move || {
            let result = writer.write_all(&chunk).and_then(|()| writer.flush());
            (writer, result)
        })
        .await;
        let Ok((returned_writer, write_result)) = join else {
            return;
        };
        if write_result.is_err() {
            return;
        }
        writer = returned_writer;
    }
}

/// Central registry of live agent sessions (D4).
///
/// Holds the keyed `SessionHandle` map behind an `Arc<RwLock<..>>`. Persistence
/// of `agent_sessions` rows is the caller's job: the session commands resolve
/// the active project's per-project pool from the `Db` state and pass it in, so
/// the manager owns no database handle of its own.
///
/// Locking discipline: read/write critical sections MUST be short and MUST NOT
/// span `await` points. The reader/writer/wait tasks attached to each
/// `SessionHandle` await independently; holding the registry lock while they
/// do would deadlock app shutdown.
pub struct SessionManager {
    state: Arc<RwLock<HashMap<SessionId, SessionHandle>>>,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn list_sessions(&self) -> Vec<SessionId> {
        self.state.read().await.keys().cloned().collect()
    }

    /// Queue `bytes` for the session's PTY master writer.
    ///
    /// The send goes through the bounded `INPUT_CHANNEL_CAPACITY` mpsc, so a
    /// stuck child applies backpressure to callers instead of letting the
    /// queue grow unbounded. Returns `NotFound` when `id` is not registered
    /// and `InputClosed` when the writer task has exited (typically because
    /// the PTY was closed or the child died).
    pub async fn send_input(&self, id: &SessionId, bytes: Vec<u8>) -> Result<(), SessionError> {
        let writer = {
            let state = self.state.read().await;
            let handle = state
                .get(id)
                .ok_or_else(|| SessionError::NotFound(id.to_string()))?;
            handle.writer().clone()
        };
        writer
            .send(bytes)
            .await
            .map_err(|_| SessionError::InputClosed)
    }

    /// Forward a frontend key press to the session's terminal sink, which
    /// VT-encodes it against the live terminal modes and writes the bytes to the
    /// PTY. Fans out through the sink list exactly like [`resize_session`]; only
    /// the terminal sink acts on it (byte-only sinks ignore `key`). Returns
    /// `NotFound` for unknown sessions; delivery past that is best-effort (a
    /// wedged child drops the keystroke rather than stalling the render thread).
    pub async fn send_key(&self, id: &SessionId, stroke: KeyStroke) -> Result<(), SessionError> {
        let state = self.state.read().await;
        let handle = state
            .get(id)
            .ok_or_else(|| SessionError::NotFound(id.to_string()))?;
        dispatch_to_sinks(handle.sinks(), |sink| sink.key(stroke.clone())).await;
        Ok(())
    }

    /// Flip whether a frontend pane is watching `id` (TP3). Fans out through
    /// the sink list exactly like [`send_key`]; only the terminal sink acts on
    /// it (it gates cell-frame emission), byte-only sinks ignore it. Returns
    /// `NotFound` for unknown sessions.
    pub async fn set_subscribed(&self, id: &SessionId, subscribed: bool) -> Result<(), SessionError> {
        let state = self.state.read().await;
        let handle = state
            .get(id)
            .ok_or_else(|| SessionError::NotFound(id.to_string()))?;
        dispatch_to_sinks(handle.sinks(), |sink| sink.set_subscribed(subscribed)).await;
        Ok(())
    }

    /// Forward a frontend mouse event to the terminal sink, whose render
    /// thread encodes it against the live mouse-tracking mode (TP10) — or
    /// drops it outside any tracking mode. Returns `NotFound` for unknown
    /// sessions.
    pub async fn send_mouse(&self, id: &SessionId, input: MouseInput) -> Result<(), SessionError> {
        let state = self.state.read().await;
        let handle = state
            .get(id)
            .ok_or_else(|| SessionError::NotFound(id.to_string()))?;
        dispatch_to_sinks(handle.sinks(), |sink| sink.mouse(input)).await;
        Ok(())
    }

    /// Reset the session's terminal emulator to boot state (the Ghostty
    /// `reset` keybind action). Fans out like [`send_key`]; the terminal sink's
    /// render thread wipes the grid and pushes a fresh frame. Returns
    /// `NotFound` for unknown sessions.
    pub async fn reset_terminal(&self, id: &SessionId) -> Result<(), SessionError> {
        let state = self.state.read().await;
        let handle = state
            .get(id)
            .ok_or_else(|| SessionError::NotFound(id.to_string()))?;
        dispatch_to_sinks(handle.sinks(), |sink| sink.reset_terminal()).await;
        Ok(())
    }

    /// Forward pasted text to the session's terminal sink, which encodes it
    /// against the live bracketed-paste mode and writes it to the PTY (TP7).
    /// Fans out like [`send_key`]; byte-only sinks ignore it. Returns
    /// `NotFound` for unknown sessions.
    pub async fn paste(&self, id: &SessionId, data: Vec<u8>) -> Result<(), SessionError> {
        let state = self.state.read().await;
        let handle = state
            .get(id)
            .ok_or_else(|| SessionError::NotFound(id.to_string()))?;
        dispatch_to_sinks(handle.sinks(), |sink| sink.paste(data.clone())).await;
        Ok(())
    }

    /// Pull the session's current grid as a [`CellFrame`] (TP1: a pane paints
    /// its first frame from this snapshot instead of staying blank until the
    /// next output). Fans the request out like [`send_key`]; the terminal
    /// sink's render thread answers on the reply channel. Returns `NotFound`
    /// for unknown sessions and `FrameUnavailable` when no terminal sink
    /// replies within [`FRAME_REQUEST_TIMEOUT`] (no terminal sink attached, or
    /// its render thread is gone).
    pub async fn request_frame(&self, id: &SessionId) -> Result<CellFrame, SessionError> {
        let (reply_tx, mut reply_rx) = channel::<CellFrame>(1);
        {
            let state = self.state.read().await;
            let handle = state
                .get(id)
                .ok_or_else(|| SessionError::NotFound(id.to_string()))?;
            dispatch_to_sinks(handle.sinks(), |sink| sink.frame_request(reply_tx.clone())).await;
        }
        // Drop our own sender so `recv` resolves to None as soon as every sink
        // discarded its clone (the no-terminal-sink case fails fast instead of
        // burning the whole timeout).
        drop(reply_tx);

        match timeout(FRAME_REQUEST_TIMEOUT, reply_rx.recv()).await {
            Ok(Some(frame)) => Ok(frame),
            Ok(None) => Err(SessionError::FrameUnavailable(id.to_string())),
            Err(_elapsed) => Err(SessionError::FrameUnavailable(id.to_string())),
        }
    }

    /// Register an additional [`OutputSink`] on a live session.
    ///
    /// The reader task fans every PTY chunk out to the session's sink list, so
    /// callers — typically the `session_create` Tauri command attaching a
    /// `TauriEventSink` right after spawn — can subscribe to the live stream
    /// without changing `create_session`'s public signature.
    ///
    /// The registry lock is held only long enough to clone the per-handle
    /// sinks `Arc`; the actual `Vec` push happens under the handle's own
    /// `RwLock`, which never spans the registry lock.
    pub async fn attach_sink(
        &self,
        id: &SessionId,
        sink: Arc<dyn OutputSink>,
    ) -> Result<(), SessionError> {
        let state = self.state.read().await;
        let handle = state
            .get(id)
            .ok_or_else(|| SessionError::NotFound(id.to_string()))?;
        handle.attach_sink(sink).await;
        Ok(())
    }

    /// Allocate a fresh `SessionId`, spawn the PTY under
    /// `tauri::async_runtime::spawn_blocking`, and register a `SessionHandle`
    /// in the registry.
    ///
    /// The reader task drains the PTY master and fans bytes out to every
    /// attached sink (P3-07). The writer task drains the input mpsc into
    /// the PTY master writer (P3-08). The wait task (P3-09) locks the
    /// child mutex, calls `child.wait()` under `spawn_blocking`, and lets
    /// the `JoinHandle<ExitStatus>` resolve to the observed exit code so
    /// the close path can consume it.
    pub async fn create_session<F>(
        &self,
        binary: PathBuf,
        cwd: PathBuf,
        env: HashMap<String, String>,
        initial_sinks: F,
    ) -> Result<SessionId, SessionError>
    where
        F: FnOnce(&SessionId, Sender<Vec<u8>>) -> Vec<Arc<dyn OutputSink>>,
    {
        let binary_str = binary
            .to_str()
            .ok_or_else(|| {
                SessionError::Spawn(format!("non-utf8 binary path: {}", binary.display()))
            })?
            .to_string();

        let pty_session = spawn_blocking(move || pty::spawn(&binary_str, &cwd, &env))
            .await
            .map_err(|err| SessionError::Spawn(format!("spawn_blocking join failed: {err}")))??;

        let PtySession {
            master,
            master_reader,
            master_writer,
            child,
        } = pty_session;

        let pid = child.process_id();
        let child = Arc::new(Mutex::new(child));
        let shared_master = Arc::new(StdMutex::new(master));
        let (writer_tx, writer_rx) = channel::<Vec<u8>>(INPUT_CHANNEL_CAPACITY);

        // Allocate the id BEFORE spawning the reader so `initial_sinks` can
        // build sinks bound to the final session id; populating the Vec here
        // (not via attach_sink afterwards) closes the race where the PTY's
        // first chunk arrives before any sink has been attached. The closure
        // also receives a clone of the PTY input channel so a terminal sink can
        // write encoded keystrokes back to the child.
        let id = SessionId::new();
        let sinks: Arc<RwLock<Vec<Arc<dyn OutputSink>>>> =
            Arc::new(RwLock::new(initial_sinks(&id, writer_tx.clone())));

        let reader_task = spawn(pty_read_loop(master_reader, Arc::clone(&sinks)));
        let writer_task = spawn(pty_write_loop(master_writer, writer_rx));
        let child_for_wait = Arc::clone(&child);
        let sinks_for_wait = Arc::clone(&sinks);
        let wait_task = spawn(async move {
            let guard = child_for_wait.lock_owned().await;
            let status = spawn_blocking(move || {
                let mut guard = guard;
                guard.wait().expect("child.wait()")
            })
            .await
            .expect("wait_task spawn_blocking join");

            // The child has terminated: fan the exit code out to every
            // registered sink so the UI (TauriEventSink → `agent:end`) can
            // auto-open the diff, without coupling the manager to Tauri. Fired
            // exactly once whether the exit was natural or forced via
            // `session_close` (which awaits this same task).
            let exit_code = status.exit_code();
            dispatch_to_sinks(&sinks_for_wait, |sink| sink.end(exit_code)).await;

            status
        });

        let handle = SessionHandle::new(
            writer_tx,
            child,
            SessionTasks {
                reader: reader_task,
                writer: writer_task,
                wait: wait_task,
            },
            sinks,
            pid,
            Some(shared_master),
        );

        {
            let mut state = self.state.write().await;
            state.insert(id.clone(), handle);
        }

        Ok(id)
    }

    /// Propagate a frontend resize to the kernel via TIOCSWINSZ. The child
    /// receives SIGWINCH and reflows its output (e.g. claude redraws its
    /// TUI at the new dimensions). Returns `NotFound` for unknown sessions.
    ///
    /// Sinks are resized FIRST, then the PTY. The PTY resize is what triggers
    /// the child's SIGWINCH reflow; if the render-side terminal emulator (the
    /// `TermSink`) were still at the old width when those reflowed bytes
    /// arrived, the grid would scatter. Resizing sinks first guarantees the
    /// emulator matches the geometry the child is about to draw into.
    pub async fn resize_session(
        &self,
        id: &SessionId,
        cols: u16,
        rows: u16,
    ) -> Result<(), SessionError> {
        let state = self.state.read().await;
        let handle = state
            .get(id)
            .ok_or_else(|| SessionError::NotFound(id.to_string()))?;
        dispatch_to_sinks(handle.sinks(), |sink| sink.resize(rows, cols)).await;
        handle.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
    }

    /// Graceful per-session shutdown (D4 mechanism (c)).
    ///
    /// Atomically removes the handle from the registry, sends `SIGTERM` to
    /// the child, waits up to [`SHUTDOWN_GRACE`] for the wait observer to
    /// resolve, then escalates to `SIGKILL` if the child is still alive.
    ///
    /// On exit, the supporting reader/writer tasks are aborted by the
    /// `SessionHandle::Drop` impl as the local `handle` binding goes out of
    /// scope. The wait observer's `JoinHandle`, if not consumed by
    /// `timeout`, is dropped without abort — tokio leaves the task running
    /// in the background so the kernel can reap the child cleanly.
    ///
    /// Returns `NotFound` if `id` was never registered or has already been
    /// closed. Returns `Ok(())` once the kill sequence has been issued; it
    /// does NOT guarantee the kernel has reaped the process by the time
    /// this future resolves.
    pub async fn session_close(&self, id: &SessionId) -> Result<(), SessionError> {
        let mut handle = {
            let mut state = self.state.write().await;
            state
                .remove(id)
                .ok_or_else(|| SessionError::NotFound(id.to_string()))?
        };

        let pid = handle
            .pid()
            .and_then(|raw| i32::try_from(raw).ok())
            .map(Pid::from_raw);
        let wait_task = handle.take_wait_task();

        // If the wait observer has already resolved, the child has been
        // reaped and its PID may have been recycled by the kernel — never
        // signal a recycled PID, just unregister and return.
        if wait_task
            .as_ref()
            .map(|t| t.inner().is_finished())
            .unwrap_or(true)
        {
            return Ok(());
        }

        if let Some(pid) = pid {
            let _ = kill(pid, Signal::SIGTERM);
        }

        let escalate = match wait_task {
            Some(task) => timeout(SHUTDOWN_GRACE, task).await.is_err(),
            None => false,
        };

        if escalate {
            tracing::warn!(session_id = %id, "escalating to SIGKILL");
            if let Some(pid) = pid {
                let _ = kill(pid, Signal::SIGKILL);
            }
        }

        Ok(())
    }
}

/// Process-wide shutdown broadcast (D4 edge): when the `SessionManager` is
/// dropped — typically on app quit — every still-registered child receives
/// `SIGTERM` immediately so the OS can start tearing them down in parallel.
///
/// PIDs are snapshotted under a brief synchronous `try_read` BEFORE any
/// `kill()` syscall, so no signal is issued while the registry lock is held.
/// `try_read` is used (not `blocking_read`) because Drop may run inside a
/// tokio worker, where blocking-on-the-runtime would deadlock.
///
/// A detached `std::thread` then sleeps [`SHUTDOWN_GRACE`] and escalates to
/// `SIGKILL` for any PID still alive — same 2s timeout as `session_close`.
/// `std::thread` is used (not a tokio task) because the runtime may be
/// shutting down concurrently with this Drop and could refuse to schedule a
/// new task.
///
/// This is best-effort: it does NOT await reaping and does NOT panic if the
/// registry is empty.
impl Drop for SessionManager {
    fn drop(&mut self) {
        let pids: Vec<Pid> = match self.state.try_read() {
            Ok(guard) => guard
                .values()
                .filter_map(|handle| handle.pid())
                .filter_map(|raw| i32::try_from(raw).ok())
                .map(Pid::from_raw)
                .collect(),
            Err(_) => {
                tracing::warn!(
                    "SessionManager dropped: registry lock contended, skipping SIGTERM broadcast"
                );
                return;
            }
        };

        let count = pids.len();
        for pid in &pids {
            let _ = kill(*pid, Signal::SIGTERM);
        }
        tracing::info!(count, "SessionManager dropped");

        if !pids.is_empty() {
            std::thread::spawn(move || {
                std::thread::sleep(SHUTDOWN_GRACE);
                for pid in pids {
                    // ESRCH means the kernel has already reaped the child; any
                    // other Ok/Err means the PID is still claimed and worth
                    // escalating. The PID-recycle race is benign here because
                    // a recycled PID within 2s on macOS is extremely unlikely.
                    if kill(pid, None).is_ok() {
                        tracing::warn!(pid = pid.as_raw(), "escalating to SIGKILL on shutdown");
                        let _ = kill(pid, Signal::SIGKILL);
                    }
                }
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;
    use std::sync::Mutex as StdMutex;

    use portable_pty::{Child, ChildKiller, ExitStatus};
    use tauri::async_runtime::block_on;

    use super::*;
    use crate::session::sink::test_support::VecSink;

    #[derive(Debug)]
    struct FakeChild;

    impl ChildKiller for FakeChild {
        fn kill(&mut self) -> std::io::Result<()> {
            Ok(())
        }

        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(FakeChild)
        }
    }

    impl Child for FakeChild {
        fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
            Ok(None)
        }

        fn wait(&mut self) -> std::io::Result<ExitStatus> {
            Ok(ExitStatus::with_exit_code(0))
        }

        fn process_id(&self) -> Option<u32> {
            None
        }
    }

    struct VecWriter(Arc<StdMutex<Vec<u8>>>);

    impl Write for VecWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0
                .lock()
                .expect("VecWriter mutex")
                .extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn fresh_child() -> Arc<Mutex<Box<dyn Child + Send + Sync>>> {
        Arc::new(Mutex::new(
            Box::new(FakeChild) as Box<dyn Child + Send + Sync>
        ))
    }

    #[test]
    fn new_starts_with_no_sessions() {
        let manager = SessionManager::new();
        let ids = block_on(manager.list_sessions());
        assert!(ids.is_empty());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn create_session_registers_id_in_map() {
        block_on(async {
            let manager = SessionManager::new();
            let env: HashMap<String, String> = HashMap::new();

            let id = manager
                .create_session(
                    PathBuf::from("/bin/sh"),
                    PathBuf::from("/tmp"),
                    env,
                    |_, _| Vec::new(),
                )
                .await
                .expect("create_session should spawn /bin/sh");

            let ids = manager.list_sessions().await;
            assert!(ids.contains(&id), "registry should contain returned id");
        });
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn create_session_produces_distinct_ids() {
        block_on(async {
            let manager = SessionManager::new();
            let env: HashMap<String, String> = HashMap::new();

            let id1 = manager
                .create_session(
                    PathBuf::from("/bin/sh"),
                    PathBuf::from("/tmp"),
                    env.clone(),
                    |_, _| Vec::new(),
                )
                .await
                .expect("first create_session");
            let id2 = manager
                .create_session(
                    PathBuf::from("/bin/sh"),
                    PathBuf::from("/tmp"),
                    env,
                    |_, _| Vec::new(),
                )
                .await
                .expect("second create_session");

            assert_ne!(id1, id2);
            assert_eq!(manager.list_sessions().await.len(), 2);
        });
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn create_session_wait_task_resolves_to_exit_status_zero_for_true() {
        use std::time::{Duration, Instant};

        block_on(async {
            let manager = SessionManager::new();
            let env: HashMap<String, String> = HashMap::new();

            let id = manager
                .create_session(
                    PathBuf::from("/usr/bin/true"),
                    PathBuf::from("/tmp"),
                    env,
                    |_, _| Vec::new(),
                )
                .await
                .expect("create_session /usr/bin/true");

            let wait_task = {
                let mut state = manager.state.write().await;
                let handle = state
                    .get_mut(&id)
                    .expect("session registered after create_session");
                handle
                    .take_wait_task()
                    .expect("wait_task should be present right after create_session")
            };

            let started = Instant::now();
            let status = wait_task
                .await
                .expect("wait observer task should not panic");
            let elapsed = started.elapsed();

            assert!(
                elapsed < Duration::from_secs(1),
                "wait observer should resolve within 1s, took {elapsed:?}"
            );
            assert_eq!(status.exit_code(), 0);
        });
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn create_session_fires_end_once_with_exit_code_on_natural_exit() {
        // A sink that records every `end` call so we can assert the wait task
        // fans the terminal event out exactly once with the observed code.
        struct EndSink(Arc<StdMutex<Vec<u32>>>);
        impl OutputSink for EndSink {
            fn write(&self, _bytes: &[u8]) {}
            fn end(&self, exit_code: u32) {
                self.0.lock().expect("EndSink mutex").push(exit_code);
            }
        }

        block_on(async {
            let manager = SessionManager::new();
            let calls = Arc::new(StdMutex::new(Vec::<u32>::new()));
            let calls_for_sink = Arc::clone(&calls);

            let id = manager
                .create_session(
                    PathBuf::from("/usr/bin/true"),
                    PathBuf::from("/tmp"),
                    HashMap::new(),
                    move |_, _| {
                        vec![Arc::new(EndSink(Arc::clone(&calls_for_sink))) as Arc<dyn OutputSink>]
                    },
                )
                .await
                .expect("create_session /usr/bin/true");

            let wait_task = {
                let mut state = manager.state.write().await;
                state
                    .get_mut(&id)
                    .expect("session registered")
                    .take_wait_task()
                    .expect("wait_task present right after create_session")
            };

            // `end` is fanned out inside the wait task *before* it returns the
            // status, so once the JoinHandle resolves the sink is notified.
            let status = wait_task.await.expect("wait observer should not panic");
            assert_eq!(status.exit_code(), 0);
            assert_eq!(
                *calls.lock().expect("calls mutex"),
                vec![0],
                "end should fire exactly once with exit code 0"
            );
        });
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn create_session_rejects_non_utf8_binary_path() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;

        block_on(async {
            let manager = SessionManager::new();
            let bad = PathBuf::from(OsString::from_vec(vec![0xff, 0xfe, 0xfd]));
            let err = manager
                .create_session(bad, PathBuf::from("/tmp"), HashMap::new(), |_, _| {
                    Vec::new()
                })
                .await
                .expect_err("non-utf8 binary path should fail before spawn");
            match err {
                SessionError::Spawn(msg) => assert!(
                    msg.contains("non-utf8"),
                    "expected non-utf8 message, got {msg:?}"
                ),
                other => panic!("expected Spawn error, got {other:?}"),
            }
        });
    }

    // A `Read` impl that hands the loop one queued chunk per `read` call,
    // then returns Ok(0) to signal EOF. Used to exercise the
    // multi-iteration path of `pty_read_loop`.
    struct ChunkedReader {
        chunks: Vec<Vec<u8>>,
        idx: usize,
    }

    impl Read for ChunkedReader {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            if self.idx >= self.chunks.len() {
                return Ok(0);
            }
            let chunk = &self.chunks[self.idx];
            let n = chunk.len().min(buf.len());
            buf[..n].copy_from_slice(&chunk[..n]);
            self.idx += 1;
            Ok(n)
        }
    }

    #[test]
    fn pty_read_loop_forwards_chunks_to_attached_sink() {
        block_on(async {
            let sinks: Arc<RwLock<Vec<Arc<dyn OutputSink>>>> = Arc::new(RwLock::new(Vec::new()));
            let sink = Arc::new(VecSink::new());
            sinks
                .write()
                .await
                .push(Arc::clone(&sink) as Arc<dyn OutputSink>);

            let reader: Box<dyn Read + Send> = Box::new(Cursor::new(b"hello world".to_vec()));
            pty_read_loop(reader, Arc::clone(&sinks)).await;

            assert_eq!(sink.snapshot(), b"hello world");
        });
    }

    #[test]
    fn pty_read_loop_fans_out_to_all_attached_sinks() {
        block_on(async {
            let sinks: Arc<RwLock<Vec<Arc<dyn OutputSink>>>> = Arc::new(RwLock::new(Vec::new()));
            let a = Arc::new(VecSink::new());
            let b = Arc::new(VecSink::new());
            {
                let mut guard = sinks.write().await;
                guard.push(Arc::clone(&a) as Arc<dyn OutputSink>);
                guard.push(Arc::clone(&b) as Arc<dyn OutputSink>);
            }

            let reader: Box<dyn Read + Send> = Box::new(Cursor::new(b"abc".to_vec()));
            pty_read_loop(reader, Arc::clone(&sinks)).await;

            assert_eq!(a.snapshot(), b"abc");
            assert_eq!(b.snapshot(), b"abc");
        });
    }

    #[test]
    fn pty_write_loop_forwards_100_bytes_to_fake_writer() {
        block_on(async {
            let observed = Arc::new(StdMutex::new(Vec::<u8>::new()));
            let writer: Box<dyn Write + Send> = Box::new(VecWriter(Arc::clone(&observed)));
            let (tx, rx) = channel::<Vec<u8>>(INPUT_CHANNEL_CAPACITY);

            let task = spawn(pty_write_loop(writer, rx));

            let payload = vec![b'x'; 100];
            tx.send(payload).await.expect("send 100 bytes");
            drop(tx);
            task.await
                .expect("writer task should exit on channel close");

            let captured = observed.lock().expect("VecWriter mutex").clone();
            assert_eq!(captured.len(), 100);
            assert!(captured.iter().all(|b| *b == b'x'));
        });
    }

    #[test]
    fn pty_write_loop_concatenates_multiple_chunks_in_order() {
        block_on(async {
            let observed = Arc::new(StdMutex::new(Vec::<u8>::new()));
            let writer: Box<dyn Write + Send> = Box::new(VecWriter(Arc::clone(&observed)));
            let (tx, rx) = channel::<Vec<u8>>(INPUT_CHANNEL_CAPACITY);

            let task = spawn(pty_write_loop(writer, rx));

            tx.send(b"hello ".to_vec()).await.expect("send 1");
            tx.send(b"world".to_vec()).await.expect("send 2");
            drop(tx);
            task.await.expect("writer task join");

            assert_eq!(
                observed.lock().expect("VecWriter mutex").as_slice(),
                b"hello world"
            );
        });
    }

    #[test]
    fn send_input_returns_not_found_for_unknown_session() {
        block_on(async {
            let manager = SessionManager::new();
            let id = SessionId::new();
            let err = manager
                .send_input(&id, b"data".to_vec())
                .await
                .expect_err("unknown id should fail");
            match err {
                SessionError::NotFound(s) => assert_eq!(s, id.to_string()),
                other => panic!("expected NotFound, got {other:?}"),
            }
        });
    }

    #[test]
    fn send_input_returns_input_closed_when_receiver_dropped() {
        block_on(async {
            let manager = SessionManager::new();

            let (tx, rx) = channel::<Vec<u8>>(INPUT_CHANNEL_CAPACITY);
            drop(rx); // simulate writer task having exited

            let sinks: Arc<RwLock<Vec<Arc<dyn OutputSink>>>> = Arc::new(RwLock::new(Vec::new()));
            let reader_task = spawn(async { std::future::pending::<()>().await });
            let writer_task = spawn(async { std::future::pending::<()>().await });
            let wait_task = spawn(async { std::future::pending::<ExitStatus>().await });

            let handle = SessionHandle::new(
                tx,
                fresh_child(),
                SessionTasks {
                    reader: reader_task,
                    writer: writer_task,
                    wait: wait_task,
                },
                sinks,
                None,
                None,
            );
            let id = SessionId::new();
            manager.state.write().await.insert(id.clone(), handle);

            let err = manager
                .send_input(&id, b"x".to_vec())
                .await
                .expect_err("closed channel should fail");
            assert!(matches!(err, SessionError::InputClosed));
        });
    }

    #[test]
    fn pty_read_loop_iterates_until_eof_across_multiple_reads() {
        block_on(async {
            let sinks: Arc<RwLock<Vec<Arc<dyn OutputSink>>>> = Arc::new(RwLock::new(Vec::new()));
            let sink = Arc::new(VecSink::new());
            sinks
                .write()
                .await
                .push(Arc::clone(&sink) as Arc<dyn OutputSink>);

            let reader: Box<dyn Read + Send> = Box::new(ChunkedReader {
                chunks: vec![b"hel".to_vec(), b"lo ".to_vec(), b"world".to_vec()],
                idx: 0,
            });
            pty_read_loop(reader, Arc::clone(&sinks)).await;

            assert_eq!(sink.snapshot(), b"hello world");
        });
    }

    #[test]
    fn attach_sink_returns_not_found_for_unknown_id() {
        block_on(async {
            let manager = SessionManager::new();
            let id = SessionId::new();
            let sink: Arc<dyn OutputSink> = Arc::new(VecSink::new());
            let err = manager
                .attach_sink(&id, sink)
                .await
                .expect_err("unknown id should fail");
            match err {
                SessionError::NotFound(s) => assert_eq!(s, id.to_string()),
                other => panic!("expected NotFound, got {other:?}"),
            }
        });
    }

    #[test]
    fn attach_sink_receives_subsequent_pty_chunks() {
        block_on(async {
            let manager = SessionManager::new();

            let (writer_tx, _writer_rx) = channel::<Vec<u8>>(INPUT_CHANNEL_CAPACITY);
            let sinks: Arc<RwLock<Vec<Arc<dyn OutputSink>>>> = Arc::new(RwLock::new(Vec::new()));
            let reader_task = spawn(async { std::future::pending::<()>().await });
            let writer_task = spawn(async { std::future::pending::<()>().await });
            let wait_task = spawn(async { std::future::pending::<ExitStatus>().await });

            let handle = SessionHandle::new(
                writer_tx,
                fresh_child(),
                SessionTasks {
                    reader: reader_task,
                    writer: writer_task,
                    wait: wait_task,
                },
                Arc::clone(&sinks),
                None,
                None,
            );
            let id = SessionId::new();
            manager.state.write().await.insert(id.clone(), handle);

            let observer = Arc::new(VecSink::new());
            manager
                .attach_sink(&id, Arc::clone(&observer) as Arc<dyn OutputSink>)
                .await
                .expect("attach_sink on live session");

            let snapshot: Vec<Arc<dyn OutputSink>> = sinks.read().await.iter().cloned().collect();
            for sink in &snapshot {
                sink.write(b"first chunk");
            }
            assert_eq!(observer.snapshot(), b"first chunk");
        });
    }

    #[test]
    fn session_close_returns_not_found_for_unknown_id() {
        block_on(async {
            let manager = SessionManager::new();
            let id = SessionId::new();
            let err = manager
                .session_close(&id)
                .await
                .expect_err("unknown id should fail");
            match err {
                SessionError::NotFound(s) => assert_eq!(s, id.to_string()),
                other => panic!("expected NotFound, got {other:?}"),
            }
        });
    }

    #[test]
    fn resize_session_returns_not_found_for_unknown_id() {
        block_on(async {
            let manager = SessionManager::new();
            let id = SessionId::new();
            let err = manager
                .resize_session(&id, 120, 40)
                .await
                .expect_err("unknown id should fail");
            match err {
                SessionError::NotFound(s) => assert_eq!(s, id.to_string()),
                other => panic!("expected NotFound, got {other:?}"),
            }
        });
    }

    #[test]
    fn set_subscribed_returns_not_found_for_unknown_id() {
        block_on(async {
            let manager = SessionManager::new();
            let id = SessionId::new();
            let err = manager
                .set_subscribed(&id, true)
                .await
                .expect_err("unknown id should fail");
            match err {
                SessionError::NotFound(s) => assert_eq!(s, id.to_string()),
                other => panic!("expected NotFound, got {other:?}"),
            }
        });
    }

    #[test]
    fn send_mouse_returns_not_found_for_unknown_id() {
        block_on(async {
            let manager = SessionManager::new();
            let id = SessionId::new();
            let input = MouseInput {
                action: mizraj_term::MouseAction::Press,
                button: mizraj_term::MouseButton::Left,
                col: 0,
                row: 0,
                mods: mizraj_term::Mods {
                    ctrl: false,
                    alt: false,
                    shift: false,
                },
            };
            let err = manager
                .send_mouse(&id, input)
                .await
                .expect_err("unknown id should fail");
            match err {
                SessionError::NotFound(s) => assert_eq!(s, id.to_string()),
                other => panic!("expected NotFound, got {other:?}"),
            }
        });
    }

    #[test]
    fn reset_terminal_returns_not_found_for_unknown_id() {
        block_on(async {
            let manager = SessionManager::new();
            let id = SessionId::new();
            let err = manager
                .reset_terminal(&id)
                .await
                .expect_err("unknown id should fail");
            match err {
                SessionError::NotFound(s) => assert_eq!(s, id.to_string()),
                other => panic!("expected NotFound, got {other:?}"),
            }
        });
    }

    #[test]
    fn paste_returns_not_found_for_unknown_id() {
        block_on(async {
            let manager = SessionManager::new();
            let id = SessionId::new();
            let err = manager
                .paste(&id, b"hello".to_vec())
                .await
                .expect_err("unknown id should fail");
            match err {
                SessionError::NotFound(s) => assert_eq!(s, id.to_string()),
                other => panic!("expected NotFound, got {other:?}"),
            }
        });
    }

    #[test]
    fn request_frame_returns_not_found_for_unknown_id() {
        block_on(async {
            let manager = SessionManager::new();
            let id = SessionId::new();
            let err = manager
                .request_frame(&id)
                .await
                .expect_err("unknown id should fail");
            match err {
                SessionError::NotFound(s) => assert_eq!(s, id.to_string()),
                other => panic!("expected NotFound, got {other:?}"),
            }
        });
    }

    #[test]
    fn request_frame_reports_frame_unavailable_without_a_terminal_sink() {
        block_on(async {
            let manager = SessionManager::new();

            let (writer_tx, _writer_rx) = channel::<Vec<u8>>(INPUT_CHANNEL_CAPACITY);
            // Only a byte sink: nobody answers frame requests.
            let sinks: Arc<RwLock<Vec<Arc<dyn OutputSink>>>> = Arc::new(RwLock::new(vec![
                Arc::new(VecSink::new()) as Arc<dyn OutputSink>,
            ]));
            let handle = SessionHandle::new(
                writer_tx,
                fresh_child(),
                SessionTasks {
                    reader: spawn(async { std::future::pending::<()>().await }),
                    writer: spawn(async { std::future::pending::<()>().await }),
                    wait: spawn(async { std::future::pending::<ExitStatus>().await }),
                },
                sinks,
                None,
                None,
            );
            let id = SessionId::new();
            manager.state.write().await.insert(id.clone(), handle);

            let err = manager
                .request_frame(&id)
                .await
                .expect_err("a session with no terminal sink has no frame");
            match err {
                SessionError::FrameUnavailable(s) => assert_eq!(s, id.to_string()),
                other => panic!("expected FrameUnavailable, got {other:?}"),
            }
        });
    }

    #[test]
    fn set_subscribed_fans_out_to_session_sinks() {
        // A sink that records every subscription flip, standing in for the
        // terminal sink whose emission gate consumes them.
        struct SubscriptionSink(Arc<StdMutex<Vec<bool>>>);
        impl OutputSink for SubscriptionSink {
            fn write(&self, _bytes: &[u8]) {}
            fn set_subscribed(&self, subscribed: bool) {
                self.0
                    .lock()
                    .expect("SubscriptionSink mutex")
                    .push(subscribed);
            }
        }

        block_on(async {
            let manager = SessionManager::new();
            let flips = Arc::new(StdMutex::new(Vec::<bool>::new()));

            let (writer_tx, _writer_rx) = channel::<Vec<u8>>(INPUT_CHANNEL_CAPACITY);
            let sinks: Arc<RwLock<Vec<Arc<dyn OutputSink>>>> = Arc::new(RwLock::new(vec![
                Arc::new(SubscriptionSink(Arc::clone(&flips))) as Arc<dyn OutputSink>,
            ]));
            let handle = SessionHandle::new(
                writer_tx,
                fresh_child(),
                SessionTasks {
                    reader: spawn(async { std::future::pending::<()>().await }),
                    writer: spawn(async { std::future::pending::<()>().await }),
                    wait: spawn(async { std::future::pending::<ExitStatus>().await }),
                },
                sinks,
                None,
                None,
            );
            let id = SessionId::new();
            manager.state.write().await.insert(id.clone(), handle);

            manager
                .set_subscribed(&id, true)
                .await
                .expect("set_subscribed on live session");
            manager
                .set_subscribed(&id, false)
                .await
                .expect("set_subscribed off");

            assert_eq!(*flips.lock().expect("flips mutex"), vec![true, false]);
        });
    }

    #[test]
    fn drop_with_empty_registry_does_not_panic() {
        let manager = SessionManager::new();
        drop(manager);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn drop_broadcasts_sigterm_to_all_registered_sessions() {
        use std::os::unix::process::ExitStatusExt;
        use std::process::Command;

        // Two real OS children (no PTY) that block until signaled. We do NOT
        // hand them to the manager — we hand the manager fake `SessionHandle`s
        // that merely *expose* the real PIDs via `handle.pid()`, which is all
        // `Drop` reads. After dropping the manager, we `wait()` on the
        // std::process::Child ourselves and inspect the termination signal.
        let child1 = Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .expect("spawn sleep 1");
        let child2 = Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .expect("spawn sleep 2");
        let pid1_raw = child1.id();
        let pid2_raw = child2.id();
        let mut child1 = child1;
        let mut child2 = child2;

        block_on(async {
            let manager = SessionManager::new();

            for pid in [pid1_raw, pid2_raw] {
                let (writer_tx, _writer_rx) = channel::<Vec<u8>>(INPUT_CHANNEL_CAPACITY);
                let sinks: Arc<RwLock<Vec<Arc<dyn OutputSink>>>> =
                    Arc::new(RwLock::new(Vec::new()));
                let reader_task = spawn(async { std::future::pending::<()>().await });
                let writer_task = spawn(async { std::future::pending::<()>().await });
                let wait_task = spawn(async { std::future::pending::<ExitStatus>().await });

                let handle = SessionHandle::new(
                    writer_tx,
                    fresh_child(),
                    SessionTasks {
                        reader: reader_task,
                        writer: writer_task,
                        wait: wait_task,
                    },
                    sinks,
                    Some(pid),
                    None,
                );
                manager.state.write().await.insert(SessionId::new(), handle);
            }

            drop(manager);
        });

        let status1 = child1.wait().expect("child1 wait");
        let status2 = child2.wait().expect("child2 wait");
        assert_eq!(
            status1.signal(),
            Some(Signal::SIGTERM as i32),
            "child 1 should be killed by SIGTERM, got {status1:?}"
        );
        assert_eq!(
            status2.signal(),
            Some(Signal::SIGTERM as i32),
            "child 2 should be killed by SIGTERM, got {status2:?}"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn session_close_escalates_to_sigkill_when_child_traps_sigterm() {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;
        use std::time::{Duration, Instant};

        use nix::errno::Errno;
        use tempfile::TempDir;

        // A shell script that ignores both SIGTERM (target of escalation)
        // and SIGHUP (sent to the slave when the PTY master is dropped after
        // session_close returns). With both traps installed, the ONLY way
        // for this process to die within the assertion window is the
        // SIGKILL escalation path under test.
        let tmp = TempDir::new().expect("tempdir for trap script");
        let script_path = tmp.path().join("trap-sigterm.sh");
        fs::write(
            &script_path,
            "#!/bin/sh\ntrap '' TERM HUP\nwhile :; do sleep 1; done\n",
        )
        .expect("write trap script");
        fs::set_permissions(&script_path, fs::Permissions::from_mode(0o755))
            .expect("chmod +x trap script");

        block_on(async {
            let manager = SessionManager::new();
            let env: HashMap<String, String> = HashMap::new();

            let id = manager
                .create_session(script_path.clone(), PathBuf::from("/tmp"), env, |_, _| {
                    Vec::new()
                })
                .await
                .expect("create_session trap-sigterm.sh");

            let pid_raw = {
                let state = manager.state.read().await;
                let handle = state.get(&id).expect("session registered");
                handle.pid().expect("trap script should expose a pid")
            };
            let pid = Pid::from_raw(i32::try_from(pid_raw).expect("pid fits in i32"));

            // Give the script enough time to reach its `trap ''` line.
            // Without this, SIGTERM may arrive before the trap is installed
            // and the child would die from the SIGTERM itself, not the
            // SIGKILL escalation we're trying to exercise.
            tokio::time::sleep(Duration::from_millis(250)).await;

            manager.session_close(&id).await.expect("session_close ok");

            let started = Instant::now();
            let mut gone = false;
            while started.elapsed() < Duration::from_secs(3) {
                match kill(pid, None) {
                    Err(Errno::ESRCH) => {
                        gone = true;
                        break;
                    }
                    _ => {
                        tokio::time::sleep(Duration::from_millis(50)).await;
                    }
                }
            }
            assert!(
                gone,
                "SIGTERM-trapping child {pid_raw} should be SIGKILLed within 3s of session_close"
            );
        });
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn session_close_kills_long_running_child_and_clears_registry() {
        use std::time::{Duration, Instant};

        use nix::errno::Errno;

        // We can't pass argv yet (the public surface only takes binary +
        // cwd + env), so this test stands in for `sleep 60` with `/bin/sh`:
        // a long-running process attached to the PTY that idles waiting on
        // stdin and terminates cleanly on SIGTERM.
        block_on(async {
            let manager = SessionManager::new();
            let env: HashMap<String, String> = HashMap::new();

            let id = manager
                .create_session(
                    PathBuf::from("/bin/sh"),
                    PathBuf::from("/tmp"),
                    env,
                    |_, _| Vec::new(),
                )
                .await
                .expect("create_session /bin/sh");

            let pid_raw = {
                let state = manager.state.read().await;
                let handle = state.get(&id).expect("session registered");
                handle.pid().expect("/bin/sh should expose a pid")
            };
            let pid = Pid::from_raw(i32::try_from(pid_raw).expect("pid fits in i32"));

            manager.session_close(&id).await.expect("session_close ok");

            assert!(
                manager.state.read().await.get(&id).is_none(),
                "registry should no longer contain the closed id"
            );

            let started = Instant::now();
            let mut gone = false;
            while started.elapsed() < Duration::from_secs(5) {
                match kill(pid, None) {
                    Err(Errno::ESRCH) => {
                        gone = true;
                        break;
                    }
                    _ => {
                        tokio::time::sleep(Duration::from_millis(50)).await;
                    }
                }
            }
            assert!(
                gone,
                "child pid {pid_raw} should be dead within 5s after session_close"
            );
        });
    }
}
