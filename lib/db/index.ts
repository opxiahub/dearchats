import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

declare global {
  // eslint-disable-next-line no-var
  var __dearchats_db: Database.Database | undefined;
}

// In Docker/Coolify we want the SQLite file + media uploads to live on a
// mounted volume that survives container restarts. The default ".data" under
// cwd works locally and inside the container when /app/.data is the mount;
// DEARCHATS_DATA_DIR lets you point at e.g. "/data" without rebuilding.
export function getDataDir(): string {
  const override = process.env.DEARCHATS_DATA_DIR?.trim();
  return override && override.length > 0
    ? override
    : path.join(process.cwd(), ".data");
}

function open(): Database.Database {
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  // Probe write — bind-mounts in Docker/Coolify often inherit root ownership
  // from the host while the container runs as `node` (UID 1000). Without this
  // probe, the first write attempt would fail mid-request with a vague EACCES
  // hidden behind a 500/502. Throwing here makes the boot fail loudly so the
  // operator can fix the volume permissions before users hit it.
  try {
    const probe = path.join(dataDir, ".write-probe");
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
  } catch (e) {
    throw new Error(
      `[db] Data directory ${dataDir} is not writable by this process. ` +
      `Check the Coolify volume mount permissions (the container runs as UID 1000 / "node"). ` +
      `Underlying error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const db = new Database(path.join(dataDir, "dearchats.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // ---- Schema ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      google_sub TEXT UNIQUE NOT NULL,
      email TEXT,
      name TEXT,
      picture TEXT,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS walks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      relationship TEXT NOT NULL,
      user_name TEXT NOT NULL,
      other_name TEXT NOT NULL,
      raw_chat TEXT NOT NULL,        -- compressed/raw WhatsApp export text
      walk_json TEXT,                -- full Walk object, JSON-encoded (null until pipeline done)
      stage TEXT NOT NULL,           -- current pipeline stage (mirrors ProcessingStage)
      progress REAL NOT NULL DEFAULT 0,
      partial_ready INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_walks_user_id ON walks(user_id);

    CREATE TABLE IF NOT EXISTS walk_vignettes (
      walk_id TEXT NOT NULL REFERENCES walks(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      line TEXT NOT NULL,
      PRIMARY KEY (walk_id, idx)
    );

    CREATE TABLE IF NOT EXISTS walk_media (
      walk_id TEXT NOT NULL REFERENCES walks(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mime TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      ts TEXT,                          -- ISO date guessed from filename, may be null
      width INTEGER,
      height INTEGER,
      has_person INTEGER,               -- 1 if a person is visible, 0 if not, NULL until classified
      kind TEXT,                        -- photo|screenshot|wallpaper|other|null
      score INTEGER,                    -- 0..3 memorability/keep-worthiness, NULL until classified
      caption TEXT,                     -- one-line vision description, NULL until classified
      PRIMARY KEY (walk_id, filename)
    );

    CREATE INDEX IF NOT EXISTS idx_walk_media_walk ON walk_media(walk_id);

    CREATE TABLE IF NOT EXISTS walk_films (
      id TEXT PRIMARY KEY,
      walk_id TEXT NOT NULL REFERENCES walks(id) ON DELETE CASCADE,
      status TEXT NOT NULL,          -- queued | rendering | ready | error
      progress REAL NOT NULL DEFAULT 0,
      stage TEXT,                    -- short label for current step
      options_json TEXT NOT NULL,
      mp4_path TEXT,                 -- absolute path on disk once ready
      bytes INTEGER,
      duration_seconds REAL,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_walk_films_walk ON walk_films(walk_id);
  `);

  // Additive migrations for older DBs.
  try {
    const wcols = db.prepare("PRAGMA table_info(walks)").all() as { name: string }[];
    if (!wcols.some((c) => c.name === "has_media")) {
      db.exec("ALTER TABLE walks ADD COLUMN has_media INTEGER NOT NULL DEFAULT 0");
    }
    const mcols = db.prepare("PRAGMA table_info(walk_media)").all() as { name: string }[];
    if (!mcols.some((c) => c.name === "has_person")) {
      db.exec("ALTER TABLE walk_media ADD COLUMN has_person INTEGER");
    }
    if (!mcols.some((c) => c.name === "kind")) {
      db.exec("ALTER TABLE walk_media ADD COLUMN kind TEXT");
    }
    if (!mcols.some((c) => c.name === "score")) {
      db.exec("ALTER TABLE walk_media ADD COLUMN score INTEGER");
    }
    if (!mcols.some((c) => c.name === "caption")) {
      db.exec("ALTER TABLE walk_media ADD COLUMN caption TEXT");
    }
    if (!wcols.some((c) => c.name === "user_gender")) {
      db.exec("ALTER TABLE walks ADD COLUMN user_gender TEXT");
    }
    if (!wcols.some((c) => c.name === "other_gender")) {
      db.exec("ALTER TABLE walks ADD COLUMN other_gender TEXT");
    }
    if (!wcols.some((c) => c.name === "user_raw_name")) {
      db.exec("ALTER TABLE walks ADD COLUMN user_raw_name TEXT");
    }
    if (!wcols.some((c) => c.name === "other_raw_name")) {
      db.exec("ALTER TABLE walks ADD COLUMN other_raw_name TEXT");
    }
  } catch {
    // ignore
  }

  return db;
}

export function getDB(): Database.Database {
  if (!global.__dearchats_db) {
    global.__dearchats_db = open();
  }
  return global.__dearchats_db;
}
