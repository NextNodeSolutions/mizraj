use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;

use portable_pty::ExitStatus;
use sqlx::sqlite::SqlitePool;
use tauri::async_runtime::{channel, spawn, spawn_blocking, Mutex, Receiver, RwLock};

use crate::session::error::SessionError;
use crate::session::handle::SessionHandle;
use crate::session::id::SessionId;
use crate::session::pty::{self, PtySession};
use crate::session::sink::OutputSink;

const INPUT_CHANNEL_CAPACITY: usize = 64;
const PTY_READ_BUFFER_SIZE: usize = 4096;

/// Drain `reader` in 4KB chunks until EOF, fanning each chunk out to every
/// sink currently registered in `sinks` (D4 mechanism (a)).
///
/// The sink list is snapshotted (Arc clones, then the read lock is released)
/// before any `OutputSink::write` call. Per `OutputSink`'s contract a write
/// is supposed to be ~1ms, but holding the registry's RwLock across user-
/// supplied code is still a deadlock hazard the dossier explicitly flags.
async fn pty_read_loop(
    mut reader: Box<dyn Read + Send>,
    sinks: Arc<RwLock<Vec<Arc<dyn OutputSink>>>>,
) {
    loop {
        let buf = vec![0u8; PTY_READ_BUFFER_SIZE];
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
        let n = match read_result {
            Ok(0) => return,
            Ok(n) => n,
            Err(_) => return,
        };
        let snapshot: Vec<Arc<dyn OutputSink>> = {
            let guard = sinks.read().await;
            guard.iter().cloned().collect()
        };
        let chunk = &returned_buf[..n];
        for sink in &snapshot {
            sink.write(chunk);
        }
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
/// Holds the keyed `SessionHandle` map behind an `Arc<RwLock<..>>` and a clone
/// of the sqlx pool so spawn/close paths (added in later steps) can persist
/// rows in `agent_sessions` without re-resolving the pool.
///
/// Locking discipline: read/write critical sections MUST be short and MUST NOT
/// span `await` points. The reader/writer/wait tasks attached to each
/// `SessionHandle` await independently; holding the registry lock while they
/// do would deadlock app shutdown.
pub struct SessionManager {
    state: Arc<RwLock<HashMap<SessionId, SessionHandle>>>,
    pool: SqlitePool,
}

impl SessionManager {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            state: Arc::new(RwLock::new(HashMap::new())),
            pool,
        }
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
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

    /// Allocate a fresh `SessionId`, spawn the PTY under
    /// `tauri::async_runtime::spawn_blocking`, and register a `SessionHandle`
    /// in the registry.
    ///
    /// The reader task drains the PTY master and fans bytes out to every
    /// attached sink (P3-07, see [`pty_read_loop`]). The writer and wait
    /// tasks are still placeholders that pend forever while holding their
    /// PTY plumbing alive; the real loops land in P3-08 (writer) and P3-09
    /// (wait) by replacing the placeholder bodies in this function.
    pub async fn create_session(
        &self,
        binary: PathBuf,
        cwd: PathBuf,
        env: HashMap<String, String>,
    ) -> Result<SessionId, SessionError> {
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
            master_reader,
            master_writer,
            child,
        } = pty_session;

        let child = Arc::new(Mutex::new(child));
        let (writer_tx, writer_rx) = channel::<Vec<u8>>(INPUT_CHANNEL_CAPACITY);
        let sinks: Arc<RwLock<Vec<Arc<dyn OutputSink>>>> = Arc::new(RwLock::new(Vec::new()));

        let reader_task = spawn(pty_read_loop(master_reader, Arc::clone(&sinks)));
        let writer_task = spawn(pty_write_loop(master_writer, writer_rx));
        let child_for_wait = Arc::clone(&child);
        let wait_task = spawn(async move {
            let _hold = child_for_wait;
            std::future::pending::<ExitStatus>().await
        });

        let id = SessionId::new();
        let handle =
            SessionHandle::new(writer_tx, child, reader_task, writer_task, wait_task, sinks);

        {
            let mut state = self.state.write().await;
            state.insert(id.clone(), handle);
        }

        Ok(id)
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;
    use std::sync::Mutex as StdMutex;

    use portable_pty::{Child, ChildKiller};
    use sqlx::sqlite::SqlitePoolOptions;
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
            self.0.lock().expect("VecWriter mutex").extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn fresh_child() -> Arc<Mutex<Box<dyn Child + Send + Sync>>> {
        Arc::new(Mutex::new(Box::new(FakeChild) as Box<dyn Child + Send + Sync>))
    }

    fn fresh_pool() -> SqlitePool {
        block_on(async {
            SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("connect in-memory sqlite")
        })
    }

    #[test]
    fn new_starts_with_no_sessions() {
        let manager = SessionManager::new(fresh_pool());
        let ids = block_on(manager.list_sessions());
        assert!(ids.is_empty());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn create_session_registers_id_in_map() {
        let pool = fresh_pool();
        block_on(async {
            let manager = SessionManager::new(pool);
            let env: HashMap<String, String> = HashMap::new();

            let id = manager
                .create_session(PathBuf::from("/bin/sh"), PathBuf::from("/tmp"), env)
                .await
                .expect("create_session should spawn /bin/sh");

            let ids = manager.list_sessions().await;
            assert!(ids.contains(&id), "registry should contain returned id");
        });
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn create_session_produces_distinct_ids() {
        let pool = fresh_pool();
        block_on(async {
            let manager = SessionManager::new(pool);
            let env: HashMap<String, String> = HashMap::new();

            let id1 = manager
                .create_session(PathBuf::from("/bin/sh"), PathBuf::from("/tmp"), env.clone())
                .await
                .expect("first create_session");
            let id2 = manager
                .create_session(PathBuf::from("/bin/sh"), PathBuf::from("/tmp"), env)
                .await
                .expect("second create_session");

            assert_ne!(id1, id2);
            assert_eq!(manager.list_sessions().await.len(), 2);
        });
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn create_session_rejects_non_utf8_binary_path() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;

        let pool = fresh_pool();
        block_on(async {
            let manager = SessionManager::new(pool);
            let bad = PathBuf::from(OsString::from_vec(vec![0xff, 0xfe, 0xfd]));
            let err = manager
                .create_session(bad, PathBuf::from("/tmp"), HashMap::new())
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
            let sinks: Arc<RwLock<Vec<Arc<dyn OutputSink>>>> =
                Arc::new(RwLock::new(Vec::new()));
            let sink = Arc::new(VecSink::new());
            sinks
                .write()
                .await
                .push(Arc::clone(&sink) as Arc<dyn OutputSink>);

            let reader: Box<dyn Read + Send> =
                Box::new(Cursor::new(b"hello world".to_vec()));
            pty_read_loop(reader, Arc::clone(&sinks)).await;

            assert_eq!(sink.snapshot(), b"hello world");
        });
    }

    #[test]
    fn pty_read_loop_fans_out_to_all_attached_sinks() {
        block_on(async {
            let sinks: Arc<RwLock<Vec<Arc<dyn OutputSink>>>> =
                Arc::new(RwLock::new(Vec::new()));
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
            task.await.expect("writer task should exit on channel close");

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

            assert_eq!(observed.lock().expect("VecWriter mutex").as_slice(), b"hello world");
        });
    }

    #[test]
    fn send_input_returns_not_found_for_unknown_session() {
        let pool = fresh_pool();
        block_on(async {
            let manager = SessionManager::new(pool);
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
        let pool = fresh_pool();
        block_on(async {
            let manager = SessionManager::new(pool);

            let (tx, rx) = channel::<Vec<u8>>(INPUT_CHANNEL_CAPACITY);
            drop(rx); // simulate writer task having exited

            let sinks: Arc<RwLock<Vec<Arc<dyn OutputSink>>>> = Arc::new(RwLock::new(Vec::new()));
            let reader_task = spawn(async { std::future::pending::<()>().await });
            let writer_task = spawn(async { std::future::pending::<()>().await });
            let wait_task = spawn(async { std::future::pending::<ExitStatus>().await });

            let handle = SessionHandle::new(
                tx,
                fresh_child(),
                reader_task,
                writer_task,
                wait_task,
                sinks,
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
            let sinks: Arc<RwLock<Vec<Arc<dyn OutputSink>>>> =
                Arc::new(RwLock::new(Vec::new()));
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
}
