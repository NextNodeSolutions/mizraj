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
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(ActiveProject::default())
        .manage(Db::default())
        .register_uri_scheme_protocol(plans::protocol::SCHEME, plans::protocol::handle_request)
        .setup(|app| {
            #[cfg(target_os = "macos")]
            if let Some(path) = session::path::capture_login_shell_path() {
                std::env::set_var("PATH", path);
            }
            // No database is opened here: the progress.db is per-project, so it
            // is resolved and opened lazily when a project becomes active (see
            // `set_active_project`). Until then the `Db` state holds no pool.
            app.manage(SessionManager::new());
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
            project::clear_active_project,
            tasks::tasks_overview,
            tasks::tasks_create,
            tasks::tasks_update,
            plans::protocol::resolve_plan,
            session::commands::session_create,
            session::commands::session_resize,
            session::commands::session_key,
            session::commands::session_close,
            session::commands::session_subscribe,
            session::commands::session_unsubscribe,
            session::label::session_label,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|err| {
            tracing::error!(error = %err, "tauri application exited with error");
            std::process::exit(1);
        });
}
