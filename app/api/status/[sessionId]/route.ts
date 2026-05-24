import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getVignettes, getWalkRowForUser } from "@/lib/db/walks";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const walk = getWalkRowForUser(sessionId, user.id);
  if (!walk) {
    return NextResponse.json({ error: "Walk not found" }, { status: 404 });
  }
  const vignettes = getVignettes(sessionId);
  return NextResponse.json({
    session_id: sessionId,
    stage: walk.stage,
    progress: walk.progress,
    vignettes,
    error: walk.error,
    partial_ready: !!walk.partial_ready,
    done: walk.walk_json != null && walk.stage === "done",
  });
}
