use std::path::Path;
use std::time::Duration;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePool};

pub async fn init_db(db_path: &Path) -> Result<SqlitePool, sqlx::Error> {
    let is_first_creation = !db_path.exists();
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(sqlx::Error::Io)?;
    }
    // SQLite defaults foreign_keys to OFF and busy_timeout to 0 ms per connection.
    let options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePool::connect_with(options).await?;
    sqlx::migrate!().run(&pool).await?;
    if is_first_creation {
        tracing::info!(path = %db_path.display(), "sqlite database created and migrations applied");
    }
    Ok(pool)
}
