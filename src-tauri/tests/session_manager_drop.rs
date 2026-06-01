#![cfg(unix)]

use std::collections::HashMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use nix::errno::Errno;
use nix::sys::signal::{kill, Signal};
use nix::unistd::Pid;
use tauri::async_runtime::block_on;
use tempfile::TempDir;

use mizraj_lib::session::SessionManager;

fn pid_gone(pid: Pid) -> bool {
    matches!(kill(pid, None), Err(Errno::ESRCH))
}

// D4 verification: dropping the SessionManager must propagate to its child
// processes within the SHUTDOWN_GRACE + escalation window.
//
// The wrapper script writes its own PID to disk before `exec`ing `/bin/sleep`,
// so the test can probe liveness via `kill(pid, None)` without touching the
// manager's private registry. `exec` preserves the shell's PID, so `echo $$`
// captures the same PID that `sleep 60` runs under.
#[test]
fn drop_kills_sleep_child_within_5s() {
    let tmp = TempDir::new().expect("tempdir for sleep wrapper");
    let pid_file = tmp.path().join("sleep.pid");
    let script_path = tmp.path().join("sleep60.sh");
    fs::write(
        &script_path,
        format!(
            "#!/bin/sh\necho $$ > '{pid_file}'\nexec /bin/sleep 60\n",
            pid_file = pid_file.display(),
        ),
    )
    .expect("write sleep wrapper script");
    fs::set_permissions(&script_path, fs::Permissions::from_mode(0o755))
        .expect("chmod +x sleep wrapper");

    let manager = SessionManager::new();
    block_on(async {
        let env: HashMap<String, String> = HashMap::new();
        manager
            .create_session(script_path.clone(), PathBuf::from("/tmp"), env, |_, _| {
                Vec::new()
            })
            .await
            .expect("create_session sleep wrapper");
    });

    let pid = {
        let started = Instant::now();
        loop {
            if pid_file.exists() {
                let raw_str = fs::read_to_string(&pid_file).expect("read pid file");
                let raw: i32 = raw_str
                    .trim()
                    .parse()
                    .unwrap_or_else(|err| panic!("parse pid {raw_str:?}: {err}"));
                break Pid::from_raw(raw);
            }
            if started.elapsed() > Duration::from_secs(2) {
                panic!(
                    "sleep wrapper never wrote its PID to {}",
                    pid_file.display()
                );
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    };
    assert!(
        !pid_gone(pid),
        "sleep child {} should be alive before drop",
        pid.as_raw()
    );

    drop(manager);

    let started = Instant::now();
    let mut gone = false;
    while started.elapsed() < Duration::from_secs(5) {
        if pid_gone(pid) {
            gone = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    if !gone {
        // Defensive cleanup: don't leak a 60s sleep process if the assertion
        // is about to blow up the test.
        let _ = kill(pid, Signal::SIGKILL);
        panic!(
            "sleep child {} should be gone within 5s of SessionManager drop",
            pid.as_raw()
        );
    }
}
