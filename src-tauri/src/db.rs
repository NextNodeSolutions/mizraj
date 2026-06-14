use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use mizraj_vcs::{origin_url, repo_open};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePool};
use tauri::async_runtime::RwLock;

/// The schema-contract version embedded in every freshly created `progress.db`.
/// Bumped only by a breaking schema change; verified at open so a client never
/// writes to a database shaped by an incompatible peer.
const SCHEMA_VERSION: i64 = 1;

/// Canonical idempotent DDL for the per-project progress database. Embedded in
/// the binary so the app needs no schema file on disk at runtime; the planning
/// skills hold their own copy of the same contract.
const SCHEMA: &str = include_str!("../progress.schema.sql");

/// Resolve the per-project progress database path:
/// `$HOME/Mizraj/<slug>/progress.db`, where `<slug>` identifies the active
/// project (see [`repo_slug`]).
pub fn progress_db_path(slug: &str) -> PathBuf {
    let home = PathBuf::from(std::env::var_os("HOME").unwrap_or_default());
    home.join("Mizraj").join(slug).join("progress.db")
}

/// Derive a stable slug for `repo_path`: the last segment of the `origin` remote
/// URL with any `.git` suffix stripped, falling back to the git work tree's
/// directory name, and finally to the passed path's own name. The slug keeps its
/// source casing verbatim, so `~/Mizraj/<slug>/progress.db` mirrors the
/// repository's own name exactly.
pub fn repo_slug(repo_path: &Path) -> String {
    if let Ok(repo) = repo_open(repo_path) {
        if let Ok(Some(url)) = origin_url(&repo) {
            if let Some(slug) = slug_from_remote_url(&url) {
                return slug;
            }
        }
        if let Some(name) = repo.workdir().and_then(dir_name) {
            return name;
        }
    }
    dir_name(repo_path).unwrap_or_else(|| "default".to_string())
}

/// Extract `<repo>` from a remote URL like `git@host:owner/repo.git` or
/// `https://host/owner/repo.git`: the last `/`- or `:`-separated segment with a
/// trailing `.git` removed. Returns `None` when the result is empty.
fn slug_from_remote_url(url: &str) -> Option<String> {
    let trimmed = url.trim().trim_end_matches('/');
    let last = trimmed.rsplit(['/', ':']).next()?;
    let slug = last.strip_suffix(".git").unwrap_or(last);
    (!slug.is_empty()).then(|| slug.to_string())
}

fn dir_name(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(str::to_string)
}

/// Open (creating if absent) the progress database at `db_path`, applying the
/// idempotent schema and verifying the contract version. WAL + a busy timeout
/// keep the app and the skills safe as concurrent co-writers of one file.
pub async fn open(db_path: &Path) -> Result<SqlitePool, sqlx::Error> {
    let is_first_creation = !db_path.exists();
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(sqlx::Error::Io)?;
    }
    // SQLite defaults foreign_keys to OFF and busy_timeout to 0 ms per connection.
    let options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePool::connect_with(options).await?;
    apply_schema(&pool).await?;
    if is_first_creation {
        tracing::info!(path = %db_path.display(), "progress.db created and schema applied");
    }
    Ok(pool)
}

/// Apply the canonical schema and verify the version. Idempotent: every table
/// is `CREATE ... IF NOT EXISTS` and the version row is seeded only when absent,
/// so re-opening an existing database changes nothing. A version mismatch is a
/// hard error — we never migrate, so an incompatible file must be recreated.
async fn apply_schema(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(SCHEMA).execute(pool).await?;

    let (version,): (i64,) = sqlx::query_as("SELECT version FROM schema_meta")
        .fetch_one(pool)
        .await?;
    if version != SCHEMA_VERSION {
        return Err(sqlx::Error::Protocol(format!(
            "progress.db schema version {version} is incompatible with this app \
             (expected {SCHEMA_VERSION}); delete the database to recreate it"
        )));
    }
    Ok(())
}

/// The most progress databases kept open at once. Generous on purpose: a user
/// juggling a handful of repos never trips it, so eviction is rare. An evicted
/// pool simply re-opens lazily on its repo's next access — closing it only drops
/// idle connections, never data — so the cap bounds resource growth (open file
/// handles, WAL connections) without changing observable behavior.
const MAX_OPEN_POOLS: usize = 32;

/// A cached pool plus the `db_path` its slug resolved to at open time. Keying
/// the map by the **canonical repo path** (not the slug-derived db_path) means
/// `close_for(repo_path)` still finds the pool after the repo dir is deleted —
/// at which point `repo_slug` would fall back to a different name and miss it.
struct CachedPool {
    pool: SqlitePool,
    db_path: PathBuf,
}

/// Every open progress database, keyed by canonical repo path — one pool per
/// repo, opened on demand (MP1: reads from any registered repo at any time, no
/// active-project singleton). `projects_remove` closes the repo's pool. An
/// LRU recency list bounds the live set at [`MAX_OPEN_POOLS`].
#[derive(Default)]
pub struct Db {
    inner: RwLock<DbInner>,
}

#[derive(Default)]
struct DbInner {
    pools: HashMap<PathBuf, CachedPool>,
    /// Least-recently-used first, most-recently-used last. Touched on every
    /// hit/insert; the front is evicted when the map grows past the cap.
    recency: Vec<PathBuf>,
}

impl DbInner {
    /// Move `repo_path` to the most-recently-used end of the recency list.
    fn touch(&mut self, repo_path: &Path) {
        self.recency.retain(|p| p != repo_path);
        self.recency.push(repo_path.to_path_buf());
    }
}

impl Db {
    /// The progress pool of `repo_path`'s project, opened on demand and
    /// cached. `SqlitePool` is a cheap `Arc` clone. The blocking git2 slug
    /// resolution runs off the async runtime.
    pub async fn pool_for(&self, repo_path: &Path) -> Result<SqlitePool, String> {
        // Fast path: an already-cached pool needs no slug resolution at all.
        {
            let mut inner = self.inner.write().await;
            if let Some(cached) = inner.pools.get(repo_path) {
                let pool = cached.pool.clone();
                inner.touch(repo_path);
                return Ok(pool);
            }
        }
        let db_path = resolve_db_path(repo_path).await;
        self.pool_at(repo_path, &db_path).await
    }

    /// Close and forget `repo_path`'s pool; unknown repos are a no-op. The
    /// canonical-path keying means this finds the pool even when the repo dir
    /// has been deleted — no slug resolution is needed for a cached entry.
    pub async fn close_for(&self, repo_path: &Path) {
        let removed = {
            let mut inner = self.inner.write().await;
            inner.recency.retain(|p| p != repo_path);
            inner.pools.remove(repo_path)
        };
        if let Some(cached) = removed {
            cached.pool.close().await;
        }
    }

    async fn pool_at(&self, repo_path: &Path, db_path: &Path) -> Result<SqlitePool, String> {
        let pool = open(db_path)
            .await
            .map_err(|err| format!("open {}: {err}", db_path.display()))?;
        let mut inner = self.inner.write().await;
        // Two callers can race past the fast path above; keep the first pool
        // in the map and discard the late one so a db file never has two pools.
        if let Some(existing) = inner.pools.get(repo_path) {
            let existing = existing.pool.clone();
            inner.touch(repo_path);
            drop(inner);
            pool.close().await;
            return Ok(existing);
        }
        inner.pools.insert(
            repo_path.to_path_buf(),
            CachedPool {
                pool: pool.clone(),
                db_path: db_path.to_path_buf(),
            },
        );
        inner.touch(repo_path);
        let evicted = inner.evict_over_cap();
        drop(inner);
        if let Some(cached) = evicted {
            tracing::debug!(
                db = %cached.db_path.display(),
                "evicted least-recently-used progress pool past the cap; it re-opens lazily on next access"
            );
            cached.pool.close().await;
        }
        Ok(pool)
    }
}

impl DbInner {
    /// When the map grew past [`MAX_OPEN_POOLS`], pop the least-recently-used
    /// repo and return its pool for the caller to close (closing holds no lock).
    fn evict_over_cap(&mut self) -> Option<CachedPool> {
        if self.pools.len() <= MAX_OPEN_POOLS {
            return None;
        }
        // recency.front() is the LRU; skip any stale entries already removed.
        while !self.recency.is_empty() {
            let victim = self.recency.remove(0);
            if let Some(cached) = self.pools.remove(&victim) {
                return Some(cached);
            }
        }
        None
    }
}

/// Resolve `repo_path`'s `progress.db` path via the blocking git2 slug lookup,
/// run off the Tokio runtime so origin reads never stall an async worker.
async fn resolve_db_path(repo_path: &Path) -> PathBuf {
    let repo_path = repo_path.to_path_buf();
    tauri::async_runtime::spawn_blocking(move || progress_db_path(&repo_slug(&repo_path)))
        .await
        .unwrap_or_else(|err| {
            // The blocking task only computes a path; a join failure is a
            // runtime shutdown, in which case any fallback is moot.
            tracing::warn!(error = %err, "slug resolution task failed");
            progress_db_path("default")
        })
}

#[cfg(test)]
impl Db {
    /// Touch an already-cached repo's recency without re-resolving its slug —
    /// the same move-to-back the `pool_for` fast path performs on a cache hit.
    /// Test-only: lets a test mark a pool recently-used to steer eviction.
    async fn pool_for_existing_touch(&self, repo_path: &Path) {
        let mut inner = self.inner.write().await;
        if inner.pools.contains_key(repo_path) {
            inner.touch(repo_path);
        }
    }
}

/// An in-memory pool with the canonical schema applied, for unit tests across
/// the crate. A single connection keeps the schema alive for the pool's life.
#[cfg(test)]
pub(crate) async fn connect_for_test() -> SqlitePool {
    use sqlx::sqlite::SqlitePoolOptions;
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("connect in-memory sqlite");
    apply_schema(&pool)
        .await
        .expect("apply schema to in-memory sqlite");
    pool
}

#[cfg(test)]
mod tests {
    use tauri::async_runtime::block_on;
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn slug_from_https_url_strips_dot_git() {
        assert_eq!(
            slug_from_remote_url("https://github.com/NextNodeSolutions/mizraj.git"),
            Some("mizraj".to_string())
        );
    }

    #[test]
    fn slug_from_scp_url_strips_dot_git() {
        assert_eq!(
            slug_from_remote_url("git@github.com:NextNodeSolutions/mizraj.git"),
            Some("mizraj".to_string())
        );
    }

    #[test]
    fn slug_keeps_url_without_dot_git_and_ignores_trailing_slash() {
        assert_eq!(
            slug_from_remote_url("https://example.com/owner/my-repo/"),
            Some("my-repo".to_string())
        );
    }

    #[test]
    fn slug_is_none_for_empty_url() {
        assert_eq!(slug_from_remote_url(""), None);
        assert_eq!(slug_from_remote_url("   "), None);
    }

    #[test]
    fn repo_slug_falls_back_to_directory_name_without_a_remote() {
        let tmp = tempdir().expect("tempdir");
        let project = tmp.path().join("lonely-project");
        std::fs::create_dir(&project).expect("create project dir");

        assert_eq!(repo_slug(&project), "lonely-project");
    }

    #[test]
    fn repo_slug_preserves_the_resolved_name_casing() {
        let tmp = tempdir().expect("tempdir");
        let project = tmp.path().join("Mizraj");
        std::fs::create_dir(&project).expect("create project dir");

        assert_eq!(repo_slug(&project), "Mizraj");
    }

    #[test]
    fn progress_db_path_lives_under_home_mizraj_slug() {
        let path = progress_db_path("mizraj");
        assert!(path.ends_with("Mizraj/mizraj/progress.db"));
    }

    #[test]
    fn open_is_idempotent_and_seeds_the_schema_version() {
        let tmp = tempdir().expect("tempdir");
        let db_path = tmp.path().join("nested").join("progress.db");
        block_on(async {
            // First open creates the file, parent dir, and applies the schema.
            let pool = open(&db_path).await.expect("first open should succeed");
            let (version,): (i64,) = sqlx::query_as("SELECT version FROM schema_meta")
                .fetch_one(&pool)
                .await
                .expect("schema_meta should be seeded");
            assert_eq!(version, SCHEMA_VERSION);
            pool.close().await;

            // Second open re-applies the idempotent DDL without error and does
            // not duplicate the single schema_meta row.
            let pool = open(&db_path).await.expect("second open should succeed");
            let (rows,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM schema_meta")
                .fetch_one(&pool)
                .await
                .expect("count schema_meta");
            assert_eq!(rows, 1, "the version row is seeded exactly once");
        });
    }

    #[test]
    fn open_creates_all_contract_tables() {
        let tmp = tempdir().expect("tempdir");
        let db_path = tmp.path().join("progress.db");
        block_on(async {
            let pool = open(&db_path).await.expect("open should succeed");
            for table in [
                "schema_meta",
                "agent_sessions",
                "milestones",
                "tracks",
                "tasks",
            ] {
                let (count,): (i64,) = sqlx::query_as(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?",
                )
                .bind(table)
                .fetch_one(&pool)
                .await
                .expect("query sqlite_master");
                assert_eq!(count, 1, "table {table} should exist after open");
            }
        });
    }

    /// A real on-disk git repo under a temp dir, with an `origin` remote so its
    /// slug resolves deterministically. Returned alongside its `TempDir` guard.
    fn temp_git_repo(name: &str) -> (tempfile::TempDir, PathBuf) {
        use mizraj_vcs::git2::{Repository, RepositoryInitOptions};
        let tmp = tempdir().expect("tempdir");
        let path = tmp.path().join(name);
        std::fs::create_dir(&path).expect("create repo dir");
        let mut opts = RepositoryInitOptions::new();
        opts.external_template(false);
        opts.initial_head("main");
        let repo = Repository::init_opts(&path, &opts).expect("init repo");
        repo.remote("origin", &format!("git@github.com:owner/{name}.git"))
            .expect("set origin");
        let canonical = path.canonicalize().expect("canonicalize repo path");
        (tmp, canonical)
    }

    #[test]
    fn two_repos_get_isolated_pools_that_coexist() {
        let tmp = tempdir().expect("tempdir");
        let repo_a = tmp.path().join("repo-a");
        let repo_b = tmp.path().join("repo-b");
        let path_a = tmp.path().join("a").join("progress.db");
        let path_b = tmp.path().join("b").join("progress.db");
        block_on(async {
            let db = Db::default();
            let pool_a = db.pool_at(&repo_a, &path_a).await.expect("open a");
            let pool_b = db.pool_at(&repo_b, &path_b).await.expect("open b");

            sqlx::query("INSERT INTO tasks (id, origin, title, status, created_at) VALUES ('t1', 'user', 'only in a', 'backlog', '2026-06-13')")
                .execute(&pool_a)
                .await
                .expect("insert into a");

            let (count_b,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM tasks")
                .fetch_one(&pool_b)
                .await
                .expect("count b");
            assert_eq!(count_b, 0, "repo B must not see repo A's tasks");

            let (count_a,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM tasks")
                .fetch_one(&pool_a)
                .await
                .expect("count a");
            assert_eq!(count_a, 1);
        });
    }

    #[test]
    fn the_same_repo_reuses_one_cached_pool() {
        let tmp = tempdir().expect("tempdir");
        let repo = tmp.path().join("repo");
        let path = tmp.path().join("progress.db");
        block_on(async {
            let db = Db::default();
            db.pool_at(&repo, &path).await.expect("first open");
            db.pool_at(&repo, &path).await.expect("second open");
            assert_eq!(
                db.inner.read().await.pools.len(),
                1,
                "both opens share one cached pool"
            );
        });
    }

    #[test]
    fn close_for_drops_the_pool_and_unknown_paths_are_noops() {
        let tmp = tempdir().expect("tempdir");
        let repo = tmp.path().join("repo");
        let path = tmp.path().join("progress.db");
        block_on(async {
            let db = Db::default();
            db.pool_at(&repo, &path).await.expect("open");
            assert_eq!(db.inner.read().await.pools.len(), 1);

            // The map is keyed by the canonical repo path, so close_for finds
            // and drops the pool directly.
            db.close_for(&repo).await;
            let inner = db.inner.read().await;
            assert_eq!(inner.pools.len(), 0);
            assert!(inner.recency.is_empty(), "recency tracks the live set");
            drop(inner);

            db.close_for(Path::new("/never/registered")).await;
        });
    }

    #[test]
    fn pool_for_then_close_for_empties_the_map() {
        let (_tmp, repo) = temp_git_repo("close-me");
        block_on(async {
            let db = Db::default();
            db.pool_for(&repo).await.expect("open via pool_for");
            assert_eq!(db.inner.read().await.pools.len(), 1);

            db.close_for(&repo).await;
            let inner = db.inner.read().await;
            assert!(inner.pools.is_empty(), "close_for emptied the pool map");
            assert!(inner.recency.is_empty());
        });
    }

    #[test]
    fn close_for_still_closes_after_the_repo_dir_is_removed() {
        let (tmp, repo) = temp_git_repo("vanishing");
        block_on(async {
            let db = Db::default();
            db.pool_for(&repo).await.expect("open via pool_for");
            assert_eq!(db.inner.read().await.pools.len(), 1);

            // The repo dir is gone: repo_slug would now fall back to a different
            // name, but canonical-path keying still locates the pool.
            drop(tmp);
            assert!(!repo.exists(), "repo dir should be removed");

            db.close_for(&repo).await;
            assert!(
                db.inner.read().await.pools.is_empty(),
                "the pool must close even after its repo dir vanished"
            );
        });
    }

    #[test]
    fn opening_past_the_cap_evicts_the_least_recently_used_pool() {
        let tmp = tempdir().expect("tempdir");
        block_on(async {
            let db = Db::default();
            // Fill exactly to the cap, recording each repo path so we can probe
            // recency afterwards.
            let mut repos = Vec::new();
            for i in 0..MAX_OPEN_POOLS {
                let repo = tmp.path().join(format!("repo-{i}"));
                let dbp = tmp.path().join(format!("db-{i}")).join("progress.db");
                db.pool_at(&repo, &dbp).await.expect("open within cap");
                repos.push(repo);
            }
            assert_eq!(db.inner.read().await.pools.len(), MAX_OPEN_POOLS);

            // Touch the oldest so it is no longer the LRU victim.
            let oldest = repos[0].clone();
            db.pool_for_existing_touch(&oldest).await;

            // One more open trips the cap and evicts the new LRU (repos[1]).
            let extra = tmp.path().join("repo-extra");
            let extra_db = tmp.path().join("db-extra").join("progress.db");
            db.pool_at(&extra, &extra_db).await.expect("open past cap");

            let inner = db.inner.read().await;
            assert_eq!(inner.pools.len(), MAX_OPEN_POOLS, "cap holds steady");
            assert!(
                inner.pools.contains_key(&oldest),
                "the freshly-touched repo survives eviction"
            );
            assert!(
                !inner.pools.contains_key(&repos[1]),
                "the least-recently-used repo was evicted"
            );
        });
    }
}
