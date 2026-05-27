use std::sync::Arc;

use portable_pty::{Child, ExitStatus};
use tauri::async_runtime::{JoinHandle, Mutex, RwLock, Sender};

use crate::session::sink::OutputSink;

/// Per-session ownership of PTY channels, child process, and the three
/// long-running tokio tasks that keep the session alive.
///
/// Layout follows D4 (see phase context):
/// - `writer` accepts input bytes destined for the PTY master writer.
/// - `child` is the live process, behind an async `Mutex` so the shutdown
///   path can `kill()` it without racing the wait task.
/// - `reader_task` fans out PTY output bytes to every attached sink.
/// - `writer_task` drains the input mpsc into the PTY master writer.
/// - `wait_task` observes the child and resolves with its `ExitStatus`.
/// - `sinks` is the dynamic fan-out list updated via [`attach_sink`].
///
/// Dropping the handle aborts the three tasks so a forgotten session never
/// leaks a worker.
pub struct SessionHandle {
    writer: Sender<Vec<u8>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    reader_task: JoinHandle<()>,
    writer_task: JoinHandle<()>,
    wait_task: JoinHandle<ExitStatus>,
    sinks: Arc<RwLock<Vec<Arc<dyn OutputSink>>>>,
}

impl SessionHandle {
    pub fn new(
        writer: Sender<Vec<u8>>,
        child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
        reader_task: JoinHandle<()>,
        writer_task: JoinHandle<()>,
        wait_task: JoinHandle<ExitStatus>,
        sinks: Arc<RwLock<Vec<Arc<dyn OutputSink>>>>,
    ) -> Self {
        Self {
            writer,
            child,
            reader_task,
            writer_task,
            wait_task,
            sinks,
        }
    }

    pub fn writer(&self) -> &Sender<Vec<u8>> {
        &self.writer
    }

    pub fn child(&self) -> &Arc<Mutex<Box<dyn Child + Send + Sync>>> {
        &self.child
    }

    pub fn sinks(&self) -> &Arc<RwLock<Vec<Arc<dyn OutputSink>>>> {
        &self.sinks
    }

    pub async fn attach_sink(&self, sink: Arc<dyn OutputSink>) {
        self.sinks.write().await.push(sink);
    }
}

impl Drop for SessionHandle {
    fn drop(&mut self) {
        self.reader_task.abort();
        self.writer_task.abort();
        self.wait_task.abort();
    }
}

#[cfg(test)]
mod tests {
    use std::io;
    use std::sync::atomic::{AtomicBool, Ordering};

    use portable_pty::{Child, ChildKiller, ExitStatus};
    use tauri::async_runtime::{block_on, channel, spawn};

    use super::*;
    use crate::session::sink::test_support::VecSink;

    #[derive(Debug)]
    struct FakeChild;

    impl ChildKiller for FakeChild {
        fn kill(&mut self) -> io::Result<()> {
            Ok(())
        }

        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(FakeChild)
        }
    }

    impl Child for FakeChild {
        fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
            Ok(None)
        }

        fn wait(&mut self) -> io::Result<ExitStatus> {
            Ok(ExitStatus::with_exit_code(0))
        }

        fn process_id(&self) -> Option<u32> {
            None
        }
    }

    struct DropFlag(Arc<AtomicBool>);

    impl Drop for DropFlag {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    fn fresh_child() -> Arc<Mutex<Box<dyn Child + Send + Sync>>> {
        Arc::new(Mutex::new(Box::new(FakeChild) as Box<dyn Child + Send + Sync>))
    }

    #[test]
    fn attach_sink_appends_to_shared_list() {
        block_on(async {
            let (writer_tx, _writer_rx) = channel::<Vec<u8>>(8);
            let sinks: Arc<RwLock<Vec<Arc<dyn OutputSink>>>> = Arc::new(RwLock::new(Vec::new()));
            let reader_task = spawn(async { std::future::pending::<()>().await });
            let writer_task = spawn(async { std::future::pending::<()>().await });
            let wait_task = spawn(async { std::future::pending::<ExitStatus>().await });

            let handle = SessionHandle::new(
                writer_tx,
                fresh_child(),
                reader_task,
                writer_task,
                wait_task,
                Arc::clone(&sinks),
            );

            let a: Arc<dyn OutputSink> = Arc::new(VecSink::new());
            let b: Arc<dyn OutputSink> = Arc::new(VecSink::new());
            handle.attach_sink(Arc::clone(&a)).await;
            handle.attach_sink(Arc::clone(&b)).await;

            assert_eq!(sinks.read().await.len(), 2);
        });
    }

    #[test]
    fn drop_aborts_all_three_tasks() {
        block_on(async {
            let reader_dropped = Arc::new(AtomicBool::new(false));
            let writer_dropped = Arc::new(AtomicBool::new(false));
            let wait_dropped = Arc::new(AtomicBool::new(false));

            {
                let (writer_tx, _writer_rx) = channel::<Vec<u8>>(8);
                let sinks: Arc<RwLock<Vec<Arc<dyn OutputSink>>>> =
                    Arc::new(RwLock::new(Vec::new()));

                let r = Arc::clone(&reader_dropped);
                let reader_task = spawn(async move {
                    let _guard = DropFlag(r);
                    std::future::pending::<()>().await
                });

                let w = Arc::clone(&writer_dropped);
                let writer_task = spawn(async move {
                    let _guard = DropFlag(w);
                    std::future::pending::<()>().await
                });

                let we = Arc::clone(&wait_dropped);
                let wait_task = spawn(async move {
                    let _guard = DropFlag(we);
                    std::future::pending::<ExitStatus>().await
                });

                // Yield so each spawned task is polled at least once and
                // installs its DropFlag guard before we drop the handle.
                for _ in 0..4 {
                    let _ = spawn(async {}).await;
                }

                let handle = SessionHandle::new(
                    writer_tx,
                    fresh_child(),
                    reader_task,
                    writer_task,
                    wait_task,
                    sinks,
                );
                drop(handle);
            }

            // Let the runtime process the aborts (cancellation drops the
            // suspended futures, which in turn drop the `DropFlag`s).
            for _ in 0..16 {
                let _ = spawn(async {}).await;
            }

            assert!(reader_dropped.load(Ordering::SeqCst), "reader task should be aborted");
            assert!(writer_dropped.load(Ordering::SeqCst), "writer task should be aborted");
            assert!(wait_dropped.load(Ordering::SeqCst), "wait task should be aborted");
        });
    }
}
