import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

function safeRelativePath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://dearchats.local");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

function getEnv() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const cb = process.env.GOOGLE_CALLBACK_URL;
  if (!id || !cb) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CALLBACK_URL not set");
  return { id, cb };
}

export async function GET(req: NextRequest) {
  const { id, cb } = getEnv();
  const state = crypto.randomBytes(16).toString("hex");
  const next = safeRelativePath(req.nextUrl.searchParams.get("next"));
  // Encode 'next' into state so we can redirect back after callback
  const payload = Buffer.from(JSON.stringify({ state, next })).toString("base64url");

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", id);
  url.searchParams.set("redirect_uri", cb);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", payload);
  url.searchParams.set("prompt", "select_account");

  const res = NextResponse.redirect(url.toString());
  res.cookies.set("dc_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
