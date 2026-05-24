import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { deleteWalk } from "@/lib/db/walks";

export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ walkId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { walkId } = await params;
  const deleted = deleteWalk(walkId, user.id);
  if (!deleted) return NextResponse.json({ error: "Generation not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
