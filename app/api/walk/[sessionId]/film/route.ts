import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import path from "path";
import fs from "fs/promises";
import { getCurrentUser } from "@/lib/auth/session";
import { getWalkRowForUser } from "@/lib/db/walks";
import {
  getLatestFilmForWalk,
  insertFilm,
  updateFilm,
} from "@/lib/db/films";
import { DEFAULT_FILM_OPTIONS, type FilmOptions } from "@/lib/film/scenes";
import { renderFilmServer } from "@/lib/film/renderServer";
import { listMedia } from "@/lib/db/media";
import type { Walk } from "@/lib/types";

export const runtime = "nodejs";

function publicFilmUrl(walkId: string, filmId: string): string {
  return `/api/walk/${walkId}/film/video?id=${filmId}`;
}

function normalizeOptions(input: Partial<FilmOptions> | undefined): FilmOptions {
  const base = { ...DEFAULT_FILM_OPTIONS };
  if (!input) return base;
  return {
    includeNames: typeof input.includeNames === "boolean" ? input.includeNames : base.includeNames,
    includePhotos: typeof input.includePhotos === "boolean" ? input.includePhotos : base.includePhotos,
    includeMessages: typeof input.includeMessages === "boolean" ? input.includeMessages : base.includeMessages,
    includeMusic: typeof input.includeMusic === "boolean" ? input.includeMusic : base.includeMusic,
    length: input.length === "short" || input.length === "standard" ? input.length : base.length,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { sessionId } = await params;
  const walk = getWalkRowForUser(sessionId, user.id);
  if (!walk) return NextResponse.json({ error: "Walk not found" }, { status: 404 });

  const film = getLatestFilmForWalk(sessionId);
  if (!film) return NextResponse.json({ film: null });
  return NextResponse.json({
    film: {
      id: film.id,
      status: film.status,
      progress: film.progress,
      stage: film.stage,
      options: JSON.parse(film.options_json),
      duration_seconds: film.duration_seconds,
      bytes: film.bytes,
      error: film.error,
      video_url: film.status === "ready" ? publicFilmUrl(sessionId, film.id) : null,
      created_at: film.created_at,
      updated_at: film.updated_at,
    },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { sessionId } = await params;
  const row = getWalkRowForUser(sessionId, user.id);
  if (!row) return NextResponse.json({ error: "Walk not found" }, { status: 404 });
  if (!row.walk_json) return NextResponse.json({ error: "Walk is still loading" }, { status: 409 });

  // If something is already rendering for this walk, return its status instead of starting a second job.
  const existing = getLatestFilmForWalk(sessionId);
  if (existing && (existing.status === "queued" || existing.status === "rendering")) {
    return NextResponse.json({
      film: {
        id: existing.id,
        status: existing.status,
        progress: existing.progress,
        stage: existing.stage,
        options: JSON.parse(existing.options_json),
        video_url: null,
      },
      already_running: true,
    });
  }

  let body: { options?: Partial<FilmOptions> } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const options = normalizeOptions(body.options);

  const walk = JSON.parse(row.walk_json) as Walk;
  const media = listMedia(sessionId).map((m) => ({
    url: `/api/media/${sessionId}/${encodeURIComponent(m.filename)}`,
    filename: m.filename,
    ts: m.ts,
    has_person:
      m.has_person == null ? null : m.has_person === 1,
    kind: m.kind,
    score: m.score,
    caption: m.caption,
  }));

  const filmId = `f_${crypto.randomBytes(10).toString("hex")}`;
  insertFilm({ id: filmId, walk_id: sessionId, options_json: JSON.stringify(options) });

  // Fire-and-forget render. Status updates flow through the films table.
  Promise.resolve().then(async () => {
    try {
      await renderFilmServer({ filmId, walk, media, options });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not render the film.";
      updateFilm(filmId, { status: "error", error: message, stage: "error" });
      // Clean any partial mp4 left behind.
      try {
        const partial = path.join(process.cwd(), ".data", "films", sessionId, `${filmId}.mp4`);
        await fs.unlink(partial);
      } catch {
        // ignore
      }
    }
  });

  return NextResponse.json({
    film: {
      id: filmId,
      status: "queued",
      progress: 0,
      stage: "queued",
      options,
      video_url: null,
    },
  });
}
