import { NextRequest, NextResponse } from "next/server";
import { deleteSession } from "@/lib/db/users";
import { SESSION_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";

function publicOrigin(req: NextRequest): string {
  if (process.env.PUBLIC_ORIGIN) return process.env.PUBLIC_ORIGIN.replace(/\/$/, "");

  const callbackUrl = process.env.GOOGLE_CALLBACK_URL;
  if (callbackUrl) {
    try {
      return new URL(callbackUrl).origin;
    } catch {
      // Fall through to request headers.
    }
  }

  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) return `${proto}://${host}`;

  return req.nextUrl.origin;
}

export async function POST(req: NextRequest) {
  const sid = req.cookies.get(SESSION_COOKIE)?.value;
  if (sid) deleteSession(sid);
  const res = NextResponse.redirect(new URL("/", publicOrigin(req)));
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  return POST(req);
}
