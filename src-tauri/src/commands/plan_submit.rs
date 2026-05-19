use std::fs;
use std::path::PathBuf;

use serde_json::Value;

use super::list_plans::PlanKind;

#[tauri::command]
pub fn plan_submit(
    repo_path: String,
    kind: PlanKind,
    slug: String,
    payload: Value,
) -> Result<String, String> {
    let root = PathBuf::from(&repo_path);
    let target_dir = match kind {
        PlanKind::Interview => root.join("docs").join("interviews").join(&slug),
        PlanKind::Plan => root.join("docs").join("plans").join(&slug),
    };

    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    let target = target_dir.join("submission.json");

    let body = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    fs::write(&target, body).map_err(|e| e.to_string())?;

    let absolute = fs::canonicalize(&target).map_err(|e| e.to_string())?;
    Ok(absolute.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn writes_interview_submission_to_expected_path() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        fs::create_dir_all(root.join("docs/interviews/agent-cockpit"))
            .expect("mkdir interview dir");

        let payload = json!({ "answers": { "q1": "yes" } });
        let written = plan_submit(
            root.to_string_lossy().into_owned(),
            PlanKind::Interview,
            "agent-cockpit".to_string(),
            payload.clone(),
        )
        .expect("plan_submit");

        let expected = fs::canonicalize(root.join("docs/interviews/agent-cockpit/submission.json"))
            .expect("canonicalize expected");
        assert_eq!(written, expected.to_string_lossy());

        let body = fs::read_to_string(&expected).expect("read submission.json");
        assert!(body.starts_with("{\n  "), "expected 2-space indent, got: {body}");
        let parsed: Value = serde_json::from_str(&body).expect("parse json");
        assert_eq!(parsed, payload);
    }

    #[test]
    fn writes_plan_submission_creating_subdir() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        fs::create_dir_all(root.join("docs/plans")).expect("mkdir plans");

        let payload = json!({ "decision": "ship" });
        let written = plan_submit(
            root.to_string_lossy().into_owned(),
            PlanKind::Plan,
            "2026-05-19-cockpit".to_string(),
            payload.clone(),
        )
        .expect("plan_submit");

        let expected =
            fs::canonicalize(root.join("docs/plans/2026-05-19-cockpit/submission.json"))
                .expect("canonicalize expected");
        assert_eq!(written, expected.to_string_lossy());

        let body = fs::read_to_string(&expected).expect("read submission.json");
        let parsed: Value = serde_json::from_str(&body).expect("parse json");
        assert_eq!(parsed, payload);
    }

    #[test]
    fn overwrites_existing_submission() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        fs::create_dir_all(root.join("docs/interviews/slug-a")).expect("mkdir");

        plan_submit(
            root.to_string_lossy().into_owned(),
            PlanKind::Interview,
            "slug-a".to_string(),
            json!({ "v": 1 }),
        )
        .expect("first write");

        let written = plan_submit(
            root.to_string_lossy().into_owned(),
            PlanKind::Interview,
            "slug-a".to_string(),
            json!({ "v": 2 }),
        )
        .expect("second write");

        let body = fs::read_to_string(&written).expect("read");
        let parsed: Value = serde_json::from_str(&body).expect("parse");
        assert_eq!(parsed, json!({ "v": 2 }));
    }

    #[test]
    fn pretty_prints_with_two_space_indent() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        fs::create_dir_all(root.join("docs/interviews/x")).expect("mkdir");

        let written = plan_submit(
            root.to_string_lossy().into_owned(),
            PlanKind::Interview,
            "x".to_string(),
            json!({ "nested": { "a": 1 } }),
        )
        .expect("plan_submit");

        let body = fs::read_to_string(&written).expect("read");
        assert_eq!(
            body,
            "{\n  \"nested\": {\n    \"a\": 1\n  }\n}",
        );
    }
}
