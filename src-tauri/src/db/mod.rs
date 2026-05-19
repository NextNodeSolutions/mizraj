use std::path::Path;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};

pub async fn init_db(db_path: &Path) -> Result<SqlitePool, sqlx::Error> {
    let is_first_creation = !db_path.exists();
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(sqlx::Error::Io)?;
    }
    if is_first_creation {
        tracing::info!(path = %db_path.display(), "creating sqlite database");
    }
    let options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true);
    let pool = SqlitePool::connect_with(options).await?;
    sqlx::migrate!().run(&pool).await?;
    Ok(pool)
}
