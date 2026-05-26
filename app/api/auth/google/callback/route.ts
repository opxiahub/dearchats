import { NextRequest, NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { upsertUserFromGoogle, createSession } from "@/lib/db/users";
import { SESSION_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";

function safeRelativePath(value: string | undefined): string {
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
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  const cb = process.env.GOOGLE_CALLBACK_URL;
  if (!id || !secret || !cb) throw new Error("Google OAuth env vars not set");
  return { id, secret, cb };
}

function publicOrigin(req: NextRequest): string {
  if (process.env.PUBLIC_ORIGIN) return process.env.PUBLIC_ORIGIN.replace(/\/$/, "");
  const cb = process.env.GOOGLE_CALLBACK_URL;
  if (cb) {
    try { return new URL(cb).origin; } catch { /* fall through */ }
  }
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) return `${proto}://${host}`;
  return req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  const { id, secret, cb } = getEnv();
  const origin = publicOrigin(req);
  const code = req.nextUrl.searchParams.get("code");
  const stateRaw = req.nextUrl.searchParams.get("state");
  if (!code || !stateRaw) {
    return NextResponse.redirect(new URL("/?auth_error=missing_code", origin));
  }

  // Verify CSRF state
  let next = "/";
  let statePayload: { state: string; next?: string };
  try {
    statePayload = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf-8"));
    next = safeRelativePath(statePayload.next);
  } catch {
    return NextResponse.redirect(new URL("/?auth_error=bad_state", origin));
  }
  const stateCookie = req.cookies.get("dc_oauth_state")?.value;
  if (!stateCookie || stateCookie !== statePayload.state) {
    return NextResponse.redirect(new URL("/?auth_error=state_mismatch", origin));
  }

  const client = new OAuth2Client({ clientId: id, clientSecret: secret, redirectUri: cb });

  try {
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) throw new Error("No id_token in token response");
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: id });
    const payload = ticket.getPayload();
    if (!payload?.sub) throw new Error("Invalid Google ID token payload");

    const user = upsertUserFromGoogle({
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    });
    const sessionId = createSession(user.id);

    const res = NextResponse.redirect(new URL(next, origin));
    res.cookies.set(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    res.cookies.delete("dc_oauth_state");
    return res;
  } catch (err) {
    console.error("[auth/callback] failed", err);
    return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent("oauth_failed")}`, origin));
  }
}
