use std::fs;

use tauri::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    AppHandle, Manager, Runtime, Wry,
};
use tracing_appender::{
    non_blocking::WorkerGuard,
    rolling::{RollingFileAppender, Rotation},
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

const LOG_FILENAME_PREFIX: &str = "agent-cockpit";
const LOG_FILENAME_SUFFIX: &str = "log";
const MAX_LOG_FILES: usize = 14;
const DEFAULT_LOG_FILTER: &str = "info";

fn init_logging<R: Runtime>(app: &AppHandle<R>) -> Result<WorkerGuard, Box<dyn std::error::Error>> {
    let log_dir = app.path().app_log_dir()?;
    fs::create_dir_all(&log_dir)?;

    let file_appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix(LOG_FILENAME_PREFIX)
        .filename_suffix(LOG_FILENAME_SUFFIX)
        .max_log_files(MAX_LOG_FILES)
        .build(&log_dir)?;
    let (file_writer, guard) = tracing_appender::non_blocking(file_appender);

    let env_filter =
        EnvFilter::try_from_env("RUST_LOG").unwrap_or_else(|_| EnvFilter::new(DEFAULT_LOG_FILTER));

    let file_layer = tracing_subscriber::fmt::layer()
        .json()
        .with_writer(file_writer)
        .with_ansi(false);

    let registry = tracing_subscriber::registry()
        .with(env_filter)
        .with(file_layer);

    #[cfg(debug_assertions)]
    let registry = registry.with(tracing_subscriber::fmt::layer());

    registry.init();

    tracing::info!(path = ?log_dir, "logging initialized");

    Ok(guard)
}

/// Returns a plugin whose setup hook installs the tracing subscriber. Registering
/// this plugin before any other plugin guarantees that subsequent plugin setup
/// hooks (sql, store, updater, etc.) emit through an attached subscriber instead
/// of being dropped by the default no-op dispatcher.
pub fn plugin() -> TauriPlugin<Wry> {
    PluginBuilder::new("agent-cockpit-logging")
        .setup(|app, _api| {
            let guard = init_logging(app)?;
            app.manage(guard);
            Ok(())
        })
        .build()
}
