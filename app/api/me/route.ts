import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null });
  return NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name, picture: user.picture },
  });
}
