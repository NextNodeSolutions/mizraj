CREATE TABLE diff_comments (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    line INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_diff_comments_session_id ON diff_comments(session_id);
