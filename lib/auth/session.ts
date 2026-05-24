import { cookies } from "next/headers";
import { getUserBySessionId, type User } from "../db/users";

export const SESSION_COOKIE = "dc_sid";

export async function setSessionCookie(sessionId: string) {
  const c = await cookies();
  c.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
}

export async function clearSessionCookie() {
  const c = await cookies();
  c.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<User | null> {
  const c = await cookies();
  const sid = c.get(SESSION_COOKIE)?.value;
  if (!sid) return null;
  return getUserBySessionId(sid);
}
