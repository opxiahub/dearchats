import { getDB } from "./index";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { deleteMediaDir } from "./media";
import { getDataDir } from "./index";
import type {
  Gender,
  ProcessingStage,
  ProcessingStatus,
  RelationshipType,
  Walk,
} from "../types";

export interface WalkRow {
  id: string;
  user_id: string;
  relationship: RelationshipType;
  user_name: string;
  other_name: string;
  user_raw_name: string | null;
  other_raw_name: string | null;
  user_gender: Gender | null;
  other_gender: Gender | null;
  raw_chat: string;
  walk_json: string | null;
  stage: ProcessingStage;
  progress: number;
  partial_ready: number;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export function newWalkId(): string {
  return `w_${crypto.randomBytes(10).toString("hex")}`;
}

export function createWalk(input: {
  id: string;
  user_id: string;
  relationship: RelationshipType;
  user_name: string;
  other_name: string;
  user_raw_name: string;
  other_raw_name: string;
  raw_chat: string;
}) {
  const db = getDB();
  const now = Date.now();
  db.prepare(
    `INSERT INTO walks
      (id, user_id, relationship, user_name, other_name, user_raw_name, other_raw_name, raw_chat, walk_json, stage, progress, partial_ready, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'parsing', 0, 0, ?, ?)`,
  ).run(
    input.id,
    input.user_id,
    input.relationship,
    input.user_name,
    input.other_name,
    input.user_raw_name,
    input.other_raw_name,
    input.raw_chat,
    now,
    now,
  );
}

export function getWalkRow(walkId: string): WalkRow | null {
  const db = getDB();
  const row = db.prepare("SELECT * FROM walks WHERE id = ?").get(walkId) as WalkRow | undefined;
  return row ?? null;
}

export function getWalkRowForUser(walkId: string, userId: string): WalkRow | null {
  const db = getDB();
  const row = db
    .prepare("SELECT * FROM walks WHERE id = ? AND user_id = ?")
    .get(walkId, userId) as WalkRow | undefined;
  return row ?? null;
}

export function listWalksForUser(userId: string): WalkRow[] {
  const db = getDB();
  return db
    .prepare(
      `SELECT id, user_id, relationship, user_name, other_name, user_raw_name, other_raw_name,
        user_gender, other_gender, '' AS raw_chat, walk_json, stage, progress, partial_ready,
        error, created_at, updated_at
       FROM walks
       WHERE user_id = ?
       ORDER BY created_at DESC`,
    )
    .all(userId) as WalkRow[];
}

export function updateWalkStatus(walkId: string, patch: Partial<ProcessingStatus> & { partial_ready?: boolean }) {
  const db = getDB();
  const fields: string[] = [];
  const vals: (string | number | null)[] = [];
  if (patch.stage !== undefined) { fields.push("stage = ?"); vals.push(patch.stage); }
  if (patch.progress !== undefined) { fields.push("progress = ?"); vals.push(patch.progress); }
  if (patch.partial_ready !== undefined) { fields.push("partial_ready = ?"); vals.push(patch.partial_ready ? 1 : 0); }
  if (patch.error !== undefined) { fields.push("error = ?"); vals.push(patch.error); }
  if (fields.length === 0) return;
  fields.push("updated_at = ?"); vals.push(Date.now());
  vals.push(walkId);
  db.prepare(`UPDATE walks SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
}

export function setWalkJSON(walkId: string, walk: Walk) {
  const db = getDB();
  db.prepare(
    "UPDATE walks SET walk_json = ?, stage = 'done', progress = 1.0, partial_ready = 1, updated_at = ? WHERE id = ?",
  ).run(JSON.stringify(walk), Date.now(), walkId);
}

export function setPartialWalkJSON(walkId: string, walk: Walk) {
  const db = getDB();
  db.prepare(
    "UPDATE walks SET walk_json = ?, partial_ready = 1, updated_at = ? WHERE id = ?",
  ).run(JSON.stringify(walk), Date.now(), walkId);
}

export function deleteWalk(walkId: string, userId: string) {
  const result = getDB().prepare("DELETE FROM walks WHERE id = ? AND user_id = ?").run(walkId, userId);
  if (result.changes > 0) {
    deleteMediaDir(walkId);
    // film mp4s are stored on disk under .data/films/<walkId>; clean them up.
    try {
      fs.rmSync(path.join(getDataDir(), "films", walkId), { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  return result.changes > 0;
}

// Vignettes
export function pushVignette(walkId: string, line: string) {
  const db = getDB();
  const exists = db
    .prepare("SELECT 1 FROM walk_vignettes WHERE walk_id = ? AND line = ?")
    .get(walkId, line);
  if (exists) return;
  const next = db
    .prepare("SELECT COALESCE(MAX(idx), -1) + 1 AS n FROM walk_vignettes WHERE walk_id = ?")
    .get(walkId) as { n: number };
  db.prepare("INSERT INTO walk_vignettes (walk_id, idx, line) VALUES (?, ?, ?)").run(walkId, next.n, line);
}

export function getVignettes(walkId: string): string[] {
  const db = getDB();
  return (db
    .prepare("SELECT line FROM walk_vignettes WHERE walk_id = ? ORDER BY idx ASC")
    .all(walkId) as { line: string }[]).map((r) => r.line);
}
