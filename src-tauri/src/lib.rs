mod active_project;
mod commands;
mod db;
pub mod diff_format;
mod files;
mod logging;
pub mod session;
pub mod worktree;

use tauri::Manager;

use crate::active_project::ActiveProject;
use crate::db::Db;
use crate::session::SessionManager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn log_from_frontend(
    level: String,
    message: String,
    scope: Option<String>,
    request_id: Option<String>,
    details: Option<String>,
) {
    let scope = scope.as_deref().unwrap_or("frontend");
    let request_id = request_id.as_deref().unwrap_or("");
    let details = details.as_deref().unwrap_or("");

    match level.as_str() {
        "error" => tracing::error!(
            target: "frontend",
            scope,
            request_id,
            details,
            "{}",
            message
        ),
        "warn" => tracing::warn!(
            target: "frontend",
            scope,
            request_id,
            details,
            "{}",
            message
        ),
        "debug" => tracing::debug!(
            target: "frontend",
            scope,
            request_id,
            details,
            "{}",
            message
        ),
        _ => tracing::info!(
            target: "frontend",
            scope,
            request_id,
            details,
            "{}",
            message
        ),
    }
}

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
        .register_uri_scheme_protocol(
            commands::plan_protocol::SCHEME,
            commands::plan_protocol::handle_request,
        )
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
            greet,
            log_from_frontend,
            files::read_interview_state,
            commands::get_diff::get_diff,
            commands::list_plans::list_plans,
            commands::set_active_project::set_active_project,
            commands::set_active_project::clear_active_project,
            commands::tasks::tasks_overview,
            commands::tasks::tasks_create,
            commands::tasks::tasks_update,
            commands::plan_protocol::resolve_plan,
            session::commands::session_create,
            session::commands::session_resize,
            session::commands::session_key,
            session::commands::session_close,
            session::label::session_label,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|err| {
            tracing::error!(error = %err, "tauri application exited with error");
            std::process::exit(1);
        });
}
