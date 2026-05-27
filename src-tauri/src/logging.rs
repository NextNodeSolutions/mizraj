use std::fs;

use tauri::{App, Manager};
use tracing_appender::{
    non_blocking::WorkerGuard,
    rolling::{RollingFileAppender, Rotation},
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

const LOG_FILENAME_PREFIX: &str = "agent-cockpit";
const LOG_FILENAME_SUFFIX: &str = "log";
const MAX_LOG_FILES: usize = 14;
const DEFAULT_LOG_FILTER: &str = "info";

pub fn init_logging(app: &App) -> Result<WorkerGuard, Box<dyn std::error::Error>> {
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
