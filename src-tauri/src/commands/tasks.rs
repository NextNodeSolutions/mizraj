use sqlx::SqlitePool;

/// A task row scoped to a single repository.
///
/// `description` is nullable in the schema (`0002_tasks`), so it maps to an
/// `Option`. `status` is constrained by a `CHECK` to the
/// `backlog | todo | in_progress | done` enum, so the frontend can narrow it
/// safely.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TaskEntry {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub repo_path: String,
    pub created_at: String,
}

/// List the tasks of a single repository, oldest first.
///
/// Filtering happens on `repo_path`, which is the leading column of
/// `idx_tasks_repo_path_status`, so the lookup uses that index. `id` is a tie
/// breaker for rows sharing a `created_at` so the order is deterministic.
async fn fetch_tasks(pool: &SqlitePool, repo_path: &str) -> Result<Vec<TaskEntry>, String> {
    sqlx::query_as::<_, TaskEntry>(
        "SELECT id, title, description, status, repo_path, created_at \
         FROM tasks WHERE repo_path = ? ORDER BY created_at, id",
    )
    .bind(repo_path)
    .fetch_all(pool)
    .await
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn tasks_list(
    repo_path: String,
    pool: tauri::State<'_, SqlitePool>,
) -> Result<Vec<TaskEntry>, String> {
    fetch_tasks(&pool, &repo_path).await
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
        repo_path: &str,
        created_at: &str,
    ) {
        sqlx::query(
            "INSERT INTO tasks (id, title, description, status, repo_path, created_at) \
             VALUES (?, ?, NULL, ?, ?, ?)",
        )
        .bind(id)
        .bind(title)
        .bind(status)
        .bind(repo_path)
        .bind(created_at)
        .execute(pool)
        .await
        .expect("insert task");
    }

    #[test]
    fn returns_only_tasks_of_the_requested_repo() {
        let pool = fresh_pool();
        block_on(async {
            insert_task(&pool, "a", "A", "todo", "/repo/one", "2026-05-30T10:00:00Z").await;
            insert_task(&pool, "b", "B", "done", "/repo/one", "2026-05-30T11:00:00Z").await;
            insert_task(
                &pool,
                "c",
                "C",
                "backlog",
                "/repo/two",
                "2026-05-30T12:00:00Z",
            )
            .await;

            let tasks = fetch_tasks(&pool, "/repo/one").await.expect("fetch_tasks");
            let ids: Vec<&str> = tasks.iter().map(|t| t.id.as_str()).collect();
            assert_eq!(ids, ["a", "b"]);
        });
    }

    #[test]
    fn orders_tasks_oldest_first() {
        let pool = fresh_pool();
        block_on(async {
            insert_task(
                &pool,
                "late",
                "Late",
                "todo",
                "/repo",
                "2026-05-30T15:00:00Z",
            )
            .await;
            insert_task(
                &pool,
                "early",
                "Early",
                "todo",
                "/repo",
                "2026-05-30T09:00:00Z",
            )
            .await;

            let tasks = fetch_tasks(&pool, "/repo").await.expect("fetch_tasks");
            let ids: Vec<&str> = tasks.iter().map(|t| t.id.as_str()).collect();
            assert_eq!(ids, ["early", "late"]);
        });
    }

    #[test]
    fn returns_empty_vec_when_repo_has_no_tasks() {
        let pool = fresh_pool();
        block_on(async {
            insert_task(&pool, "a", "A", "todo", "/other", "2026-05-30T10:00:00Z").await;

            let tasks = fetch_tasks(&pool, "/repo").await.expect("fetch_tasks");
            assert!(tasks.is_empty());
        });
    }

    #[test]
    fn maps_null_description_to_none() {
        let pool = fresh_pool();
        block_on(async {
            insert_task(&pool, "a", "A", "todo", "/repo", "2026-05-30T10:00:00Z").await;

            let tasks = fetch_tasks(&pool, "/repo").await.expect("fetch_tasks");
            assert_eq!(tasks[0].description, None);
        });
    }

    #[test]
    fn serializes_columns_to_camel_case() {
        let entry = TaskEntry {
            id: "a".into(),
            title: "A".into(),
            description: Some("desc".into()),
            status: "todo".into(),
            repo_path: "/repo".into(),
            created_at: "2026-05-30T10:00:00Z".into(),
        };
        let json = serde_json::to_value(&entry).expect("serialize");
        assert!(json.get("repoPath").is_some());
        assert!(json.get("createdAt").is_some());
        assert!(json.get("repo_path").is_none());
    }
}
