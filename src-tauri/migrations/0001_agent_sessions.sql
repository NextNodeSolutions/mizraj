CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    repo_path TEXT NOT NULL,
    worktree_path TEXT NOT NULL,
    ref_name TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('starting', 'running', 'idle', 'ended', 'failed'))
);

CREATE INDEX idx_agent_sessions_repo_path ON agent_sessions(repo_path);
CREATE INDEX idx_agent_sessions_status ON agent_sessions(status);
