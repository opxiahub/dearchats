import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getWalkRowForUser } from "@/lib/db/walks";
import { listMedia } from "@/lib/db/media";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ walkId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { walkId } = await ctx.params;
  const walk = getWalkRowForUser(walkId, user.id);
  if (!walk) return NextResponse.json({ error: "Walk not found" }, { status: 404 });
  const rows = listMedia(walkId);
  return NextResponse.json({
    walkId,
    media: rows.map((r) => ({
      filename: r.filename,
      mime: r.mime,
      bytes: r.bytes,
      ts: r.ts,
      has_person: r.has_person === null ? null : r.has_person === 1,
      kind: r.kind,
      score: r.score,
      caption: r.caption,
      url: `/api/media/${walkId}/${encodeURIComponent(r.filename)}`,
    })),
  });
}
