use std::collections::HashMap;
use std::sync::Arc;

use sqlx::sqlite::SqlitePool;
use tauri::async_runtime::RwLock;

use crate::session::handle::SessionHandle;
use crate::session::id::SessionId;

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
}
