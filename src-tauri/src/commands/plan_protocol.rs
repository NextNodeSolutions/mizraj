use std::borrow::Cow;
use std::fs;
use std::path::Path;

use serde_json::{json, Value};
use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext};

use crate::active_project::ActiveProject;
use crate::commands::list_plans::PlanKind;

pub const SCHEME: &str = "plan";

const ACTION_SUBMIT: &str = "submit";
const ACTION_PLAN_HTML: &str = "plan.html";

pub const SLUG_MAX_LEN: usize = 128;

pub fn handle_request<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    let path = request.uri().path().to_string();
    let segments: Vec<&str> = path
        .trim_start_matches('/')
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();

    let [kind_segment, slug, action] = segments.as_slice() else {
        return text_response(StatusCode::NOT_FOUND, "unrecognized plan:// path");
    };

    let Some(kind) = PlanKind::from_segment(kind_segment) else {
        return text_response(StatusCode::NOT_FOUND, "unknown plan kind");
    };

    if !is_safe_slug(slug) {
        return text_response(StatusCode::BAD_REQUEST, "invalid slug");
    }

    let Some(root) = ctx.app_handle().state::<ActiveProject>().get() else {
        return text_response(StatusCode::NOT_FOUND, "no active project");
    };

    match (request.method(), *action) {
        (&Method::POST, ACTION_SUBMIT) => handle_submit(&root, kind, slug, request.body()),
        (&Method::GET, ACTION_PLAN_HTML) => handle_serve(&root, kind, slug),
        _ => text_response(StatusCode::NOT_FOUND, "method or action not handled"),
    }
}

pub fn is_safe_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= SLUG_MAX_LEN
        && slug
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn handle_serve(root: &Path, kind: PlanKind, slug: &str) -> Response<Cow<'static, [u8]>> {
    let file = kind.html_path(root, slug);
    let Ok(bytes) = fs::read(&file) else {
        return text_response(StatusCode::NOT_FOUND, "plan file not found");
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Cow::Owned(bytes))
        .expect("response builder failed for plan html")
}

fn handle_submit(
    root: &Path,
    kind: PlanKind,
    slug: &str,
    body: &[u8],
) -> Response<Cow<'static, [u8]>> {
    let target_dir = kind.submit_dir(root, slug);
    let Ok(payload) = serde_json::from_slice::<Value>(body) else {
        return text_response(StatusCode::BAD_REQUEST, "invalid JSON body");
    };
    let Ok(pretty) = serde_json::to_string_pretty(&payload) else {
        return text_response(StatusCode::INTERNAL_SERVER_ERROR, "format JSON failed");
    };
    if fs::create_dir_all(&target_dir).is_err() {
        return text_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "create target dir failed",
        );
    }
    let target = target_dir.join("submission.json");
    if fs::write(&target, pretty).is_err() {
        return text_response(StatusCode::INTERNAL_SERVER_ERROR, "write submission failed");
    }
    let ack = json!({ "ok": true, "path": target.to_string_lossy() }).to_string();
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Cow::Owned(ack.into_bytes()))
        .expect("response builder failed for submit ack")
}

fn text_response(status: StatusCode, message: &'static str) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Cow::Borrowed(message.as_bytes()))
        .expect("response builder failed for text response")
}

pub fn plan_url(kind: PlanKind, slug: &str) -> String {
    // Tauri 2 exposes custom URI schemes differently per platform:
    //   * macOS / iOS / Linux: `<scheme>://localhost/...`
    //   * Windows / Android:    `http://<scheme>.localhost/...`
    // Sources: https://v2.tauri.app/reference/config (useHttpsScheme) and
    // https://v2.tauri.app/blog/tauri-1-5 (Mixed content on Windows).
    #[cfg(any(target_os = "windows", target_os = "android"))]
    let base = format!("http://{SCHEME}.localhost");
    #[cfg(not(any(target_os = "windows", target_os = "android")))]
    let base = format!("{SCHEME}://localhost");
    format!(
        "{base}/{}/{slug}/{ACTION_PLAN_HTML}",
        kind.as_segment()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[cfg(not(any(target_os = "windows", target_os = "android")))]
    #[test]
    fn plan_url_uses_scheme_form_on_macos_ios_and_linux() {
        assert_eq!(
            plan_url(PlanKind::Interview, "agent-cockpit"),
            "plan://localhost/interview/agent-cockpit/plan.html"
        );
    }

    #[cfg(any(target_os = "windows", target_os = "android"))]
    #[test]
    fn plan_url_uses_http_localhost_form_on_windows_and_android() {
        assert_eq!(
            plan_url(PlanKind::Interview, "agent-cockpit"),
            "http://plan.localhost/interview/agent-cockpit/plan.html"
        );
    }

    #[test]
    fn handle_submit_writes_pretty_json_into_existing_dir() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        fs::create_dir_all(root.join("docs/interviews/agent-cockpit")).expect("mkdir");

        let body = br#"{"answers":{"q1":"yes"}}"#;
        let resp = handle_submit(root, PlanKind::Interview, "agent-cockpit", body);
        assert_eq!(resp.status(), StatusCode::OK);

        let target = root.join("docs/interviews/agent-cockpit/submission.json");
        let content = fs::read_to_string(&target).expect("read submission");
        assert!(
            content.starts_with("{\n  "),
            "expected 2-space indent, got: {content}"
        );
        let parsed: Value = serde_json::from_str(&content).expect("parse json");
        assert_eq!(parsed, json!({"answers": {"q1": "yes"}}));
    }

    #[test]
    fn handle_submit_creates_plan_slug_dir() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        fs::create_dir_all(root.join("docs/plans")).expect("mkdir plans");

        let body = br#"{"v":2}"#;
        let resp = handle_submit(root, PlanKind::Plan, "2026-05-19-cockpit", body);
        assert_eq!(resp.status(), StatusCode::OK);

        let target = root.join("docs/plans/2026-05-19-cockpit/submission.json");
        assert!(target.is_file(), "submission.json not written");
    }

    #[test]
    fn handle_submit_ack_contains_target_path_and_ok_flag() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        fs::create_dir_all(root.join("docs/interviews/agent-cockpit")).expect("mkdir");

        let resp = handle_submit(root, PlanKind::Interview, "agent-cockpit", b"{}");
        let ack: Value = serde_json::from_slice(resp.body()).expect("ack is json");
        assert_eq!(ack["ok"], json!(true));
        assert!(
            ack["path"].as_str().unwrap().ends_with("submission.json"),
            "ack path points at submission.json: {ack}"
        );
    }

    #[test]
    fn handle_submit_rejects_invalid_json() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        fs::create_dir_all(root.join("docs/interviews/agent-cockpit")).expect("mkdir");

        let resp = handle_submit(root, PlanKind::Interview, "agent-cockpit", b"not json");
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn plan_kind_from_segment_rejects_unknown() {
        assert!(PlanKind::from_segment("rfc").is_none());
    }

    #[test]
    fn is_safe_slug_accepts_valid_slugs() {
        assert!(is_safe_slug("agent-cockpit"));
        assert!(is_safe_slug("2026-05-15-agent-cockpit"));
        assert!(is_safe_slug("under_score_ok"));
        assert!(is_safe_slug("ABC123"));
    }

    #[test]
    fn is_safe_slug_rejects_traversal_and_separators() {
        assert!(!is_safe_slug(""));
        assert!(!is_safe_slug(".."));
        assert!(!is_safe_slug("../etc"));
        assert!(!is_safe_slug("a/b"));
        assert!(!is_safe_slug("a\\b"));
        assert!(!is_safe_slug(".hidden"));
        assert!(!is_safe_slug("with space"));
        assert!(!is_safe_slug("with%2Fencoded"));
        assert!(!is_safe_slug(&"x".repeat(SLUG_MAX_LEN + 1)));
    }

    #[test]
    fn plan_kind_html_path_for_interview() {
        let root = PathBuf::from("/tmp/repo");
        assert_eq!(
            PlanKind::Interview.html_path(&root, "agent-cockpit"),
            PathBuf::from("/tmp/repo/docs/interviews/agent-cockpit/plan.html"),
        );
    }

    #[test]
    fn plan_kind_html_path_for_plan() {
        let root = PathBuf::from("/tmp/repo");
        assert_eq!(
            PlanKind::Plan.html_path(&root, "2026-05-19-cockpit"),
            PathBuf::from("/tmp/repo/docs/plans/2026-05-19-cockpit.html"),
        );
    }

    #[test]
    fn plan_kind_submit_dir_for_plan() {
        let root = PathBuf::from("/tmp/repo");
        assert_eq!(
            PlanKind::Plan.submit_dir(&root, "2026-05-19-cockpit"),
            PathBuf::from("/tmp/repo/docs/plans/2026-05-19-cockpit"),
        );
    }

    #[test]
    fn handle_serve_returns_file_bytes_for_existing_file() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        let interview_dir = root.join("docs/interviews/agent-cockpit");
        fs::create_dir_all(&interview_dir).expect("mkdir");
        let html = "<html><body>page</body></html>";
        fs::write(interview_dir.join("plan.html"), html).expect("write");

        let resp = handle_serve(root, PlanKind::Interview, "agent-cockpit");
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(resp.body().as_ref(), html.as_bytes());
    }

    #[test]
    fn handle_serve_returns_404_for_missing_file() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let resp = handle_serve(tmp.path(), PlanKind::Interview, "ghost");
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }
}
