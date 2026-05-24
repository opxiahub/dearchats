"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface ProfileUser {
  name: string | null;
  email: string | null;
  picture: string | null;
}

function initials(user: ProfileUser): string {
  const source = user.name || user.email || "you";
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "Y";
}

export default function ProfileMenu({ user }: { user: ProfileUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-11 w-11 rounded-full border border-parchment/25 bg-ink/60 shadow-2xl shadow-black/40 overflow-hidden hover:border-parchment/70 transition touch-target"
        aria-label="Open profile menu"
        aria-expanded={open}
      >
        {user.picture ? (
          <img src={user.picture} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <span className="flex h-full w-full items-center justify-center serif text-sm text-parchment bg-parchment/10">
            {initials(user)}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-3 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-parchment/15 bg-[#100c0b]/95 backdrop-blur-xl shadow-2xl shadow-black/60 p-4 text-left z-50">
          <div className="flex items-center gap-3 pb-4 border-b border-parchment/10">
            <div className="h-12 w-12 rounded-full overflow-hidden border border-parchment/20 bg-parchment/10 shrink-0">
              {user.picture ? (
                <img src={user.picture} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <span className="flex h-full w-full items-center justify-center serif text-base text-parchment">{initials(user)}</span>
              )}
            </div>
            <div className="min-w-0">
              <p className="serif text-lg text-parchment truncate">{user.name || "Your profile"}</p>
              {user.email && <p className="text-xs text-mist/70 truncate">{user.email}</p>}
            </div>
          </div>

          <div className="py-2">
            <Link
              href="/profile"
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-3 text-sm text-mist hover:bg-parchment/10 hover:text-parchment transition min-h-11"
            >
              View generations
            </Link>
            <a
              href="/api/auth/signout"
              className="block rounded-lg px-3 py-3 text-sm text-mist hover:bg-parchment/10 hover:text-parchment transition min-h-11"
            >
              Sign out
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
