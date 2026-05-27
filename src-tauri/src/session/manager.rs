use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use portable_pty::ExitStatus;
use sqlx::sqlite::SqlitePool;
use tauri::async_runtime::{channel, spawn, spawn_blocking, Mutex, RwLock};

use crate::session::error::SessionError;
use crate::session::handle::SessionHandle;
use crate::session::id::SessionId;
use crate::session::pty::{self, PtySession};
use crate::session::sink::OutputSink;

const INPUT_CHANNEL_CAPACITY: usize = 64;

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

    /// Allocate a fresh `SessionId`, spawn the PTY under
    /// `tauri::async_runtime::spawn_blocking`, and register a skeleton
    /// `SessionHandle` in the registry.
    ///
    /// "Skeleton" means the three long-running task slots (reader / writer /
    /// wait) are filled with placeholder bodies that pend forever while
    /// holding their slice of the PTY plumbing alive. The real loops land in
    /// P3-07 (reader), P3-08 (writer), and P3-09 (wait) by replacing the
    /// placeholder bodies in this function.
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

        let reader_task = spawn(async move {
            let _hold = master_reader;
            std::future::pending::<()>().await
        });
        let writer_task = spawn(async move {
            let _hold = (master_writer, writer_rx);
            std::future::pending::<()>().await
        });
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
    use sqlx::sqlite::SqlitePoolOptions;
    use tauri::async_runtime::block_on;

    use super::*;

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
}
