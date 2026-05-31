-- Shared task store for the cockpit database. Rows are written by two clients:
-- this app (origin 'user') and the planning skills (origin 'track', out-of-band).
-- The CHECK constraints make the status/origin vocabulary the enforced contract.
CREATE TABLE tasks (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL CHECK (status IN ('backlog', 'in_progress', 'done')),
    origin TEXT NOT NULL CHECK (origin IN ('user', 'track')),
    repo_path TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Serves the only read path: filter by repo_path, newest-first by (created_at,
-- id). The composite covers the ORDER BY so the query needs no separate sort.
CREATE INDEX idx_tasks_repo_path_created ON tasks(repo_path, created_at DESC, id DESC);

-- Single-row table carrying the version of the shared schema contract, so a
-- skill can detect an app it is incompatible with before writing.
CREATE TABLE schema_meta (
    version INTEGER NOT NULL
);

INSERT INTO schema_meta (version) VALUES (1);
