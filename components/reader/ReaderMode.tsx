"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { Chapter, MomentOut, Walk } from "@/lib/types";
import { MOOD_TONE } from "@/components/universe/moodTone";

interface Props {
  walk: Walk;
  chapters: Chapter[];
  media: Array<{ url: string; ts: string | null; filename: string; has_person?: boolean | null; kind?: string | null }>;
  onOpenMoment: (id: string) => void;
  onOpenImage: (url: string) => void;
  musicOn: boolean;
  selectedYear?: number | null;
  onOpenVideo?: () => void;
}

interface PhotoPick {
  url: string;
  ts: string | null;
  has_person?: boolean | null;
  kind?: string | null;
}

// Same idea as the universe picker: weight photos by how close they sit to
// curated moments, with bookends. Kept here independent so the reader stays
// usable even if the universe code shifts.
function selectPhotos(
  media: PhotoPick[],
  moments: MomentOut[],
  limit: number,
): PhotoPick[] {
  if (media.length === 0) return [];
  const tierOf = (m: PhotoPick): number => {
    if (m.has_person === true) return 1;
    if (m.kind === "photo") return 2;
    if (m.has_person == null && m.kind == null) return 3;
    return 4;
  };
  if (media.length <= limit) return [...media].sort((a, b) => (a.ts ?? "") < (b.ts ?? "") ? -1 : 1);

  const weight = new Map<string, number>();
  for (const m of moments) {
    const key = m.date.slice(0, 7);
    const important =
      m.signatures.includes("first_or_last") ||
      m.signatures.includes("the_shift") ||
      m.signatures.includes("conflict_and_repair");
    weight.set(key, (weight.get(key) ?? 0) + (important ? 2 : 1));
  }
  const scored = media.map((m) => {
    const baseScore = m.ts ? (weight.get(m.ts.slice(0, 7)) ?? 0) : 0.05;
    return { ...m, score: baseScore, tier: tierOf(m) };
  });
  const picked = new Set<string>();
  const out: typeof scored = [];

  const tier1Sorted = scored.filter((s) => s.tier === 1 && s.ts).sort((a, b) => (a.ts! < b.ts! ? -1 : 1));
  const tsSource = tier1Sorted.length >= 2 ? tier1Sorted : scored.filter((s) => s.ts).sort((a, b) => (a.ts! < b.ts! ? -1 : 1));
  if (tsSource[0]) { out.push(tsSource[0]); picked.add(tsSource[0].url); }
  if (tsSource[tsSource.length - 1] && !picked.has(tsSource[tsSource.length - 1].url)) {
    out.push(tsSource[tsSource.length - 1]);
    picked.add(tsSource[tsSource.length - 1].url);
  }

  for (const tier of [1, 2, 3, 4]) {
    if (out.length >= limit) break;
    const pool = scored
      .filter((s) => s.tier === tier && !picked.has(s.url))
      .sort((a, b) => b.score - a.score);
    for (const item of pool) {
      if (out.length >= limit) break;
      out.push(item);
      picked.add(item.url);
    }
  }
  return out.sort((a, b) => (a.ts ?? "") < (b.ts ?? "") ? -1 : 1);
}

function formatLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function trimPreview(messages: MomentOut["messages"]): MomentOut["messages"] {
  if (messages.length <= 4) return messages;
  const firstReal = messages.findIndex((m) => m.text.length > 12);
  const center = firstReal >= 0 ? firstReal : Math.floor(messages.length / 2);
  const start = Math.max(0, center - 1);
  return messages.slice(start, start + 4);
}

export default function ReaderMode({ walk, chapters, media, onOpenMoment, onOpenImage, musicOn, selectedYear, onOpenVideo }: Props) {
  const moments = useMemo(() => {
    const sorted = [...walk.moments].sort((a, b) => a.date.localeCompare(b.date));
    if (selectedYear == null) return sorted;
    return sorted.filter((m) => m.date.startsWith(String(selectedYear)));
  }, [walk.moments, selectedYear]);
  const yearMedia = useMemo(() => {
    if (selectedYear == null) return media;
    return media.filter((m) => m.ts?.startsWith(String(selectedYear)));
  }, [media, selectedYear]);
  void yearMedia;
  const momentsByChapter = useMemo(() => {
    const m = new Map<string, MomentOut[]>();
    for (const mo of moments) {
      const list = m.get(mo.chapter_id) ?? [];
      list.push(mo);
      m.set(mo.chapter_id, list);
    }
    return m;
  }, [moments]);

  const photos = useMemo(() => selectPhotos(yearMedia, moments, 16), [yearMedia, moments]);
  // Interleave photo bands between chapters.
  const photoBandPerChapter = useMemo(() => {
    if (photos.length === 0 || chapters.length === 0) return new Map<string, PhotoPick[]>();
    const result = new Map<string, PhotoPick[]>();
    const perBand = Math.max(2, Math.ceil(photos.length / Math.max(1, chapters.length - 1)));
    let cursor = 0;
    chapters.forEach((c, i) => {
      if (i === 0) return; // band goes BEFORE chapter (i.e., end of prior)
      const slice = photos.slice(cursor, cursor + perBand);
      if (slice.length > 0) result.set(c.id, slice);
      cursor += perBand;
    });
    return result;
  }, [photos, chapters]);

  void musicOn;

  const forgotten = useMemo(
    () => moments.filter((m) => m.mood === "forgotten" || m.signatures.includes("care_without_ceremony")),
    [moments],
  );

  return (
    <div className="absolute inset-0 overflow-y-auto memory-scroll bg-ink">
      {/* Opening */}
      <section className="min-h-[88dvh] flex flex-col items-center justify-center px-5 sm:px-6 text-center relative">
        <div className="absolute inset-0 pointer-events-none memory-sky" />
        {selectedYear != null ? (
          <YearOpening walk={walk} selectedYear={selectedYear} />
        ) : (
          <>
            <motion.p
              initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ duration: 1.0 }}
              className="text-[10px] tracking-[0.4em] text-mist/60 uppercase mb-8 sm:mb-10"
            >
              this is the story of
            </motion.p>
            <motion.p
              initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ duration: 1.0, delay: 0.2 }}
              className="serif display-lg mb-3 text-balance"
            >
              {walk.opening.duration_human}
            </motion.p>
            <motion.p
              initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
              transition={{ duration: 1.0, delay: 0.5 }}
              className="serif text-base sm:text-lg md:text-xl text-mist mb-10 sm:mb-12 text-balance overflow-wrap-anywhere"
            >
              {walk.opening.message_count.toLocaleString()} messages between {walk.opening.user_name} & {walk.opening.other_name}
            </motion.p>
            <motion.p
              initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
              transition={{ duration: 1.2, delay: 0.8 }}
              className="serif italic text-lg sm:text-xl md:text-2xl text-balance max-w-xl text-parchment/90 leading-relaxed"
            >
              &ldquo;{walk.opening.line}&rdquo;
            </motion.p>
          </>
        )}
        <p className="absolute bottom-6 sm:bottom-8 text-[10px] tracking-[0.3em] uppercase text-mist/40">scroll</p>
      </section>

      {/* Chapters */}
      {chapters.map((chapter, ci) => {
        const chapterMoments = momentsByChapter.get(chapter.id) ?? [];
        if (chapterMoments.length === 0) return null;
        const introLine = walk.moments[0] ? null : null; // narrator chapter_intros aren't on the Walk type at this layer
        void introLine;
        const tone = MOOD_TONE[chapterMoments[0].mood];
        const photoBand = photoBandPerChapter.get(chapter.id);
        return (
          <section
            key={chapter.id}
            data-chapter-idx={ci}
          >
            {/* Photo band before the chapter — center-aligned on desktop,
                horizontally snap-scrolling on phones so it never overflows. */}
            {photoBand && photoBand.length > 0 && (
              <div className="relative py-10 sm:py-16">
                <div className="photo-band-scroll flex items-center sm:justify-center gap-4 px-5 sm:px-6 -rotate-1 overflow-x-auto sm:overflow-visible">
                  {photoBand.slice(0, 5).map((p, i) => (
                    <motion.button
                      key={p.url}
                      type="button"
                      onClick={() => onOpenImage(p.url)}
                      initial={{ opacity: 0, y: 30, rotate: (i % 2 ? 1 : -1) * 4 }}
                      whileInView={{ opacity: 1, y: 0, rotate: (i % 2 ? 1 : -1) * (3 + i) }}
                      viewport={{ once: true, margin: "-15%" }}
                      transition={{ duration: 0.9, delay: i * 0.08 }}
                      className="block rounded-md bg-[#f3eadb] p-2 sm:p-3 shadow-2xl shadow-black/50 hover:scale-105 transition-transform shrink-0 w-[110px] h-[140px] sm:w-[130px] sm:h-[160px]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt="" className="h-[78%] w-full object-cover rounded-sm" />
                      {p.ts && (
                        <p className="mt-1 text-center text-[9px] tracking-widest uppercase text-[#3a2a1c]/60">
                          {p.ts.slice(0, 7)}
                        </p>
                      )}
                    </motion.button>
                  ))}
                </div>
              </div>
            )}

            {/* Chapter intro card */}
            <div
              className="relative min-h-[55dvh] sm:min-h-[60dvh] flex flex-col items-center justify-center px-5 sm:px-6 text-center overflow-hidden"
              style={{ background: `radial-gradient(ellipse at 50% 40%, ${tone.glow}, transparent 55%)` }}
            >
              <motion.p
                initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
                transition={{ duration: 0.8 }}
                className="text-[10px] tracking-[0.4em] text-mist/55 uppercase mb-5"
              >
                chapter {ci + 1}
              </motion.p>
              <motion.h2
                initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                transition={{ duration: 1.0 }}
                className="serif display-lg text-balance max-w-3xl overflow-wrap-anywhere"
              >
                {chapter.title}
              </motion.h2>
              <motion.p
                initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
                transition={{ duration: 1.0, delay: 0.4 }}
                className="mt-6 text-mist text-sm tracking-[0.2em] uppercase"
              >
                {chapterMoments.length} {chapterMoments.length === 1 ? "memory" : "memories"} held here
              </motion.p>
            </div>

            {/* Moments */}
            <div className="max-w-3xl mx-auto px-5 sm:px-8 py-14 space-y-12">
              {chapterMoments.map((m) => (
                <MomentBlock
                  key={m.id}
                  moment={m}
                  userName={walk.opening.user_raw_name ?? walk.opening.user_name}
                  onOpen={() => onOpenMoment(m.id)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {/* Forgotten finale */}
      {forgotten.length > 0 && (
        <section
          data-chapter-idx={chapters.length}
          className="relative px-5 sm:px-6 py-20 sm:py-32 pad-safe-bottom"
          style={{ background: "radial-gradient(ellipse at 50% 30%, rgba(241,234,216,0.08), transparent 60%)" }}
        >
          <div className="max-w-2xl mx-auto text-center">
            <motion.p
              initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
              transition={{ duration: 0.9 }}
              className="text-[10px] tracking-[0.4em] text-mist/55 uppercase mb-5"
            >
              what was forgotten
            </motion.p>
            <motion.h2
              initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ duration: 1.0 }}
              className="serif text-2xl sm:text-4xl md:text-5xl leading-tight text-balance mb-10 sm:mb-12"
            >
              The small care that survived.
            </motion.h2>
            <ol className="space-y-7 text-left">
              {forgotten.map((m) => (
                <motion.li
                  key={m.id}
                  initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-10%" }}
                  transition={{ duration: 0.7 }}
                  className="border-l border-parchment/20 pl-5"
                >
                  <p className="text-[10px] tracking-[0.28em] uppercase text-mist/50 mb-2">{formatLongDate(m.date)}</p>
                  <button
                    type="button"
                    onClick={() => onOpenMoment(m.id)}
                    className="serif italic text-base sm:text-lg md:text-xl leading-snug text-parchment/90 text-left hover:text-parchment transition overflow-wrap-anywhere"
                  >
                    &ldquo;{m.ai_summary}&rdquo;
                  </button>
                </motion.li>
              ))}
            </ol>
          </div>
        </section>
      )}

      <section className="py-20 text-center">
        <p className="serif italic text-mist/55 text-lg">that&apos;s the walk.</p>
        {onOpenVideo && selectedYear == null && (
          <button
            type="button"
            onClick={onOpenVideo}
            className="mt-6 rounded-full border border-gold/35 bg-gold/10 px-5 py-3 text-xs tracking-[0.24em] uppercase text-parchment/85 hover:border-gold/60 hover:text-parchment transition"
          >
            make a memory film
          </button>
        )}
      </section>
    </div>
  );
}

function YearOpening({ walk, selectedYear }: { walk: Walk; selectedYear: number }) {
  const sig = walk.year_signatures?.find((s) => s.year === selectedYear);
  return (
    <>
      <motion.p
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9 }}
        className="text-[10px] tracking-[0.4em] text-mist/60 uppercase mb-8"
      >
        the year
      </motion.p>
      <motion.p
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.15 }}
        className="serif display-xl mb-6"
      >
        {selectedYear}
      </motion.p>
      {sig?.is_empty ? (
        <motion.p
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.0, delay: 0.5 }}
          className="serif italic text-lg sm:text-xl text-mist text-balance max-w-lg leading-relaxed"
        >
          {sig.line}
        </motion.p>
      ) : (
        <>
          {sig?.line && (
            <motion.p
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.0, delay: 0.4 }}
              className="serif italic text-lg sm:text-xl md:text-2xl text-balance max-w-xl text-parchment/90 leading-relaxed mb-6"
            >
              &ldquo;{sig.line}&rdquo;
            </motion.p>
          )}
          {sig && (
            <motion.p
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9, delay: 0.7 }}
              className="text-[10px] tracking-[0.3em] uppercase text-mist/55"
            >
              {sig.moment_count} {sig.moment_count === 1 ? "memory" : "memories"} · {sig.message_count.toLocaleString()} messages
            </motion.p>
          )}
        </>
      )}
    </>
  );
}

function MomentBlock({
  moment,
  userName,
  onOpen,
}: {
  moment: MomentOut;
  userName: string;
  onOpen: () => void;
}) {
  const tone = MOOD_TONE[moment.mood];
  const preview = useMemo(() => trimPreview(moment.messages), [moment.messages]);
  return (
    <motion.article
      data-mood={moment.mood}
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-12%" }}
      transition={{ duration: 0.9 }}
      className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-4 sm:gap-7"
    >
      {/* Mood color strip — vertical label hides on phones; the dot + line
          still carry the mood signal without eating horizontal room. */}
      <div className="flex flex-col items-center gap-3 pt-2">
        <span
          className="h-3 w-3 rounded-full"
          style={{ background: tone.color, boxShadow: `0 0 14px ${tone.glow}` }}
        />
        <span
          className="flex-1 w-px"
          style={{ background: `linear-gradient(180deg, ${tone.color}88, transparent)` }}
        />
        <p className="hidden sm:block serif italic text-[10px] tracking-[0.25em] uppercase text-mist/55 [writing-mode:vertical-rl] rotate-180">
          {tone.label}
        </p>
      </div>

      <div className="min-w-0">
        <p className="text-[10px] tracking-[0.3em] uppercase text-mist/55 mb-3 sm:mb-4">{formatLongDate(moment.date)}</p>
        <button
          type="button"
          onClick={onOpen}
          className="block w-full text-left group"
        >
          <p className="serif italic text-xl sm:text-2xl md:text-3xl leading-snug text-balance text-parchment/95 group-hover:text-parchment transition overflow-wrap-anywhere">
            &ldquo;{moment.ai_summary || "A small place the chat still remembers."}&rdquo;
          </p>
        </button>
        <div className="mt-5 sm:mt-6 grid gap-1.5">
          {preview.map((m, i) => {
            const isUser = m.sender === userName;
            return (
              <div
                key={`${m.ts}-${i}`}
                className={`max-w-[88%] sm:max-w-[78%] rounded-2xl px-3 py-2 text-sm leading-snug overflow-wrap-anywhere ${
                  isUser
                    ? "ml-auto bg-rose/15 text-parchment/90 rounded-br-md"
                    : "bg-parchment/[0.05] text-parchment/80 rounded-bl-md"
                }`}
              >
                {m.text.length > 180 ? m.text.slice(0, 180) + "…" : m.text}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="mt-4 text-[11px] tracking-[0.24em] uppercase text-mist/55 hover:text-parchment transition"
        >
          open the full exchange →
        </button>
      </div>
    </motion.article>
  );
}
