import { getDB } from "./index";
import crypto from "crypto";

export interface User {
  id: string;
  google_sub: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  created_at: number;
  last_seen_at: number;
}

export function upsertUserFromGoogle(profile: {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}): User {
  const db = getDB();
  const now = Date.now();
  const existing = db
    .prepare("SELECT * FROM users WHERE google_sub = ?")
    .get(profile.sub) as User | undefined;

  if (existing) {
    db.prepare(
      "UPDATE users SET email = ?, name = ?, picture = ?, last_seen_at = ? WHERE id = ?",
    ).run(profile.email ?? null, profile.name ?? null, profile.picture ?? null, now, existing.id);
    return { ...existing, email: profile.email ?? null, name: profile.name ?? null, picture: profile.picture ?? null, last_seen_at: now };
  }

  const id = `u_${crypto.randomBytes(10).toString("hex")}`;
  db.prepare(
    "INSERT INTO users (id, google_sub, email, name, picture, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, profile.sub, profile.email ?? null, profile.name ?? null, profile.picture ?? null, now, now);
  return {
    id,
    google_sub: profile.sub,
    email: profile.email ?? null,
    name: profile.name ?? null,
    picture: profile.picture ?? null,
    created_at: now,
    last_seen_at: now,
  };
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function createSession(userId: string): string {
  const db = getDB();
  const id = `s_${crypto.randomBytes(24).toString("hex")}`;
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
  ).run(id, userId, now + SESSION_TTL_MS, now);
  return id;
}

export function getUserBySessionId(sessionId: string): User | null {
  const db = getDB();
  const row = db
    .prepare(
      `SELECT u.* FROM users u
       JOIN sessions s ON s.user_id = u.id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(sessionId, Date.now()) as User | undefined;
  return row ?? null;
}

export function deleteSession(sessionId: string): void {
  getDB().prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}
