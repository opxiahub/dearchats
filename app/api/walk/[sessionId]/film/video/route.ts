import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { getCurrentUser } from "@/lib/auth/session";
import { getWalkRowForUser } from "@/lib/db/walks";
import { getFilm, getLatestReadyFilmForWalk } from "@/lib/db/films";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { sessionId } = await params;
  const walk = getWalkRowForUser(sessionId, user.id);
  if (!walk) return NextResponse.json({ error: "Walk not found" }, { status: 404 });

  const idParam = new URL(req.url).searchParams.get("id");
  const film = idParam ? getFilm(idParam) : getLatestReadyFilmForWalk(sessionId);
  if (!film || film.walk_id !== sessionId || film.status !== "ready" || !film.mp4_path) {
    return NextResponse.json({ error: "No film available yet" }, { status: 404 });
  }

  let info;
  try {
    info = await stat(film.mp4_path);
  } catch {
    return NextResponse.json({ error: "Film file is missing" }, { status: 410 });
  }

  const range = req.headers.get("range");
  const downloadParam = new URL(req.url).searchParams.get("download");
  const filename = `dearchats-memory-film.mp4`;
  const baseHeaders: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  if (downloadParam) {
    baseHeaders["Content-Disposition"] = `attachment; filename="${filename}"`;
  }

  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : info.size - 1;
      const chunkSize = end - start + 1;
      const stream = fs.createReadStream(film.mp4_path, { start, end });
      return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${end}/${info.size}`,
          "Content-Length": String(chunkSize),
        },
      });
    }
  }

  const fullStream = fs.createReadStream(film.mp4_path);
  return new NextResponse(Readable.toWeb(fullStream) as ReadableStream, {
    status: 200,
    headers: { ...baseHeaders, "Content-Length": String(info.size) },
  });
}

// Keep stray __filename import out of the bundle.
void path;
