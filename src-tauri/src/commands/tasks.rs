use std::fs;
use std::path::{Path, PathBuf};

/// Lifecycle state of a track task, read from the `progress.md` checkbox:
/// `[x]` done, `[~]` in progress, `[ ]` pending. A pending line flagged with a
/// leading `⚠ ` is reported as blocked.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    Done,
    InProgress,
    Pending,
    Blocked,
}

/// A single task of the active milestone track.
///
/// `identifier` is the bare `M<n>.<TRACK>-<step>` tag (no brackets). `commit`
/// is the short SHA appended to a done line (`- abc1234`), absent otherwise.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackTask {
    pub identifier: String,
    pub title: String,
    pub state: TaskState,
    pub commit: Option<String>,
}

/// The active milestone track, parsed from `docs/plans/<slug>/progress.md`.
///
/// `title` is the `# ` heading, `milestone` the `Milestone:` line.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub title: String,
    pub milestone: String,
    pub tasks: Vec<TrackTask>,
}

const MIN_SHA_LEN: usize = 7;

/// Split a task body into `(title, commit)`. A trailing ` - <hex>` suffix of at
/// least 7 hex chars is treated as the commit SHA; anything else (e.g. a blocked
/// reason) stays part of the title.
fn split_title_commit(body: &str) -> (String, Option<String>) {
    if let Some((title, suffix)) = body.rsplit_once(" - ") {
        if suffix.len() >= MIN_SHA_LEN && suffix.chars().all(|c| c.is_ascii_hexdigit()) {
            return (title.trim().to_string(), Some(suffix.to_string()));
        }
    }
    (body.trim().to_string(), None)
}

/// Parse a single checklist line, or `None` if it is not a task line.
fn parse_task_line(line: &str) -> Option<TrackTask> {
    let rest = line.strip_prefix("- [")?;
    let (mark, rest) = rest.split_once("] ")?;

    let (state, rest) = match rest.strip_prefix("⚠ ") {
        Some(blocked) => (TaskState::Blocked, blocked),
        None => {
            let state = match mark {
                "x" => TaskState::Done,
                "~" => TaskState::InProgress,
                " " => TaskState::Pending,
                _ => return None,
            };
            (state, rest)
        }
    };

    let rest = rest.strip_prefix('[')?;
    let (identifier, body) = rest.split_once(']')?;
    let (title, commit) = split_title_commit(body.trim());

    Some(TrackTask {
        identifier: identifier.to_string(),
        title,
        state,
        commit,
    })
}

/// Parse a `progress.md` document into a [`Track`].
fn parse_track(content: &str) -> Track {
    let mut title = String::new();
    let mut milestone = String::new();
    let mut tasks = Vec::new();

    for line in content.lines() {
        if title.is_empty() {
            if let Some(heading) = line.strip_prefix("# ") {
                title = heading.trim().to_string();
                continue;
            }
        }
        if milestone.is_empty() {
            if let Some(value) = line.strip_prefix("Milestone:") {
                milestone = value.trim().to_string();
                continue;
            }
        }
        if let Some(task) = parse_task_line(line) {
            tasks.push(task);
        }
    }

    Track {
        title,
        milestone,
        tasks,
    }
}

/// Locate the active track's `progress.md` under `<repo>/docs/plans/*/`.
///
/// The tracker store holds one directory per slug; the active track is the one
/// carrying a `progress.md`. When more than one is present the lexicographically
/// smallest path is picked so the choice is deterministic.
fn find_progress_file(repo_path: &Path) -> Option<PathBuf> {
    let plans_dir = repo_path.join("docs").join("plans");
    fs::read_dir(plans_dir)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path().join("progress.md"))
        .filter(|path| path.is_file())
        .min()
}

/// Read the active milestone track of `repo_path`, or `None` when the repo has
/// no `docs/plans/<slug>/progress.md` yet.
#[tauri::command]
pub async fn track_read(repo_path: String) -> Result<Option<Track>, String> {
    let Some(progress) = find_progress_file(Path::new(&repo_path)) else {
        return Ok(None);
    };
    let content = fs::read_to_string(&progress).map_err(|err| err.to_string())?;
    Ok(Some(parse_track(&content)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "# M4.A — agent-cockpit\n\
\n\
Started: 2026-05-30T12:41:51Z\n\
Slug: agent-cockpit\n\
Milestone: M4 — La vue Tasks affiche le /track actif.\n\
\n\
## Tasks\n\
\n\
- [x] [M4.A-01] Parser le track actif - b8fb5a7\n\
- [~] [M4.A-02] Afficher le track\n\
- [ ] [M4.A-03] Rafraîchir au focus\n\
- [ ] ⚠ [M4.A-04] Tâche bloquée - en attente d'une spec\n";

    #[test]
    fn parses_heading_and_milestone() {
        let track = parse_track(SAMPLE);
        assert_eq!(track.title, "M4.A — agent-cockpit");
        assert_eq!(track.milestone, "M4 — La vue Tasks affiche le /track actif.");
    }

    #[test]
    fn parses_every_task_with_its_state() {
        let track = parse_track(SAMPLE);
        let states: Vec<&TaskState> = track.tasks.iter().map(|t| &t.state).collect();
        assert_eq!(
            states,
            [
                &TaskState::Done,
                &TaskState::InProgress,
                &TaskState::Pending,
                &TaskState::Blocked,
            ]
        );
    }

    #[test]
    fn extracts_the_commit_sha_of_done_tasks() {
        let track = parse_track(SAMPLE);
        assert_eq!(track.tasks[0].identifier, "M4.A-01");
        assert_eq!(track.tasks[0].title, "Parser le track actif");
        assert_eq!(track.tasks[0].commit.as_deref(), Some("b8fb5a7"));
    }

    #[test]
    fn leaves_commit_none_when_absent() {
        let track = parse_track(SAMPLE);
        assert_eq!(track.tasks[1].commit, None);
        assert_eq!(track.tasks[1].title, "Afficher le track");
    }

    #[test]
    fn keeps_blocked_reason_in_the_title() {
        let track = parse_track(SAMPLE);
        let blocked = &track.tasks[3];
        assert_eq!(blocked.identifier, "M4.A-04");
        assert_eq!(blocked.state, TaskState::Blocked);
        assert_eq!(blocked.title, "Tâche bloquée - en attente d'une spec");
        assert_eq!(blocked.commit, None);
    }

    #[test]
    fn ignores_non_task_lines() {
        assert!(parse_task_line("## Tasks").is_none());
        assert!(parse_task_line("Slug: agent-cockpit").is_none());
        assert!(parse_task_line("- not a checkbox").is_none());
    }

    #[test]
    fn find_progress_file_picks_the_track_under_docs_plans() {
        let repo = tempfile::tempdir().expect("tempdir");
        let plan_dir = repo.path().join("docs").join("plans").join("agent-cockpit");
        fs::create_dir_all(&plan_dir).expect("create plan dir");
        let progress = plan_dir.join("progress.md");
        fs::write(&progress, SAMPLE).expect("write progress");

        assert_eq!(find_progress_file(repo.path()), Some(progress));
    }

    #[test]
    fn find_progress_file_is_none_without_a_track() {
        let repo = tempfile::tempdir().expect("tempdir");
        assert_eq!(find_progress_file(repo.path()), None);
    }
}
