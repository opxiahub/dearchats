import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { getCurrentUser } from "@/lib/auth/session";
import { getWalkRowForUser } from "@/lib/db/walks";
import { mediaPath, mimeFor } from "@/lib/db/media";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ walkId: string; filename: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Not signed in", { status: 401 });
  const { walkId, filename } = await ctx.params;
  const walk = getWalkRowForUser(walkId, user.id);
  if (!walk) return new NextResponse("Walk not found", { status: 404 });
  const safe = decodeURIComponent(filename).replace(/[\\/]/g, "");
  const fp = mediaPath(walkId, safe);
  if (!fs.existsSync(fp)) return new NextResponse("Not found", { status: 404 });
  const buf = fs.readFileSync(fp);
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": mimeFor(safe),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
