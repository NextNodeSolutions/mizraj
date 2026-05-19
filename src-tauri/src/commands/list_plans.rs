use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanEntry {
    pub kind: String,
    pub slug: String,
    pub path: String,
    pub mtime: u64,
}

#[tauri::command]
pub fn list_plans(repo_path: String) -> Result<Vec<PlanEntry>, String> {
    let root = PathBuf::from(&repo_path);
    let mut entries = Vec::new();

    collect_interviews(&root, &mut entries)?;
    collect_plans(&root, &mut entries)?;

    entries.sort_by(|a, b| b.mtime.cmp(&a.mtime).then_with(|| a.slug.cmp(&b.slug)));
    Ok(entries)
}

fn collect_interviews(root: &Path, entries: &mut Vec<PlanEntry>) -> Result<(), String> {
    let interviews_dir = root.join("docs").join("interviews");
    if !interviews_dir.is_dir() {
        return Ok(());
    }

    let read = fs::read_dir(&interviews_dir).map_err(|e| e.to_string())?;
    for entry in read {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if !file_type.is_dir() {
            continue;
        }
        let interview_dir = entry.path();
        let plan_html = interview_dir.join("plan.html");
        let Ok(meta) = fs::metadata(&plan_html) else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let Some(slug) = file_name_str(&interview_dir) else {
            continue;
        };
        entries.push(PlanEntry {
            kind: "interview".to_string(),
            slug,
            path: plan_html.to_string_lossy().into_owned(),
            mtime: mtime_from(&meta)?,
        });
    }
    Ok(())
}

fn collect_plans(root: &Path, entries: &mut Vec<PlanEntry>) -> Result<(), String> {
    let plans_dir = root.join("docs").join("plans");
    if !plans_dir.is_dir() {
        return Ok(());
    }

    let read = fs::read_dir(&plans_dir).map_err(|e| e.to_string())?;
    for entry in read {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if !file_type.is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("html") {
            continue;
        }
        let Some(slug) = path.file_stem().and_then(|s| s.to_str()).map(str::to_string) else {
            continue;
        };
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        entries.push(PlanEntry {
            kind: "plan".to_string(),
            slug,
            path: path.to_string_lossy().into_owned(),
            mtime: mtime_from(&meta)?,
        });
    }
    Ok(())
}

fn file_name_str(path: &Path) -> Option<String> {
    path.file_name().and_then(|s| s.to_str()).map(str::to_string)
}

fn mtime_from(meta: &fs::Metadata) -> Result<u64, String> {
    let modified = meta.modified().map_err(|e| e.to_string())?;
    let duration = modified
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    Ok(duration.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_entries_for_interview_and_plan_artifacts() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();

        let interview_dir = root.join("docs/interviews/agent-cockpit");
        fs::create_dir_all(&interview_dir).expect("mkdir interview");
        fs::write(
            interview_dir.join("plan.html"),
            "<html><head><title>Interview</title></head></html>",
        )
        .expect("write interview plan.html");

        let plans_dir = root.join("docs/plans");
        fs::create_dir_all(&plans_dir).expect("mkdir plans");
        fs::write(
            plans_dir.join("2026-05-15-agent-cockpit.html"),
            "<html><head><title>Plan</title></head></html>",
        )
        .expect("write plan html");

        let entries = list_plans(root.to_string_lossy().into_owned()).expect("list_plans");
        assert_eq!(entries.len(), 2);

        let interview = entries
            .iter()
            .find(|e| e.kind == "interview")
            .expect("interview entry");
        assert_eq!(interview.slug, "agent-cockpit");
        assert!(interview.path.ends_with("plan.html"));
        assert!(interview.mtime > 0);

        let plan = entries
            .iter()
            .find(|e| e.kind == "plan")
            .expect("plan entry");
        assert_eq!(plan.slug, "2026-05-15-agent-cockpit");
        assert!(plan.path.ends_with("2026-05-15-agent-cockpit.html"));
        assert!(plan.mtime > 0);
    }

    #[test]
    fn returns_empty_when_docs_missing() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let entries = list_plans(tmp.path().to_string_lossy().into_owned()).expect("list_plans");
        assert!(entries.is_empty());
    }

    #[test]
    fn ignores_non_html_files_in_plans_dir() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let plans_dir = tmp.path().join("docs/plans");
        fs::create_dir_all(&plans_dir).expect("mkdir plans");
        fs::write(plans_dir.join("notes.md"), "hello").expect("write notes.md");
        fs::write(plans_dir.join("real.html"), "<html></html>").expect("write real.html");

        let entries = list_plans(tmp.path().to_string_lossy().into_owned()).expect("list_plans");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].slug, "real");
    }

    #[test]
    fn ignores_interview_dirs_without_plan_html() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let interviews_dir = tmp.path().join("docs/interviews/empty-one");
        fs::create_dir_all(&interviews_dir).expect("mkdir interview");

        let entries = list_plans(tmp.path().to_string_lossy().into_owned()).expect("list_plans");
        assert!(entries.is_empty());
    }

    #[test]
    fn sorts_entries_by_mtime_descending() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let plans_dir = tmp.path().join("docs/plans");
        fs::create_dir_all(&plans_dir).expect("mkdir plans");

        fs::write(plans_dir.join("older.html"), "<html></html>").expect("write older");
        std::thread::sleep(std::time::Duration::from_millis(1100));
        fs::write(plans_dir.join("newer.html"), "<html></html>").expect("write newer");

        let entries = list_plans(tmp.path().to_string_lossy().into_owned()).expect("list_plans");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].slug, "newer");
        assert_eq!(entries[1].slug, "older");
    }
}
