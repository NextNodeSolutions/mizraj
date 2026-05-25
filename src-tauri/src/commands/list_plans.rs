use std::fs;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::active_project::ActiveProject;
use crate::commands::plan_protocol::plan_url;

const ERR_NO_ACTIVE_PROJECT: &str = "no active project: call set_active_project first";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PlanKind {
    Interview,
    Plan,
}

impl PlanKind {
    pub fn from_segment(segment: &str) -> Option<Self> {
        match segment {
            "interview" => Some(PlanKind::Interview),
            "plan" => Some(PlanKind::Plan),
            _ => None,
        }
    }

    pub fn as_segment(self) -> &'static str {
        match self {
            PlanKind::Interview => "interview",
            PlanKind::Plan => "plan",
        }
    }

    pub fn html_path(self, root: &Path, slug: &str) -> PathBuf {
        match self {
            PlanKind::Interview => root
                .join("docs")
                .join("interviews")
                .join(slug)
                .join("plan.html"),
            PlanKind::Plan => root
                .join("docs")
                .join("plans")
                .join(format!("{slug}.html")),
        }
    }

    pub fn submit_dir(self, root: &Path, slug: &str) -> PathBuf {
        match self {
            PlanKind::Interview => root.join("docs").join("interviews").join(slug),
            PlanKind::Plan => root.join("docs").join("plans").join(slug),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanEntry {
    pub kind: PlanKind,
    pub slug: String,
    pub title: String,
    /// Iframe URL served by the `plan://` URI scheme handler.
    pub url: String,
    pub mtime: u64,
}

const TITLE_READ_LIMIT: u64 = 16 * 1024;

#[tauri::command]
pub fn list_plans(
    active_project: tauri::State<'_, ActiveProject>,
) -> Result<Vec<PlanEntry>, String> {
    let root = active_project
        .get()
        .ok_or_else(|| ERR_NO_ACTIVE_PROJECT.to_string())?;
    collect_entries(&root)
}

fn collect_entries(root: &Path) -> Result<Vec<PlanEntry>, String> {
    let mut entries = Vec::new();
    collect_interviews(root, &mut entries)?;
    collect_plans(root, &mut entries)?;
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
        let title = read_title(&plan_html, &slug);
        let url = plan_url(PlanKind::Interview, &slug);
        entries.push(PlanEntry {
            kind: PlanKind::Interview,
            slug,
            title,
            url,
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
        let Some(slug) = path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(str::to_string)
        else {
            continue;
        };
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let title = read_title(&path, &slug);
        let url = plan_url(PlanKind::Plan, &slug);
        entries.push(PlanEntry {
            kind: PlanKind::Plan,
            slug,
            title,
            url,
            mtime: mtime_from(&meta)?,
        });
    }
    Ok(())
}

fn file_name_str(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|s| s.to_str())
        .map(str::to_string)
}

fn mtime_from(meta: &fs::Metadata) -> Result<u64, String> {
    let modified = meta.modified().map_err(|e| e.to_string())?;
    let duration = modified
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    Ok(duration.as_secs())
}

fn read_title(path: &Path, fallback: &str) -> String {
    let Ok(file) = File::open(path) else {
        return fallback.to_string();
    };
    let mut buf = Vec::with_capacity(TITLE_READ_LIMIT as usize);
    if file.take(TITLE_READ_LIMIT).read_to_end(&mut buf).is_err() {
        return fallback.to_string();
    }
    let head = String::from_utf8_lossy(&buf);
    extract_title(&head, fallback)
}

fn extract_title(html: &str, fallback: &str) -> String {
    let lower = html.to_ascii_lowercase();
    for tag in ["title", "h1"] {
        let Some(text) = find_tag_text(html, &lower, tag) else {
            continue;
        };
        let cleaned = clean_text(text);
        if !cleaned.is_empty() {
            return cleaned;
        }
    }
    fallback.to_string()
}

fn find_tag_text<'a>(html: &'a str, lower: &str, tag: &str) -> Option<&'a str> {
    let open_needle = format!("<{tag}");
    let close_needle = format!("</{tag}>");
    let mut cursor = 0usize;
    while cursor < lower.len() {
        let rel = lower[cursor..].find(&open_needle)?;
        let open_start = cursor + rel;
        let after_name = open_start + open_needle.len();
        let next = lower.as_bytes().get(after_name).copied();
        let is_tag = matches!(
            next,
            Some(b'>') | Some(b' ') | Some(b'\t') | Some(b'\n') | Some(b'\r') | Some(b'/')
        );
        if !is_tag {
            cursor = after_name;
            continue;
        }
        let close_rel = lower[after_name..].find('>')?;
        let content_start = after_name + close_rel + 1;
        let end_rel = lower[content_start..].find(&close_needle)?;
        let content_end = content_start + end_rel;
        return Some(&html[content_start..content_end]);
    }
    None
}

fn clean_text(raw: &str) -> String {
    let stripped = strip_tags(raw);
    let decoded = html_escape::decode_html_entities(&stripped);
    collapse_whitespace(&decoded)
}

fn strip_tags(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut in_tag = false;
    for c in raw.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

fn collapse_whitespace(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_ws = false;
    for c in s.chars() {
        if c.is_whitespace() {
            if !prev_ws && !out.is_empty() {
                out.push(' ');
            }
            prev_ws = true;
        } else {
            out.push(c);
            prev_ws = false;
        }
    }
    out.trim().to_string()
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

        let entries = collect_entries(root).expect("collect_entries");
        assert_eq!(entries.len(), 2);

        let interview = entries
            .iter()
            .find(|e| matches!(e.kind, PlanKind::Interview))
            .expect("interview entry");
        assert_eq!(interview.slug, "agent-cockpit");
        assert_eq!(interview.title, "Interview");
        assert_eq!(
            interview.url,
            "plan://localhost/interview/agent-cockpit/plan.html"
        );
        assert!(interview.mtime > 0);

        let plan = entries
            .iter()
            .find(|e| matches!(e.kind, PlanKind::Plan))
            .expect("plan entry");
        assert_eq!(plan.slug, "2026-05-15-agent-cockpit");
        assert_eq!(plan.title, "Plan");
        assert_eq!(
            plan.url,
            "plan://localhost/plan/2026-05-15-agent-cockpit/plan.html"
        );
        assert!(plan.mtime > 0);
    }

    #[test]
    fn plan_kind_serializes_to_lowercase_strings() {
        assert_eq!(
            serde_json::to_string(&PlanKind::Interview).expect("serialize interview"),
            r#""interview""#,
        );
        assert_eq!(
            serde_json::to_string(&PlanKind::Plan).expect("serialize plan"),
            r#""plan""#,
        );
    }

    #[test]
    fn returns_empty_when_docs_missing() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let entries = collect_entries(tmp.path()).expect("collect_entries");
        assert!(entries.is_empty());
    }

    #[test]
    fn ignores_non_html_files_in_plans_dir() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let plans_dir = tmp.path().join("docs/plans");
        fs::create_dir_all(&plans_dir).expect("mkdir plans");
        fs::write(plans_dir.join("notes.md"), "hello").expect("write notes.md");
        fs::write(plans_dir.join("real.html"), "<html></html>").expect("write real.html");

        let entries = collect_entries(tmp.path()).expect("collect_entries");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].slug, "real");
    }

    #[test]
    fn ignores_interview_dirs_without_plan_html() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let interviews_dir = tmp.path().join("docs/interviews/empty-one");
        fs::create_dir_all(&interviews_dir).expect("mkdir interview");

        let entries = collect_entries(tmp.path()).expect("collect_entries");
        assert!(entries.is_empty());
    }

    #[test]
    fn extract_title_prefers_title_tag() {
        let html =
            r#"<html><head><title>Page Title</title></head><body><h1>Heading</h1></body></html>"#;
        assert_eq!(extract_title(html, "fallback"), "Page Title");
    }

    #[test]
    fn extract_title_falls_back_to_h1_when_title_missing() {
        let html = r#"<html><body><h1 class="hero">Heading One</h1></body></html>"#;
        assert_eq!(extract_title(html, "fallback"), "Heading One");
    }

    #[test]
    fn extract_title_falls_back_to_h1_when_title_empty() {
        let html =
            r#"<html><head><title>   </title></head><body><h1>Real Title</h1></body></html>"#;
        assert_eq!(extract_title(html, "fallback"), "Real Title");
    }

    #[test]
    fn extract_title_falls_back_to_slug_when_nothing_found() {
        let html = r#"<html><body><p>no headings here</p></body></html>"#;
        assert_eq!(extract_title(html, "my-slug"), "my-slug");
    }

    #[test]
    fn extract_title_decodes_html_entities() {
        let html = r#"<title>Cockpit &#8212; v1 &amp; &#x3E;beyond</title>"#;
        assert_eq!(extract_title(html, "slug"), "Cockpit — v1 & >beyond");
    }

    #[test]
    fn extract_title_decodes_french_named_entities() {
        let html = r#"<title>R&eacute;tro &agrave; c&ocirc;t&eacute;</title>"#;
        assert_eq!(extract_title(html, "slug"), "Rétro à côté");
    }

    #[test]
    fn extract_title_strips_nested_tags() {
        let html = r#"<title>Cockpit <span class="badge">beta</span></title>"#;
        assert_eq!(extract_title(html, "slug"), "Cockpit beta");
    }

    #[test]
    fn extract_title_is_case_insensitive() {
        let html = r#"<HTML><HEAD><TITLE>Loud Title</TITLE></HEAD></HTML>"#;
        assert_eq!(extract_title(html, "slug"), "Loud Title");
    }

    #[test]
    fn extract_title_handles_real_plan_html_fixture() {
        let html = include_str!("../../../docs/plans/2026-05-16-agent-cockpit-backlog.html");
        let title = extract_title(html, "2026-05-16-agent-cockpit-backlog");
        assert_eq!(title, "Agent Cockpit — Backlog V1 (106 tâches)");
    }

    #[test]
    fn list_plans_populates_title_from_real_fixture() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let plans_dir = tmp.path().join("docs/plans");
        fs::create_dir_all(&plans_dir).expect("mkdir plans");

        let fixture = include_str!("../../../docs/plans/2026-05-16-agent-cockpit-backlog.html");
        fs::write(
            plans_dir.join("2026-05-16-agent-cockpit-backlog.html"),
            fixture,
        )
        .expect("write fixture");

        let entries = collect_entries(tmp.path()).expect("collect_entries");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].title, "Agent Cockpit — Backlog V1 (106 tâches)");
    }

    #[test]
    fn sorts_entries_by_mtime_descending() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let plans_dir = tmp.path().join("docs/plans");
        fs::create_dir_all(&plans_dir).expect("mkdir plans");

        fs::write(plans_dir.join("older.html"), "<html></html>").expect("write older");
        std::thread::sleep(std::time::Duration::from_millis(1100));
        fs::write(plans_dir.join("newer.html"), "<html></html>").expect("write newer");

        let entries = collect_entries(tmp.path()).expect("collect_entries");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].slug, "newer");
        assert_eq!(entries[1].slug, "older");
    }
}
