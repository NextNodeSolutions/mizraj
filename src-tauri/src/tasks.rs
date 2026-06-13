use std::collections::HashMap;

use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqlitePool};
use ulid::Ulid;

use crate::db::Db;

/// A task row from the active project's progress database.
///
/// Both user-authored tasks (origin `user`, flat — `identifier`/`milestoneId`/
/// `trackId`/`step` all `None`) and track-derived tasks (origin `track`) live in
/// the same table; `origin` discriminates. `status` is one of `backlog`,
/// `in_progress`, `done`, `blocked` and `origin` one of `user`, `track` — both
/// enforced by the schema. `sliceOf` is assembled from the `task_slice_of`
/// junction. `createdAt` is an ISO-8601 UTC string produced by SQLite.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub identifier: Option<String>,
    pub origin: String,
    pub milestone_id: Option<String>,
    pub track_id: Option<String>,
    pub step: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub done_when: Option<String>,
    pub size: Option<String>,
    pub slice_of: Vec<String>,
    pub sink_id: Option<String>,
    pub position: i64,
    pub status: String,
    pub blocked_reason: Option<String>,
    pub commit_sha: Option<String>,
    pub created_at: String,
}

/// A track and its ordered tasks, nested under a milestone in the overview.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackGroup {
    pub id: String,
    pub branch: String,
    pub tasks: Vec<Task>,
}

/// A milestone with its `needs` edges and ordered tracks.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MilestoneGroup {
    pub id: String,
    pub number: i64,
    pub demo: String,
    pub skeleton: bool,
    pub needs: Vec<String>,
    pub tracks: Vec<TrackGroup>,
}

/// The full task view of a project: the structural milestone→track→task tree
/// plus the flat list of user-authored tasks.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub milestones: Vec<MilestoneGroup>,
    pub user_tasks: Vec<Task>,
}

/// The `tasks` columns selected (and RETURNED) everywhere, in one place so the
/// read path and the write path map identical row shapes.
const TASK_COLUMNS: &str = "id, identifier, origin, milestone_id, track_id, step, \
     title, description, done_when, size, sink_id, position, status, \
     blocked_reason, commit_sha, created_at";

/// Map a `tasks` row (selecting [`TASK_COLUMNS`]) into a [`Task`]. `slice_of`
/// starts empty — it is merged in by the caller from the `task_slice_of`
/// junction, so a single batched read covers every task instead of N+1 queries.
fn task_from_row(row: &SqliteRow) -> Result<Task, sqlx::Error> {
    Ok(Task {
        id: row.try_get("id")?,
        identifier: row.try_get("identifier")?,
        origin: row.try_get("origin")?,
        milestone_id: row.try_get("milestone_id")?,
        track_id: row.try_get("track_id")?,
        step: row.try_get("step")?,
        title: row.try_get("title")?,
        description: row.try_get("description")?,
        done_when: row.try_get("done_when")?,
        size: row.try_get("size")?,
        slice_of: Vec::new(),
        sink_id: row.try_get("sink_id")?,
        position: row.try_get("position")?,
        status: row.try_get("status")?,
        blocked_reason: row.try_get("blocked_reason")?,
        commit_sha: row.try_get("commit_sha")?,
        created_at: row.try_get("created_at")?,
    })
}

/// Run a two-column `SELECT key, value … ORDER BY key, value` and fold the rows
/// into a `key -> [value]` map in one batched pass. Shared by the `slice_of` and
/// milestone-`needs` lookups so neither does an N+1 round-trip.
async fn group_pairs(
    pool: &SqlitePool,
    sql: &str,
) -> Result<HashMap<String, Vec<String>>, sqlx::Error> {
    let rows = sqlx::query(sql).fetch_all(pool).await?;
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for row in &rows {
        let key: String = row.try_get(0)?;
        let value: String = row.try_get(1)?;
        map.entry(key).or_default().push(value);
    }
    Ok(map)
}

async fn tasks_overview_inner(pool: &SqlitePool) -> Result<Overview, sqlx::Error> {
    // task_id -> [decision_id] and milestone_id -> [needs_id], each a single
    // batched read folded into a grouped map (no N+1). Both are drained by
    // `remove` below since every key is consumed at most once.
    let mut slice_of = group_pairs(
        pool,
        "SELECT task_id, decision_id FROM task_slice_of ORDER BY task_id, decision_id",
    )
    .await?;
    let mut needs = group_pairs(
        pool,
        "SELECT milestone_id, needs_id FROM milestone_needs ORDER BY milestone_id, needs_id",
    )
    .await?;

    // track tasks, grouped by (milestone_id, track_id), each with its slice_of
    let track_task_rows = sqlx::query(&format!(
        "SELECT {TASK_COLUMNS} FROM tasks WHERE origin = 'track' \
         ORDER BY milestone_id, track_id, position, step"
    ))
    .fetch_all(pool)
    .await?;
    let mut tasks_by_track: HashMap<(String, String), Vec<Task>> = HashMap::new();
    for row in &track_task_rows {
        let mut task = task_from_row(row)?;
        if let Some(decisions) = slice_of.remove(&task.id) {
            task.slice_of = decisions;
        }
        let key = (
            task.milestone_id.clone().unwrap_or_default(),
            task.track_id.clone().unwrap_or_default(),
        );
        tasks_by_track.entry(key).or_default().push(task);
    }

    let track_rows =
        sqlx::query("SELECT milestone_id, id, branch, position FROM tracks ORDER BY position, id")
            .fetch_all(pool)
            .await?;
    let milestone_rows = sqlx::query(
        "SELECT id, number, demo, skeleton, position FROM milestones ORDER BY position, number",
    )
    .fetch_all(pool)
    .await?;

    // Bucket tracks under their milestone in one pass, preserving the global
    // (position, id) order — same grouping shape as slice_of/needs/tasks rather
    // than re-scanning every track per milestone.
    let mut tracks_by_milestone: HashMap<String, Vec<(String, String)>> = HashMap::new();
    for t in &track_rows {
        let milestone_id: String = t.try_get("milestone_id")?;
        let track_id: String = t.try_get("id")?;
        let branch: String = t.try_get("branch")?;
        tracks_by_milestone
            .entry(milestone_id)
            .or_default()
            .push((track_id, branch));
    }

    let mut milestones = Vec::with_capacity(milestone_rows.len());
    for m in &milestone_rows {
        let milestone_id: String = m.try_get("id")?;
        let skeleton: i64 = m.try_get("skeleton")?;
        let tracks = tracks_by_milestone
            .remove(&milestone_id)
            .unwrap_or_default()
            .into_iter()
            .map(|(track_id, branch)| {
                let tasks = tasks_by_track
                    .remove(&(milestone_id.clone(), track_id.clone()))
                    .unwrap_or_default();
                TrackGroup {
                    id: track_id,
                    branch,
                    tasks,
                }
            })
            .collect();
        milestones.push(MilestoneGroup {
            id: milestone_id.clone(),
            number: m.try_get("number")?,
            demo: m.try_get("demo")?,
            skeleton: skeleton != 0,
            needs: needs.remove(&milestone_id).unwrap_or_default(),
            tracks,
        });
    }

    let user_rows = sqlx::query(&format!(
        "SELECT {TASK_COLUMNS} FROM tasks WHERE origin = 'user' \
         ORDER BY created_at DESC, id DESC"
    ))
    .fetch_all(pool)
    .await?;
    let mut user_tasks = Vec::with_capacity(user_rows.len());
    for row in &user_rows {
        let mut task = task_from_row(row)?;
        if let Some(decisions) = slice_of.remove(&task.id) {
            task.slice_of = decisions;
        }
        user_tasks.push(task);
    }

    Ok(Overview {
        milestones,
        user_tasks,
    })
}

/// The structural milestone→track→task tree plus the flat user tasks of
/// `repo_path`'s project. Returns empty collections when the project has no
/// tasks yet. The repo is explicit (MP1): two repos can be read in parallel,
/// each from its own pool, without touching the active-project preference.
#[tauri::command]
pub async fn tasks_overview(
    repo_path: String,
    db: tauri::State<'_, Db>,
) -> Result<Overview, String> {
    let pool = db.pool_for(std::path::Path::new(&repo_path)).await?;
    tasks_overview_inner(&pool)
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

/// Trim a user-supplied description, collapsing a blank one to `None` so it is
/// stored as SQL `NULL`. Unlike a title, an empty description is valid — it just
/// means "no body". Shared by create and update so both normalize identically.
fn normalize_description(raw: Option<&str>) -> Option<&str> {
    raw.map(str::trim).filter(|value| !value.is_empty())
}

/// The status vocabulary enforced by the schema's CHECK constraint. Mirrored
/// here so an out-of-enum status is rejected with a clear message before the
/// database round-trip, rather than surfacing as an opaque constraint failure.
const TASK_STATUSES: [&str; 4] = ["backlog", "in_progress", "done", "blocked"];

fn is_valid_status(status: &str) -> bool {
    TASK_STATUSES.contains(&status)
}

async fn tasks_create_inner(
    pool: &SqlitePool,
    title: &str,
    description: Option<&str>,
) -> Result<Task, sqlx::Error> {
    let id = Ulid::new().to_string();

    // A user task is flat: only id/title/description are supplied; origin is
    // 'user', status defaults to 'backlog', the structural columns stay NULL,
    // and `created_at` is stamped by SQLite (UTC, millisecond ISO-8601).
    // `RETURNING` hands the freshly inserted row straight back.
    let row = sqlx::query(&format!(
        "INSERT INTO tasks (id, origin, title, description, created_at) \
         VALUES (?, 'user', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) \
         RETURNING {TASK_COLUMNS}"
    ))
    .bind(&id)
    .bind(title)
    .bind(description)
    .fetch_one(pool)
    .await?;

    task_from_row(&row)
}

/// Create a flat `user`-origin task with a `backlog` status, returning the
/// persisted row. Rejects a blank title; a blank description is stored as
/// `NULL`.
#[tauri::command]
pub async fn tasks_create(
    repo_path: String,
    title: String,
    description: Option<String>,
    db: tauri::State<'_, Db>,
) -> Result<Task, String> {
    let title = normalize_title(&title).ok_or_else(|| "title must not be empty".to_string())?;
    let description = normalize_description(description.as_deref());

    let pool = db.pool_for(std::path::Path::new(&repo_path)).await?;
    tasks_create_inner(&pool, title, description)
        .await
        .map_err(|err| err.to_string())
}

async fn tasks_update_inner(
    pool: &SqlitePool,
    id: &str,
    title: &str,
    description: Option<&str>,
    status: &str,
) -> Result<Task, sqlx::Error> {
    // `RETURNING` hands back the updated row so the caller never re-reads; a
    // non-existent id matches no row and surfaces as `RowNotFound`.
    let row = sqlx::query(&format!(
        "UPDATE tasks SET title = ?, description = ?, status = ? WHERE id = ? \
         RETURNING {TASK_COLUMNS}"
    ))
    .bind(title)
    .bind(description)
    .bind(status)
    .bind(id)
    .fetch_one(pool)
    .await?;

    task_from_row(&row)
}

/// Update the editable fields of a task — title, description, status — and
/// return the persisted row. Callers send the task's full editable state, so a
/// content edit never clobbers a status change and vice versa. Rejects a blank
/// title and a status outside the enforced enum before touching the database; a
/// blank description is stored as `NULL` and an unknown id surfaces as an error.
#[tauri::command]
pub async fn tasks_update(
    repo_path: String,
    id: String,
    title: String,
    description: Option<String>,
    status: String,
    db: tauri::State<'_, Db>,
) -> Result<Task, String> {
    let title = normalize_title(&title).ok_or_else(|| "title must not be empty".to_string())?;
    let description = normalize_description(description.as_deref());

    if !is_valid_status(&status) {
        return Err(format!("unknown status: {status}"));
    }

    let pool = db.pool_for(std::path::Path::new(&repo_path)).await?;
    tasks_update_inner(&pool, &id, title, description, &status)
        .await
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use tauri::async_runtime::block_on;

    use super::*;

    fn fresh_pool() -> SqlitePool {
        block_on(crate::db::connect_for_test())
    }

    async fn insert_user_task(pool: &SqlitePool, id: &str, title: &str, status: &str) {
        sqlx::query(
            "INSERT INTO tasks (id, origin, title, status, created_at) \
             VALUES (?, 'user', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        )
        .bind(id)
        .bind(title)
        .bind(status)
        .execute(pool)
        .await
        .expect("insert user task row");
    }

    /// Seed a two-milestone plan with one track, one track task, its slice_of,
    /// and a `needs` edge — enough to exercise the grouped overview.
    async fn seed_plan(pool: &SqlitePool) {
        sqlx::query("INSERT INTO milestones (id, number, demo, skeleton, position) VALUES ('M1', 1, 'walking skeleton', 1, 0)")
            .execute(pool).await.expect("insert M1");
        sqlx::query("INSERT INTO milestones (id, number, demo, skeleton, position) VALUES ('M2', 2, 'thicken it', 0, 1)")
            .execute(pool).await.expect("insert M2");
        sqlx::query("INSERT INTO milestone_needs (milestone_id, needs_id) VALUES ('M2', 'M1')")
            .execute(pool)
            .await
            .expect("insert needs edge");
        sqlx::query("INSERT INTO tracks (milestone_id, id, branch, position) VALUES ('M1', 'A', 'feat/skeleton', 0)")
            .execute(pool).await.expect("insert track");
        sqlx::query(
            "INSERT INTO tasks (id, identifier, origin, milestone_id, track_id, step, title, size, position, status, created_at) \
             VALUES ('M1.A-01', '[M1.A-01]', 'track', 'M1', 'A', '01', 'Spawn process', 'I4', 0, 'backlog', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        )
        .execute(pool).await.expect("insert track task");
        for decision in ["D2", "D3"] {
            sqlx::query("INSERT INTO task_slice_of (task_id, decision_id) VALUES ('M1.A-01', ?)")
                .bind(decision)
                .execute(pool)
                .await
                .expect("insert slice_of");
        }
    }

    #[test]
    fn normalize_title_trims_and_rejects_blank() {
        assert_eq!(normalize_title("  hello  "), Some("hello"));
        assert_eq!(normalize_title("x"), Some("x"));
        assert_eq!(normalize_title(""), None);
        assert_eq!(normalize_title("   \t\n "), None);
    }

    #[test]
    fn normalize_description_trims_and_nulls_blank() {
        assert_eq!(normalize_description(Some("  hi  ")), Some("hi"));
        assert_eq!(normalize_description(Some("")), None);
        assert_eq!(normalize_description(Some("   \t ")), None);
        assert_eq!(normalize_description(None), None);
    }

    #[test]
    fn is_valid_status_accepts_the_enum_and_rejects_others() {
        assert!(is_valid_status("backlog"));
        assert!(is_valid_status("in_progress"));
        assert!(is_valid_status("done"));
        assert!(is_valid_status("blocked"));
        assert!(!is_valid_status("todo"));
        assert!(!is_valid_status(""));
        assert!(!is_valid_status("Done"));
    }

    #[test]
    fn tasks_create_persists_a_flat_user_backlog_task() {
        let pool = fresh_pool();
        block_on(async {
            let created = tasks_create_inner(&pool, "write docs", Some("the readme"))
                .await
                .expect("tasks_create should succeed");

            assert_eq!(created.title, "write docs");
            assert_eq!(created.description.as_deref(), Some("the readme"));
            assert_eq!(created.status, "backlog");
            assert_eq!(created.origin, "user");
            assert_eq!(
                created.identifier, None,
                "a user task is flat — no identifier"
            );
            assert_eq!(created.milestone_id, None);
            assert_eq!(created.track_id, None);
            assert!(created.slice_of.is_empty());
            assert!(!created.created_at.is_empty());

            let overview = tasks_overview_inner(&pool)
                .await
                .expect("overview should succeed");
            assert_eq!(
                overview.user_tasks,
                vec![created],
                "the created task is listed flat"
            );
            assert!(overview.milestones.is_empty(), "no plan ingested yet");
        });
    }

    #[test]
    fn tasks_create_stores_a_missing_description_as_null() {
        let pool = fresh_pool();
        block_on(async {
            let created = tasks_create_inner(&pool, "no body", None)
                .await
                .expect("tasks_create should succeed");
            assert_eq!(created.description, None);
        });
    }

    #[test]
    fn tasks_update_changes_status_and_is_reflected() {
        let pool = fresh_pool();
        block_on(async {
            insert_user_task(&pool, "a1", "ship it", "backlog").await;

            let updated = tasks_update_inner(&pool, "a1", "ship it", None, "in_progress")
                .await
                .expect("tasks_update should succeed");
            assert_eq!(updated.status, "in_progress");

            let overview = tasks_overview_inner(&pool).await.expect("overview");
            assert_eq!(overview.user_tasks.len(), 1);
            assert_eq!(overview.user_tasks[0].status, "in_progress");
        });
    }

    #[test]
    fn tasks_update_changes_title_and_description() {
        let pool = fresh_pool();
        block_on(async {
            insert_user_task(&pool, "a1", "old title", "backlog").await;

            let updated =
                tasks_update_inner(&pool, "a1", "new title", Some("a fresh body"), "backlog")
                    .await
                    .expect("tasks_update should succeed");
            assert_eq!(updated.title, "new title");
            assert_eq!(updated.description.as_deref(), Some("a fresh body"));
        });
    }

    #[test]
    fn tasks_update_clears_a_blanked_description_to_null() {
        let pool = fresh_pool();
        block_on(async {
            insert_user_task(&pool, "a1", "has body", "backlog").await;
            tasks_update_inner(&pool, "a1", "has body", Some("body"), "backlog")
                .await
                .expect("seed a description");

            let cleared = tasks_update_inner(&pool, "a1", "has body", None, "backlog")
                .await
                .expect("tasks_update should succeed");
            assert_eq!(
                cleared.description, None,
                "an emptied description becomes NULL"
            );
        });
    }

    #[test]
    fn tasks_update_errors_for_an_unknown_id() {
        let pool = fresh_pool();
        block_on(async {
            let result = tasks_update_inner(&pool, "missing", "ghost", None, "done").await;
            assert!(result.is_err(), "updating a non-existent task is an error");
        });
    }

    #[test]
    fn overview_groups_milestones_tracks_and_tasks() {
        let pool = fresh_pool();
        block_on(async {
            seed_plan(&pool).await;
            insert_user_task(&pool, "u1", "user task", "backlog").await;

            let overview = tasks_overview_inner(&pool).await.expect("overview");

            // Milestones in order, with the needs DAG.
            assert_eq!(overview.milestones.len(), 2);
            let m1 = &overview.milestones[0];
            let m2 = &overview.milestones[1];
            assert_eq!(m1.id, "M1");
            assert!(m1.skeleton, "M1 is the walking skeleton");
            assert!(m1.needs.is_empty());
            assert_eq!(m2.id, "M2");
            assert!(!m2.skeleton);
            assert_eq!(m2.needs, vec!["M1".to_string()]);

            // Track + its task, with the derived identifier and slice_of.
            assert_eq!(m1.tracks.len(), 1);
            let track = &m1.tracks[0];
            assert_eq!(track.id, "A");
            assert_eq!(track.branch, "feat/skeleton");
            assert_eq!(track.tasks.len(), 1);
            let task = &track.tasks[0];
            assert_eq!(task.origin, "track");
            assert_eq!(task.identifier.as_deref(), Some("[M1.A-01]"));
            assert_eq!(task.step.as_deref(), Some("01"));
            assert_eq!(task.size.as_deref(), Some("I4"));
            assert_eq!(task.slice_of, vec!["D2".to_string(), "D3".to_string()]);

            // User tasks stay flat, outside the tree.
            assert_eq!(overview.user_tasks.len(), 1);
            assert_eq!(overview.user_tasks[0].title, "user task");
            assert_eq!(overview.user_tasks[0].identifier, None);
        });
    }

    #[test]
    fn task_serializes_fields_as_camel_case_without_repo_path() {
        let pool = fresh_pool();
        block_on(async {
            seed_plan(&pool).await;
            let overview = tasks_overview_inner(&pool).await.expect("overview");
            let task = &overview.milestones[0].tracks[0].tasks[0];
            let json = serde_json::to_string(task).expect("serialize task");

            for field in [
                "\"identifier\"",
                "\"milestoneId\"",
                "\"trackId\"",
                "\"doneWhen\"",
                "\"sliceOf\"",
                "\"blockedReason\"",
                "\"commitSha\"",
                "\"createdAt\"",
            ] {
                assert!(json.contains(field), "expected {field} in {json}");
            }
            assert!(!json.contains("repo_path"), "repo_path must not exist");
            assert!(!json.contains("repoPath"), "repoPath must not exist");
        });
    }
}
