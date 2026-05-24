"use client";

import { useEffect } from "react";
import ChatBubble from "@/components/ChatBubble";
import type { MomentOut } from "@/lib/types";
import { MOOD_TONE } from "@/components/universe/moodTone";

interface Props {
  moment: MomentOut;
  userName: string;
  chapterTitle?: string;
  onClose: () => void;
}

function formatLongDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function MomentDialog({ moment, userName, chapterTitle, onClose }: Props) {
  const tone = MOOD_TONE[moment.mood];
  // Show the FULL exchange — the whole point of opening a moment is to relive
  // it with full context, not see 4 cherry-picked lines.
  const shown = moment.messages;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-3 py-4 sm:px-6 sm:py-5" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-[#070504]/92 backdrop-blur-2xl"
        aria-label="Close memory"
        onClick={onClose}
      />
      <article
        className="relative w-full max-w-[720px] max-h-[92dvh] sm:max-h-[88dvh] overflow-hidden rounded-3xl border border-parchment/15 bg-[#110d0c] shadow-2xl shadow-black/70 momentdialog-enter"
      >
        <div
          className="absolute inset-0 pointer-events-none opacity-80"
          style={{ background: `radial-gradient(circle at 82% 0%, ${tone.glow}, transparent 28%), linear-gradient(180deg, rgba(241,234,216,0.035), transparent 42%)` }}
        />
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 sm:right-4 top-3 sm:top-4 z-10 h-11 w-11 rounded-full border border-parchment/15 bg-ink/70 text-mist hover:text-parchment hover:border-parchment/50 transition touch-target"
          aria-label="Close memory"
        >
          ×
        </button>
        <div className="relative p-4 sm:p-7 flex max-h-[92dvh] sm:max-h-[88dvh] min-h-0 flex-col">
          <div className="flex items-start justify-between gap-4 sm:gap-5 pr-12 mb-4 sm:mb-5 shrink-0 min-w-0">
            <div className="min-w-0">
              <p className="text-[10px] sm:text-xs tracking-[0.25em] text-mist/60 uppercase mb-1.5 sm:mb-2">{formatLongDate(moment.date)}</p>
              {chapterTitle && <p className="serif italic text-mist text-base sm:text-lg truncate">{chapterTitle}</p>}
            </div>
            <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: tone.color, boxShadow: `0 0 18px ${tone.glow}` }} />
          </div>
          <p className="serif italic text-lg sm:text-2xl md:text-3xl leading-snug text-balance mb-5 sm:mb-6 shrink-0 overflow-wrap-anywhere">
            &ldquo;{moment.ai_summary || "A small place the chat still remembers."}&rdquo;
          </p>
          <div className="rounded-2xl border border-parchment/10 bg-[#080605]/78 p-3 sm:p-5 overflow-y-auto memory-scroll min-h-[200px] max-h-[60dvh]">
            {shown.map((m, i) => (
              <ChatBubble key={`${m.ts}-${i}`} msg={m} isUser={m.sender === userName} />
            ))}
          </div>
          <p className="text-mist/45 text-[10px] tracking-[0.22em] uppercase text-center mt-4">
            {shown.length} {shown.length === 1 ? "message" : "messages"} · scroll for the rest
          </p>
        </div>
      </article>
    </div>
  );
}
