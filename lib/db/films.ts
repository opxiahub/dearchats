import { getDB } from "./index";

export type FilmStatus = "queued" | "rendering" | "ready" | "error";

export interface FilmRow {
  id: string;
  walk_id: string;
  status: FilmStatus;
  progress: number;
  stage: string | null;
  options_json: string;
  mp4_path: string | null;
  bytes: number | null;
  duration_seconds: number | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export function insertFilm(row: {
  id: string;
  walk_id: string;
  options_json: string;
}) {
  const now = Date.now();
  getDB()
    .prepare(
      `INSERT INTO walk_films (id, walk_id, status, progress, stage, options_json, created_at, updated_at)
       VALUES (?, ?, 'queued', 0, 'queued', ?, ?, ?)`,
    )
    .run(row.id, row.walk_id, row.options_json, now, now);
}

export function updateFilm(
  id: string,
  patch: Partial<Pick<FilmRow, "status" | "progress" | "stage" | "mp4_path" | "bytes" | "duration_seconds" | "error">>,
) {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const set = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => (patch as Record<string, unknown>)[k] ?? null);
  getDB()
    .prepare(`UPDATE walk_films SET ${set}, updated_at = ? WHERE id = ?`)
    .run(...values, Date.now(), id);
}

export function getLatestFilmForWalk(walkId: string): FilmRow | null {
  return (
    (getDB()
      .prepare(
        `SELECT * FROM walk_films WHERE walk_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(walkId) as FilmRow | undefined) ?? null
  );
}

export function getLatestReadyFilmForWalk(walkId: string): FilmRow | null {
  return (
    (getDB()
      .prepare(
        `SELECT * FROM walk_films WHERE walk_id = ? AND status = 'ready' ORDER BY created_at DESC LIMIT 1`,
      )
      .get(walkId) as FilmRow | undefined) ?? null
  );
}

export function getFilm(id: string): FilmRow | null {
  return (
    (getDB().prepare(`SELECT * FROM walk_films WHERE id = ?`).get(id) as FilmRow | undefined) ?? null
  );
}

export function listFilmsForWalk(walkId: string): FilmRow[] {
  return getDB()
    .prepare(`SELECT * FROM walk_films WHERE walk_id = ? ORDER BY created_at DESC`)
    .all(walkId) as FilmRow[];
}

export function deleteFilm(id: string) {
  getDB().prepare(`DELETE FROM walk_films WHERE id = ?`).run(id);
}

export function deleteFilmsForWalk(walkId: string): FilmRow[] {
  const rows = listFilmsForWalk(walkId);
  getDB().prepare(`DELETE FROM walk_films WHERE walk_id = ?`).run(walkId);
  return rows;
}
