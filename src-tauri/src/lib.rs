mod active_project;
mod commands;
mod db;
mod files;
mod logging;
mod session;

use tauri::Manager;

use crate::active_project::ActiveProject;

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
        .register_uri_scheme_protocol(
            commands::plan_protocol::SCHEME,
            commands::plan_protocol::handle_request,
        )
        .setup(|app| {
            #[cfg(target_os = "macos")]
            if let Some(path) = session::path::capture_login_shell_path() {
                std::env::set_var("PATH", path);
            }
            let app_data_dir = app.path().app_data_dir()?;
            let db_path = app_data_dir.join("agent-cockpit.db");
            let pool = tauri::async_runtime::block_on(db::init_db(&db_path)).map_err(|err| {
                tracing::error!(
                    path = %db_path.display(),
                    error = %err,
                    "init_db failed during Tauri setup",
                );
                err
            })?;
            app.manage(pool);
            #[cfg(all(desktop, not(debug_assertions)))]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            log_from_frontend,
            files::read_interview_state,
            commands::list_plans::list_plans,
            commands::set_active_project::set_active_project,
            commands::set_active_project::clear_active_project,
            commands::plan_protocol::resolve_plan,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|err| {
            tracing::error!(error = %err, "tauri application exited with error");
            std::process::exit(1);
        });
}
