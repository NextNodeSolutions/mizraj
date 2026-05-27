use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;

use portable_pty::{Child, CommandBuilder, PtySize, native_pty_system};

use crate::session::error::SessionError;

pub struct PtySession {
    pub master_reader: Box<dyn Read + Send>,
    pub master_writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send + Sync>,
}

/// Spawn `binary` under a 24x80 PTY with the given `cwd` and `env`.
///
/// `env` is applied on top of the parent process environment (portable-pty
/// inherits parent env by default); vars in `env` override matching parent
/// vars. Pass `binary` as an absolute path (resolve via [`super::path::resolve`])
/// so a missing binary surfaces as `BinaryNotFound` rather than an opaque
/// spawn failure.
///
/// Sync by design. Callers invoking this from a Tauri command MUST wrap it in
/// `tauri::async_runtime::spawn_blocking` so the event loop is not blocked.
pub fn spawn(
    binary: &str,
    cwd: impl AsRef<Path>,
    env: &HashMap<String, String>,
) -> Result<PtySession, SessionError> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| SessionError::Spawn(e.to_string()))?;

    let mut cmd = CommandBuilder::new(binary);
    cmd.cwd(cwd.as_ref());
    for (k, v) in env {
        cmd.env(k, v);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| SessionError::Spawn(e.to_string()))?;

    drop(pair.slave);

    let master_reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| SessionError::Spawn(e.to_string()))?;
    let master_writer = pair
        .master
        .take_writer()
        .map_err(|e| SessionError::Spawn(e.to_string()))?;

    Ok(PtySession {
        master_reader,
        master_writer,
        child,
    })
}
