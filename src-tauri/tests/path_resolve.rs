use mizraj_lib::session::path;
use mizraj_lib::session::SessionError;

#[test]
fn missing_binary_surfaces_binary_not_found() {
    let err = path::resolve("nope-not-real-xyz-12345").expect_err("nonexistent binary should fail");
    match err {
        SessionError::BinaryNotFound(_) => {}
        other => panic!("expected SessionError::BinaryNotFound, got {other:?}"),
    }
}
