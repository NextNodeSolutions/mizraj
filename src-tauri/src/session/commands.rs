use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use agent_cockpit_vcs::{create_session_ref, repo_open};
use tauri::{AppHandle, Runtime};

use crate::session::error::SessionError;
use crate::session::id::SessionId;
use crate::session::manager::SessionManager;
use crate::session::path;
use crate::session::sink::OutputSink;
use crate::session::tauri_sink::TauriEventSink;

fn register_session_ref(repo_path: &Path, session_id: &str) -> Result<(), SessionError> {
    let repo = repo_open(repo_path).map_err(|err| SessionError::SessionRef(err.to_string()))?;
    create_session_ref(&repo, session_id)
        .map_err(|err| SessionError::SessionRef(err.to_string()))?;
    Ok(())
}

async fn session_create_inner<F>(
    manager: &SessionManager,
    binary: &str,
    cwd: String,
    sink_factory: F,
) -> Result<SessionId, SessionError>
where
    F: FnOnce(&SessionId) -> Vec<Arc<dyn OutputSink>>,
{
    let binary_path = path::resolve(binary)?;
    let cwd_path = PathBuf::from(cwd);
    let env: HashMap<String, String> = HashMap::new();

    let id = manager
        .create_session(binary_path, cwd_path.clone(), env, sink_factory)
        .await?;

    // Register the session ref so `diff_session` resolves later. If the cwd
    // isn't a git repo or the ref clashes, tear down the just-spawned PTY
    // rather than leaving a half-wired session that the diff view can't open.
    if let Err(err) = register_session_ref(&cwd_path, id.as_str()) {
        if let Err(close_err) = manager.session_close(&id).await {
            tracing::warn!(
                session_id = id.as_str(),
                error = %close_err,
                "rollback session_close failed after session_ref registration error",
            );
        }
        return Err(err);
    }

    Ok(id)
}

#[tauri::command]
pub async fn session_create<R: Runtime>(
    binary: String,
    cwd: String,
    app: AppHandle<R>,
    manager: tauri::State<'_, SessionManager>,
) -> Result<SessionId, SessionError> {
    session_create_inner(&manager, &binary, cwd, move |id| {
        vec![Arc::new(TauriEventSink::new(app, id.clone())) as Arc<dyn OutputSink>]
    })
    .await
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

    fn no_sinks(_: &SessionId) -> Vec<Arc<dyn OutputSink>> {
        Vec::new()
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
                no_sinks,
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
    mod macos {
        use std::fs;
        use std::path::Path;

        use agent_cockpit_vcs::git2::{Repository, RepositoryInitOptions, Signature};
        use tempfile::TempDir;

        use super::*;

        fn init_repo_with_commit(path: &Path) -> Repository {
            let mut opts = RepositoryInitOptions::new();
            opts.external_template(false);
            opts.initial_head("main");
            let repo = Repository::init_opts(path, &opts).expect("init fixture repo");

            let sig = Signature::now("Test", "test@example.com").expect("signature");
            {
                let tree_id = {
                    let mut index = repo.index().expect("index");
                    index.write_tree().expect("write_tree")
                };
                let tree = repo.find_tree(tree_id).expect("find_tree");
                repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
                    .expect("initial commit");
            }
            repo
        }

        #[test]
        fn spawns_session_and_registers_session_ref() {
            let pool = fresh_pool();
            block_on(async {
                let manager = SessionManager::new(pool);
                let dir = TempDir::new().expect("tempdir");
                init_repo_with_commit(dir.path());

                let id = session_create_inner(
                    &manager,
                    "sh",
                    dir.path().to_string_lossy().into_owned(),
                    no_sinks,
                )
                .await
                .expect("session_create with /bin/sh should succeed");

                assert_eq!(id.as_str().len(), 26);
                assert!(manager.list_sessions().await.contains(&id));

                let repo = repo_open(dir.path()).expect("repo_open");
                let ref_name = format!("refs/agent-cockpit/sessions/{}", id.as_str());
                repo.find_reference(&ref_name)
                    .expect("session ref should exist after session_create");
            });
        }

        #[test]
        fn rolls_back_spawn_when_cwd_is_not_a_git_repo() {
            let pool = fresh_pool();
            block_on(async {
                let manager = SessionManager::new(pool);
                let dir = TempDir::new().expect("tempdir");
                fs::write(dir.path().join("not-a-repo"), b"").expect("write marker");

                let err = session_create_inner(
                    &manager,
                    "sh",
                    dir.path().to_string_lossy().into_owned(),
                    no_sinks,
                )
                .await
                .expect_err("non-repo cwd must fail");

                match err {
                    SessionError::SessionRef(_) => {}
                    other => panic!("expected SessionRef, got {other:?}"),
                }

                // Roll back happened: registry is empty.
                assert!(
                    manager.list_sessions().await.is_empty(),
                    "session must be unregistered after ref failure"
                );
            });
        }
    }
}
