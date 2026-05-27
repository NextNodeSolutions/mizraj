#![cfg(target_os = "macos")]

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use tauri_app_lib::session::pty::{self, PtySession};

// The spawn API takes no argv beyond the binary path, so we drive `/bin/sh`
// via master_writer to print 'y' and exit 0. This still exercises the full
// PTY plumbing end-to-end (D3 smoke test).
#[test]
fn spawn_shell_prints_y_and_exits_zero() {
    let env: HashMap<String, String> = HashMap::new();
    let PtySession {
        master_reader,
        mut master_writer,
        mut child,
    } = pty::spawn("/bin/sh", "/tmp", &env).expect("spawn /bin/sh");

    writeln!(master_writer, "echo y").expect("write echo");
    writeln!(master_writer, "exit 0").expect("write exit");
    master_writer.flush().expect("flush master_writer");
    drop(master_writer);

    let (tx, rx) = mpsc::channel::<std::io::Result<Vec<u8>>>();
    let mut reader = master_reader;
    thread::spawn(move || {
        let mut buf = Vec::new();
        let res = reader.read_to_end(&mut buf).map(|_| buf);
        let _ = tx.send(res);
    });

    let output = rx
        .recv_timeout(Duration::from_secs(5))
        .expect("master_reader timed out after 5s")
        .expect("read master_reader");
    let text = String::from_utf8_lossy(&output);
    assert!(
        text.contains('y'),
        "expected master_reader output to contain 'y', got {text:?}"
    );

    let deadline = Instant::now() + Duration::from_secs(1);
    let status = loop {
        match child.try_wait().expect("try_wait") {
            Some(status) => break status,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                panic!("child did not exit within 1s of EOF");
            }
            None => thread::sleep(Duration::from_millis(20)),
        }
    };
    assert!(status.success(), "shell exited non-zero: {status:?}");
}
