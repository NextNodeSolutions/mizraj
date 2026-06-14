mod db;
mod diff;
mod ghostty;
mod interviews;
mod logging;
mod plans;
mod project;
pub mod session;
mod tasks;
pub mod worktree;

use tauri::Manager;

use crate::db::Db;
use crate::project::ActiveProject;
use crate::session::SessionManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(logging::plugin())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(ActiveProject::default())
        .manage(Db::default())
        .register_uri_scheme_protocol(plans::protocol::SCHEME, plans::protocol::handle_request)
        .setup(|app| {
            let registry_path = app
                .path()
                .app_data_dir()
                .map_err(|err| format!("resolve app data dir: {err}"))?
                .join("projects.json");
            let registry = project::registry::Registry::load(&registry_path)
                .map_err(|err| format!("load project registry: {err}"))?;
            // Every registered repo gets its filesystem watcher at startup
            // (MP6): the registry is the single source of truth of what is
            // watched. A repo deleted from disk logs an error and is skipped.
            //
            // Watcher startup is N blocking `notify::watch` syscalls plus a
            // thread spawn each, so it runs in a background task rather than on
            // the setup thread — `setup` returns fast and the window paints
            // without waiting for the filesystem watches to arm.
            app.manage(project::watcher::RepoWatchers::default());
            let repos = registry.list();
            app.manage(project::registry::SharedRegistry::new(registry));
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let watchers = handle.state::<project::watcher::RepoWatchers>();
                for repo in repos {
                    project::watcher::watch_and_emit(&watchers, &handle, &repo);
                }
            });
            #[cfg(target_os = "macos")]
            if let Some(path) = session::path::capture_login_shell_path() {
                std::env::set_var("PATH", path);
            }
            // No database is opened here: the progress.db is per-project, so it
            // is resolved and opened lazily when a project becomes active (see
            // `set_active_project`). Until then the `Db` state holds no pool.
            app.manage(SessionManager::new());
            // Managed for keep-alive: dropping the guard would stop hot reload.
            let config_watch = ghostty::start_config_watcher(app.handle());
            app.manage(config_watch);
            #[cfg(all(desktop, not(debug_assertions)))]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            logging::log_from_frontend,
            interviews::read_interview_state,
            diff::get_diff,
            ghostty::load_ghostty_config,
            plans::list::list_plans,
            project::set_active_project,
            project::registry::projects_list,
            project::registry::projects_missing,
            project::registry::projects_add,
            project::registry::projects_remove,
            project::clear_active_project,
            project::repo_head,
            tasks::tasks_overview,
            tasks::tasks_create,
            tasks::tasks_update,
            plans::protocol::resolve_plan,
            session::commands::session_create,
            session::commands::session_default_shell,
            session::commands::session_resize,
            session::commands::session_key,
            session::commands::session_close,
            session::commands::session_subscribe,
            session::commands::session_unsubscribe,
            session::commands::session_get_frame,
            session::commands::session_paste,
            session::commands::session_write,
            session::commands::session_reset,
            session::commands::session_mouse,
            session::commands::session_scroll,
            session::label::session_label,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|err| {
            tracing::error!(error = %err, "tauri application exited with error");
            std::process::exit(1);
        });
}
