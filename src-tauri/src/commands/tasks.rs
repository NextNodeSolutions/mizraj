use sqlx::SqlitePool;
use ulid::Ulid;

/// A task row from the shared cockpit database, scoped to one repository.
///
/// `status` is one of `backlog`, `in_progress`, `done` and `origin` one of
/// `user`, `track` — both enforced by the schema. `repo_path` is the filter
/// key and is not serialized (the caller already knows which repo it asked
/// for). `created_at` is an ISO-8601 UTC string produced by SQLite.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub origin: String,
    pub created_at: String,
}

/// Row tuple as selected from `tasks`, mapped into [`Task`]. A tuple keeps us on
/// `sqlx`'s built-in `FromRow` (no derive-macro feature dependency), matching
/// the query style used elsewhere in the crate.
type TaskRow = (String, String, Option<String>, String, String, String);

async fn tasks_list_inner(pool: &SqlitePool, repo_path: &str) -> Result<Vec<Task>, sqlx::Error> {
    let rows: Vec<TaskRow> = sqlx::query_as(
        "SELECT id, title, description, status, origin, created_at \
         FROM tasks WHERE repo_path = ? ORDER BY created_at DESC, id DESC",
    )
    .bind(repo_path)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(id, title, description, status, origin, created_at)| Task {
                id,
                title,
                description,
                status,
                origin,
                created_at,
            },
        )
        .collect())
}

/// List every task of `repo_path` from the shared cockpit database, newest
/// first. Returns an empty vec when the repo has no tasks yet.
#[tauri::command]
pub async fn tasks_list(
    repo_path: String,
    pool: tauri::State<'_, SqlitePool>,
) -> Result<Vec<Task>, String> {
    tasks_list_inner(pool.inner(), &repo_path)
        .await
        .map_err(|err| err.to_string())
}

/// Trim a user-supplied title, returning `None` when it is blank. A blank title
/// is the one input we reject outright — every other field has a sensible
/// default.
fn normalize_title(raw: &str) -> Option<&str> {
    let trimmed = raw.trim();
    (!trimmed.is_empty()).then_some(trimmed)
}

async fn tasks_create_inner(
    pool: &SqlitePool,
    repo_path: &str,
    title: &str,
    description: Option<&str>,
) -> Result<Task, sqlx::Error> {
    let id = Ulid::new().to_string();

    // `created_at` is stamped by SQLite (UTC, millisecond ISO-8601) and
    // `status`/`origin` carry the defaults for an app-authored task; `RETURNING`
    // hands the freshly inserted row straight back so the caller never re-reads.
    let (id, title, description, status, origin, created_at): TaskRow = sqlx::query_as(
        "INSERT INTO tasks (id, title, description, status, origin, repo_path, created_at) \
         VALUES (?, ?, ?, 'backlog', 'user', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) \
         RETURNING id, title, description, status, origin, created_at",
    )
    .bind(&id)
    .bind(title)
    .bind(description)
    .bind(repo_path)
    .fetch_one(pool)
    .await?;

    Ok(Task {
        id,
        title,
        description,
        status,
        origin,
        created_at,
    })
}

/// Create a `user`-origin task in `repo_path` with a `backlog` status, returning
/// the persisted row. Rejects a blank title; a blank description is stored as
/// `NULL`.
#[tauri::command]
pub async fn tasks_create(
    repo_path: String,
    title: String,
    description: Option<String>,
    pool: tauri::State<'_, SqlitePool>,
) -> Result<Task, String> {
    let title = normalize_title(&title).ok_or_else(|| "title must not be empty".to_string())?;
    let description = description
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    tasks_create_inner(pool.inner(), &repo_path, title, description)
        .await
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;
    use tauri::async_runtime::block_on;

    use super::*;

    fn fresh_pool() -> SqlitePool {
        block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("connect in-memory sqlite");
            sqlx::migrate!()
                .run(&pool)
                .await
                .expect("apply migrations to in-memory sqlite");
            pool
        })
    }

    async fn insert_task(
        pool: &SqlitePool,
        id: &str,
        title: &str,
        status: &str,
        origin: &str,
        repo_path: &str,
    ) {
        sqlx::query(
            "INSERT INTO tasks (id, title, description, status, origin, repo_path, created_at) \
             VALUES (?, ?, NULL, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        )
        .bind(id)
        .bind(title)
        .bind(status)
        .bind(origin)
        .bind(repo_path)
        .execute(pool)
        .await
        .expect("insert task row");
    }

    #[test]
    fn tasks_list_returns_only_rows_of_the_given_repo() {
        let pool = fresh_pool();
        block_on(async {
            insert_task(&pool, "a1", "repo-a one", "backlog", "user", "/repo/a").await;
            insert_task(&pool, "a2", "repo-a two", "in_progress", "track", "/repo/a").await;
            insert_task(&pool, "b1", "repo-b one", "done", "user", "/repo/b").await;

            let tasks = tasks_list_inner(&pool, "/repo/a")
                .await
                .expect("tasks_list should succeed");

            let ids: Vec<&str> = tasks.iter().map(|t| t.id.as_str()).collect();
            assert_eq!(ids.len(), 2, "only repo-a tasks are returned");
            assert!(ids.contains(&"a1") && ids.contains(&"a2"));
            assert!(!ids.contains(&"b1"), "repo-b task must be filtered out");
        });
    }

    #[test]
    fn tasks_list_is_empty_for_a_repo_without_tasks() {
        let pool = fresh_pool();
        block_on(async {
            insert_task(&pool, "b1", "repo-b one", "backlog", "user", "/repo/b").await;

            let tasks = tasks_list_inner(&pool, "/repo/unknown")
                .await
                .expect("tasks_list should succeed");

            assert!(tasks.is_empty());
        });
    }

    #[test]
    fn normalize_title_trims_and_rejects_blank() {
        assert_eq!(normalize_title("  hello  "), Some("hello"));
        assert_eq!(normalize_title("x"), Some("x"));
        assert_eq!(normalize_title(""), None);
        assert_eq!(normalize_title("   \t\n "), None);
    }

    #[test]
    fn tasks_create_persists_a_user_backlog_task() {
        let pool = fresh_pool();
        block_on(async {
            let created = tasks_create_inner(&pool, "/repo/a", "write docs", Some("the readme"))
                .await
                .expect("tasks_create should succeed");

            assert_eq!(created.title, "write docs");
            assert_eq!(created.description.as_deref(), Some("the readme"));
            assert_eq!(created.status, "backlog");
            assert_eq!(created.origin, "user");
            assert!(!created.created_at.is_empty());

            let listed = tasks_list_inner(&pool, "/repo/a")
                .await
                .expect("tasks_list should succeed");
            assert_eq!(listed, vec![created], "the created task is listed for its repo");
        });
    }

    #[test]
    fn tasks_create_stores_a_missing_description_as_null() {
        let pool = fresh_pool();
        block_on(async {
            let created = tasks_create_inner(&pool, "/repo/a", "no body", None)
                .await
                .expect("tasks_create should succeed");

            assert_eq!(created.description, None);
        });
    }

    #[test]
    fn tasks_create_does_not_leak_into_other_repos() {
        let pool = fresh_pool();
        block_on(async {
            tasks_create_inner(&pool, "/repo/a", "mine", None)
                .await
                .expect("tasks_create should succeed");

            let other = tasks_list_inner(&pool, "/repo/b")
                .await
                .expect("tasks_list should succeed");
            assert!(other.is_empty(), "a task created in /repo/a is invisible to /repo/b");
        });
    }

    #[test]
    fn tasks_list_serializes_fields_as_camel_case() {
        let pool = fresh_pool();
        block_on(async {
            insert_task(&pool, "a1", "only", "backlog", "user", "/repo/a").await;

            let tasks = tasks_list_inner(&pool, "/repo/a")
                .await
                .expect("tasks_list should succeed");
            let json = serde_json::to_string(&tasks[0]).expect("serialize task");

            assert!(json.contains("\"createdAt\""), "created_at -> createdAt");
            assert!(!json.contains("repo_path"), "repo_path is not serialized");
            assert!(json.contains("\"origin\":\"user\""));
        });
    }
}
