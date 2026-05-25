import fs from "fs";
import path from "path";
import { getDB, getDataDir } from "./index";

export interface MediaRow {
  walk_id: string;
  filename: string;
  mime: string;
  bytes: number;
  ts: string | null;
  width: number | null;
  height: number | null;
  has_person: number | null;     // 1, 0, or null (unclassified)
  kind: string | null;            // photo|screenshot|wallpaper|other|null
  score: number | null;          // 0..3 memorability, or null (unclassified)
  caption: string | null;        // one-line vision description, or null
}

export function updateMediaClassification(
  walkId: string,
  filename: string,
  has_person: boolean,
  kind: string,
  score?: number | null,
  caption?: string | null,
) {
  const db = getDB();
  db.prepare(
    "UPDATE walk_media SET has_person = ?, kind = ?, score = ?, caption = ? WHERE walk_id = ? AND filename = ?",
  ).run(
    has_person ? 1 : 0,
    kind,
    score == null ? null : Math.max(0, Math.min(3, Math.round(score))),
    caption ?? null,
    walkId,
    path.basename(filename),
  );
}

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;

function mediaDir(walkId: string): string {
  const dir = path.join(getDataDir(), "media", walkId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function mediaPath(walkId: string, filename: string): string {
  return path.join(mediaDir(walkId), path.basename(filename));
}

export function isImageName(name: string): boolean {
  return IMAGE_EXT.test(name);
}

export function mimeFor(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

// WhatsApp media filenames embed dates: "IMG-20221103-WA0001.jpg",
// "PHOTO-2022-11-03-14-22-09.jpg", "00000123-PHOTO-2022-11-03-14-22-09.jpg".
// Best-effort: return ISO date string (YYYY-MM-DD) or null.
function guessTimestamp(filename: string): string | null {
  const m1 = filename.match(/(\d{4})(\d{2})(\d{2})/); // 20221103
  if (m1) {
    const [, y, mo, d] = m1;
    if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) return `${y}-${mo}-${d}`;
  }
  const m2 = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m2) {
    const [, y, mo, d] = m2;
    if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) return `${y}-${mo}-${d}`;
  }
  return null;
}

export function saveMediaFile(walkId: string, filename: string, data: Buffer) {
  const target = mediaPath(walkId, filename);
  fs.writeFileSync(target, data);
  const db = getDB();
  db.prepare(
    `INSERT OR REPLACE INTO walk_media (walk_id, filename, mime, bytes, ts, width, height)
     VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
  ).run(walkId, path.basename(filename), mimeFor(filename), data.length, guessTimestamp(filename));
}

export function listMedia(walkId: string): MediaRow[] {
  const db = getDB();
  return db
    .prepare("SELECT * FROM walk_media WHERE walk_id = ? ORDER BY (ts IS NULL), ts ASC, filename ASC")
    .all(walkId) as MediaRow[];
}

export function deleteMediaDir(walkId: string) {
  const dir = path.join(getDataDir(), "media", walkId);
  fs.rmSync(dir, { recursive: true, force: true });
}

export function setWalkHasMedia(walkId: string, has: boolean) {
  const db = getDB();
  db.prepare("UPDATE walks SET has_media = ? WHERE id = ?").run(has ? 1 : 0, walkId);
}
