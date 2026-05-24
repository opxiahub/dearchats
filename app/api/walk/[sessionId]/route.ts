import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getWalkRowForUser } from "@/lib/db/walks";

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
  if (!walk.walk_json) {
    // Phase A hasn't saved a partial walk yet.
    if (walk.stage === "error") {
      return NextResponse.json({ error: walk.error ?? "Processing failed" }, { status: 500 });
    }
    return NextResponse.json({ error: "Walk not ready yet" }, { status: 425 });
  }
  const walkObj = JSON.parse(walk.walk_json);
  // If Phase B errored out after Phase A saved the partial walk, surface the
  // error so the walk page can stop polling instead of spinning forever.
  if (walk.stage === "error") {
    return NextResponse.json({ ...walkObj, pipeline_error: walk.error ?? "Processing failed" });
  }
  return NextResponse.json(walkObj);
}
