use std::io::{Read, Write};

use portable_pty::Child;

pub struct PtySession {
    pub master_reader: Box<dyn Read + Send>,
    pub master_writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send + Sync>,
}
