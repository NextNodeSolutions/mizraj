use crate::db::Db;

mod store;

use store::{tasks_create_inner, tasks_overview_inner, tasks_update_inner};

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

/// The structural milestone→track→task tree plus the flat user tasks of
/// `repo_path`'s project. Returns empty collections when the project has no
/// tasks yet. The repo is explicit (MP1): two repos can be read in parallel,
/// each from its own pool, without touching the active-project preference.
#[tauri::command]
pub async fn tasks_overview(
    repo_path: String,
    db: tauri::State<'_, Db>,
) -> Result<Overview, String> {
    let repo_path = crate::project::validate_repo_path(&repo_path)?;
    let pool = db.pool_for(&repo_path).await?;
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

    let repo_path = crate::project::validate_repo_path(&repo_path)?;
    let pool = db.pool_for(&repo_path).await?;
    tasks_create_inner(&pool, title, description)
        .await
        .map_err(|err| err.to_string())
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

    let repo_path = crate::project::validate_repo_path(&repo_path)?;
    let pool = db.pool_for(&repo_path).await?;
    tasks_update_inner(&pool, &id, title, description, &status)
        .await
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
