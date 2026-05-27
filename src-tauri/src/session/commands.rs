use std::collections::HashMap;
use std::path::PathBuf;

use crate::session::error::SessionError;
use crate::session::id::SessionId;
use crate::session::manager::SessionManager;
use crate::session::path;

async fn session_create_inner(
    manager: &SessionManager,
    binary: &str,
    cwd: String,
    ref_name: String,
) -> Result<SessionId, SessionError> {
    let _ = ref_name;
    let binary_path = path::resolve(binary)?;
    let cwd_path = PathBuf::from(cwd);
    let env: HashMap<String, String> = HashMap::new();
    manager.create_session(binary_path, cwd_path, env).await
}

#[tauri::command]
pub async fn session_create(
    binary: String,
    cwd: String,
    ref_name: String,
    manager: tauri::State<'_, SessionManager>,
) -> Result<SessionId, SessionError> {
    session_create_inner(&manager, &binary, cwd, ref_name).await
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;
    use tauri::async_runtime::block_on;

    use super::*;

    fn fresh_pool() -> sqlx::SqlitePool {
        block_on(async {
            SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("connect in-memory sqlite")
        })
    }

    #[test]
    fn returns_binary_not_found_when_binary_missing() {
        let pool = fresh_pool();
        block_on(async {
            let manager = SessionManager::new(pool);
            let err = session_create_inner(
                &manager,
                "nope-not-a-real-binary-xyz",
                "/tmp".to_string(),
                "refs/agent-cockpit/sessions/x".to_string(),
            )
            .await
            .expect_err("missing binary should fail");
            match err {
                SessionError::BinaryNotFound(name) => {
                    assert_eq!(name, "nope-not-a-real-binary-xyz");
                }
                other => panic!("expected BinaryNotFound, got {other:?}"),
            }
        });
    }

    #[test]
    fn binary_not_found_serializes_with_typed_kind() {
        let err = SessionError::BinaryNotFound("claude".into());
        let json = serde_json::to_string(&err).expect("serialize");
        assert_eq!(json, r#"{"kind":"binary_not_found","binary":"claude"}"#);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn spawns_session_when_binary_resolves() {
        let pool = fresh_pool();
        block_on(async {
            let manager = SessionManager::new(pool);
            let id = session_create_inner(
                &manager,
                "sh",
                "/tmp".to_string(),
                "refs/agent-cockpit/sessions/test".to_string(),
            )
            .await
            .expect("session_create with /bin/sh should succeed");

            assert_eq!(id.as_str().len(), 26);
            assert!(manager.list_sessions().await.contains(&id));
        });
    }
}
