"use client";

import { useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Pattern, Walk } from "@/lib/types";

interface Props {
  open: boolean;
  walk: Walk;
  onClose: () => void;
}

const KIND_LABEL: Record<Pattern["kind"], string> = {
  nickname: "Nickname",
  ritual: "Ritual",
  callback_joke: "Inside joke",
  phrase: "Phrase",
  emoji: "Emoji",
};

const KIND_ORDER: Pattern["kind"][] = ["nickname", "ritual", "callback_joke", "phrase", "emoji"];

function formatLongDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function PrivateDictionary({ open, walk, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", onKey); };
  }, [open, onClose]);

  const grouped = useMemo(() => {
    const patterns = walk.private_dictionary?.patterns ?? [];
    const map = new Map<Pattern["kind"], Pattern[]>();
    for (const p of patterns) {
      const list = map.get(p.kind) ?? [];
      list.push(p);
      map.set(p.kind, list);
    }
    for (const list of map.values()) list.sort((a, b) => b.frequency - a.frequency);
    return map;
  }, [walk]);

  const totals = useMemo(() => {
    const patterns = walk.private_dictionary?.patterns ?? [];
    return {
      count: patterns.length,
      mentions: patterns.reduce((s, p) => s + Math.max(0, p.frequency || 0), 0),
      topPhrase: [...patterns].sort((a, b) => b.frequency - a.frequency)[0],
    };
  }, [walk]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="fixed inset-0 z-[55] bg-[#070504]/96 backdrop-blur-3xl overflow-y-auto memory-scroll"
          role="dialog" aria-modal="true"
        >
          <button
            type="button"
            onClick={onClose}
            className="fixed top-3 sm:top-4 right-3 sm:right-4 z-10 h-11 w-11 rounded-full border border-parchment/20 bg-ink/60 text-mist hover:text-parchment hover:border-parchment/50 transition touch-target"
            aria-label="Close dictionary"
          >×</button>

          <div className="min-h-full px-4 sm:px-8 py-14 sm:py-24 pad-safe-bottom">
            <motion.div
              initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.7 }}
              className="max-w-3xl mx-auto text-center mb-12 sm:mb-16"
            >
              <p className="text-[10px] tracking-[0.45em] text-mist/55 uppercase mb-5">private dictionary</p>
              <h1 className="serif display-lg text-balance mb-6 overflow-wrap-anywhere">
                The words that made a room only you two could enter.
              </h1>
              {walk.private_dictionary?.intro_line && (
                <p className="serif italic text-base sm:text-lg md:text-xl text-mist text-balance leading-relaxed mt-6 overflow-wrap-anywhere">
                  &ldquo;{walk.private_dictionary.intro_line}&rdquo;
                </p>
              )}
            </motion.div>

            <div className="max-w-3xl mx-auto grid grid-cols-3 gap-2 sm:gap-3 mb-12 sm:mb-14">
              <DictStat value={totals.count.toLocaleString()} label="saved words" />
              <DictStat value={totals.mentions.toLocaleString()} label="total mentions" />
              <DictStat value={totals.topPhrase ? `"${totals.topPhrase.phrase}"` : "—"} label="said the most" small />
            </div>

            <div className="max-w-3xl mx-auto space-y-12 sm:space-y-14">
              {KIND_ORDER.map((kind) => {
                const list = grouped.get(kind) ?? [];
                if (list.length === 0) return null;
                return (
                  <section key={kind}>
                    <p className="text-[10px] tracking-[0.4em] uppercase text-gold/60 mb-4 sm:mb-5">{KIND_LABEL[kind]}{list.length > 1 ? "s" : ""}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                      {list.map((p, i) => (
                        <DictCard key={`${p.phrase}-${i}`} pattern={p} index={i} />
                      ))}
                    </div>
                  </section>
                );
              })}
              {grouped.size === 0 && (
                <p className="serif italic text-mist text-center text-lg">No patterns surfaced yet for this chat.</p>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DictStat({ value, label, small }: { value: string; label: string; small?: boolean }) {
  return (
    <div className="rounded-2xl border border-parchment/12 bg-parchment/[0.03] px-3 sm:px-4 py-4 sm:py-5 text-center min-w-0">
      <p className={`${small ? "serif italic text-sm sm:text-lg" : "serif text-xl sm:text-2xl md:text-3xl"} text-parchment/95 mb-1 truncate`}>{value}</p>
      <p className="text-[9px] sm:text-[10px] tracking-[0.22em] sm:tracking-[0.28em] uppercase text-mist/55">{label}</p>
    </div>
  );
}

function DictCard({ pattern, index }: { pattern: Pattern; index: number }) {
  const started = formatLongDate(pattern.started);
  const stopped = formatLongDate(pattern.stopped);
  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10%" }}
      transition={{ duration: 0.6, delay: Math.min(0.35, index * 0.06) }}
      className="relative overflow-hidden rounded-2xl border border-parchment/12 bg-parchment/[0.035] p-5 grain"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="serif italic text-2xl text-parchment/95 overflow-wrap-anywhere leading-snug">
          &ldquo;{pattern.phrase}&rdquo;
        </p>
        <span className="shrink-0 rounded-full border border-parchment/12 px-2 py-0.5 text-[11px] text-mist/65">
          {(pattern.frequency ?? 0).toLocaleString()}×
        </span>
      </div>
      <p className="text-mist text-sm leading-relaxed mb-3 overflow-wrap-anywhere">
        {pattern.meaning_hint}
      </p>
      {(started || stopped) && (
        <p className="text-[10px] tracking-[0.22em] uppercase text-mist/50">
          {started && <span>first used {started}</span>}
          {started && stopped && <span className="mx-1.5 text-mist/30">·</span>}
          {stopped && <span>last seen {stopped}</span>}
        </p>
      )}
    </motion.article>
  );
}
