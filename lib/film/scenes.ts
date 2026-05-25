import type { ChapterId, MomentOut, Walk } from "@/lib/types";

// "short" ≈ 30s, "standard" ≈ 1 min. Default is the full 1-minute film —
// this is the shareable artifact, so it earns the longer arc.
export type FilmLength = "short" | "standard";

export interface FilmOptions {
  includeNames: boolean;
  includePhotos: boolean;
  includeMessages: boolean;
  includeMusic: boolean;
  length: FilmLength;
}

export const DEFAULT_FILM_OPTIONS: FilmOptions = {
  includeNames: true,
  includePhotos: true,
  includeMessages: true,
  includeMusic: true,
  length: "standard",
};

export interface FilmMedia {
  url: string;            // public-relative or absolute URL (for client) — server uses filename instead
  filename: string;
  ts: string | null;
  has_person?: boolean | null;
  kind?: string | null;
  score?: number | null;  // 0..3 memorability from the vision classifier
  caption?: string | null; // one-line vision description
}

/**
 * Output of the LLM Film Director (server-side). When present it overrides the
 * deterministic arc: the director chooses which curated moments to show, in what
 * order, and writes a one-line caption per scene in the DearChats voice. When the
 * director call is skipped or fails, `buildFilmScenes` falls back to the
 * deterministic arc-builder below — so the film always renders.
 */
export interface FilmPlan {
  ordered_moment_ids: string[];
  captions: Record<string, string>;
  opening_line?: string;
  dictionary_phrase?: string | null;
  dictionary_hint?: string | null;
  forgotten_moment_id?: string | null;
  closing_line?: string;
}

export type FilmScene =
  | { kind: "opening"; duration: number; line?: string }
  | { kind: "moment"; duration: number; moment: MomentOut; caption?: string }
  | { kind: "photo"; duration: number; photo: FilmMedia; label: string }
  | { kind: "dictionary"; duration: number; phrase: string; hint: string }
  | { kind: "forgotten"; duration: number; moment: MomentOut; caption?: string }
  | { kind: "ending"; duration: number; line?: string };

interface LengthSpec {
  moments: number;
  opening: number;
  moment: number;
  dictionary: number;
  forgotten: number;
  ending: number;
  useDictionary: boolean;
}

// Durations tuned so a still + caption (and up to two message bubbles) can be
// read calmly. Totals: short ≈ 29s, standard ≈ 59s.
const LENGTH_SPEC: Record<FilmLength, LengthSpec> = {
  short: { moments: 6, opening: 3.2, moment: 3.4, dictionary: 0, forgotten: 3.2, ending: 2.4, useDictionary: false },
  standard: { moments: 10, opening: 4.5, moment: 4.3, dictionary: 4.0, forgotten: 4.5, ending: 3.0, useDictionary: true },
};

export function targetMomentCount(length: FilmLength): number {
  return LENGTH_SPEC[length].moments;
}

function photoBeatTargetFor(options: FilmOptions): number {
  return options.includePhotos ? (options.length === "short" ? 2 : 4) : 0;
}

/** How many text moments the film will actually use, after reserving beats for
 * shared photos. Pass this to the Film Director so it builds a complete arc. */
export function plannedTextCount(media: FilmMedia[], options: FilmOptions): number {
  const spec = LENGTH_SPEC[options.length];
  const beats = availablePhotoCount(media, photoBeatTargetFor(options));
  return Math.max(2, spec.moments - beats);
}

const CHAPTER_ORDER: ChapterId[] = [
  "beginnings",
  "becoming",
  "ordinary_sacred",
  "friction",
  "repair",
  "distance",
  "now",
];

export function buildFilmScenes(
  walk: Walk,
  media: FilmMedia[],
  options: FilmOptions,
  plan?: FilmPlan | null,
  seed = 0,
): FilmScene[] {
  const spec = LENGTH_SPEC[options.length];

  // Shared photos become their OWN beats, captioned by when they were shared —
  // never forced under an unrelated emotional caption. This is the only honest
  // way to use them: WhatsApp photos rarely land on the same day as a curated
  // text moment, so pairing them is either empty (strict) or random (loose).
  // How many beats we'll fill is independent of which photos / seed, so the text
  // budget below stays stable.
  const photoTarget = photoBeatTargetFor(options);
  const photoCount = availablePhotoCount(media, photoTarget);

  // Text moments fill the rest of the beat budget so total length stays on target.
  const textCount = Math.max(2, spec.moments - photoCount);

  // Pick the moments that carry the arc. The director's order wins when present;
  // otherwise build an arc deterministically (chapter + year + mood spread).
  let picked: MomentOut[];
  if (plan?.ordered_moment_ids?.length) {
    const byId = new Map(walk.moments.map((m) => [m.id, m]));
    picked = plan.ordered_moment_ids
      .map((id) => byId.get(id))
      .filter((m): m is MomentOut => Boolean(m))
      .slice(0, textCount);
    if (picked.length === 0) picked = selectArcMoments(walk.moments, textCount);
  } else {
    picked = selectArcMoments(walk.moments, textCount);
  }

  // Now choose the actual photos: best vision score per timeline segment, biased
  // toward the dates of the moments that made the cut so photos sit near a
  // related beat. `seed` varies the picks between renders (fresh remakes).
  const photoBeats = selectPhotoBeats(media, photoTarget, {
    anchorDates: picked.map((m) => m.date),
    seed,
  });

  const scenes: FilmScene[] = [
    { kind: "opening", duration: spec.opening, line: plan?.opening_line },
  ];

  // Interleave text moments and photo beats chronologically so the film reads
  // as one timeline (undated photos sort to the end of the body).
  const body: Array<{ sortKey: string; scene: FilmScene }> = [];
  for (const moment of picked) {
    body.push({
      sortKey: moment.date,
      scene: { kind: "moment", duration: spec.moment, moment, caption: plan?.captions?.[moment.id] },
    });
  }
  for (const beat of photoBeats) {
    body.push({
      sortKey: beat.photo.ts ?? "9999-12-31",
      scene: { kind: "photo", duration: spec.moment, photo: beat.photo, label: beat.label },
    });
  }
  body.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  for (const b of body) scenes.push(b.scene);

  if (spec.useDictionary) {
    const phrase = plan?.dictionary_phrase ?? walk.private_dictionary?.patterns?.[0]?.phrase;
    const hint = plan?.dictionary_hint ?? walk.private_dictionary?.patterns?.[0]?.meaning_hint;
    if (phrase && hint) {
      scenes.push({ kind: "dictionary", duration: spec.dictionary, phrase, hint });
    }
  }

  const forgotten = resolveForgotten(walk, plan, picked);
  if (forgotten) {
    scenes.push({
      kind: "forgotten",
      duration: spec.forgotten,
      moment: forgotten,
      caption: plan?.captions?.[forgotten.id],
    });
  }

  scenes.push({ kind: "ending", duration: spec.ending, line: plan?.closing_line });
  return scenes;
}

function resolveForgotten(walk: Walk, plan: FilmPlan | null | undefined, picked: MomentOut[]): MomentOut | null {
  const pickedIds = new Set(picked.map((m) => m.id));
  const find = (id: string | null | undefined) =>
    id ? walk.moments.find((m) => m.id === id) ?? null : null;
  const directorChoice = find(plan?.forgotten_moment_id);
  if (directorChoice) return directorChoice;
  const fromList =
    walk.forgotten?.moment_ids?.map((id) => walk.moments.find((m) => m.id === id)).find(Boolean) ?? null;
  if (fromList) return fromList;
  // Prefer a forgotten-flavored moment that isn't already in the main arc.
  return (
    walk.moments.find(
      (m) => !pickedIds.has(m.id) && (m.mood === "forgotten" || m.signatures.includes("care_without_ceremony")),
    ) ??
    walk.moments.find((m) => m.mood === "forgotten" || m.signatures.includes("care_without_ceremony")) ??
    null
  );
}

/**
 * Deterministic emotional arc. Goal: relive the *whole* relationship, not just
 * the highest-scoring peaks. Strategy:
 *   1. Seed with the strongest moment from each chapter, in canonical order.
 *   2. Anchor the very first and very last moments of the chat (the bookends).
 *   3. Fill remaining slots by score, penalizing repeated year+mood so the cut
 *      doesn't stack five tender moments from one year.
 * Returns chronological order so the film reads as a timeline.
 */
function selectArcMoments(moments: MomentOut[], count: number): MomentOut[] {
  const byDate = (a: MomentOut, b: MomentOut) => a.date.localeCompare(b.date);
  if (moments.length <= count) return [...moments].sort(byDate);

  const scored = moments.map((m) => ({ m, s: scoreMoment(m) }));
  const picked = new Set<string>();
  const result: MomentOut[] = [];
  const bucketKey = (m: MomentOut) => `${m.date.slice(0, 4)}|${m.mood}`;
  const bucketCounts = new Map<string, number>();
  const take = (m: MomentOut) => {
    picked.add(m.id);
    result.push(m);
    bucketCounts.set(bucketKey(m), (bucketCounts.get(bucketKey(m)) ?? 0) + 1);
  };

  // 1. one strongest moment per chapter, canonical order
  for (const ch of CHAPTER_ORDER) {
    if (result.length >= count) break;
    const best = scored
      .filter((x) => x.m.chapter_id === ch && !picked.has(x.m.id))
      .sort((a, b) => b.s - a.s)[0];
    if (best) take(best.m);
  }

  // 2. anchor the bookends of the entire chat
  const chrono = [...moments].sort(byDate);
  for (const anchor of [chrono[0], chrono[chrono.length - 1]]) {
    if (result.length >= count) break;
    if (anchor && !picked.has(anchor.id)) take(anchor);
  }

  // 3. fill remaining by score, penalizing year+mood clustering
  while (result.length < count) {
    let best: MomentOut | null = null;
    let bestVal = -Infinity;
    for (const { m, s } of scored) {
      if (picked.has(m.id)) continue;
      const penalty = (bucketCounts.get(bucketKey(m)) ?? 0) * 1.5;
      const val = s - penalty;
      if (val > bestVal) {
        bestVal = val;
        best = m;
      }
    }
    if (!best) break;
    take(best);
  }

  return result.sort(byDate);
}

function scoreMoment(moment: MomentOut): number {
  return (
    (moment.signatures.includes("the_shift") ? 5 : 0) +
    (moment.signatures.includes("first_or_last") ? 4 : 0) +
    (moment.signatures.includes("conflict_and_repair") ? 3 : 0) +
    (moment.signatures.includes("almost_didnt_say") ? 3 : 0) +
    (moment.signatures.includes("ordinary_turned_precious") ? 2 : 0) +
    (moment.signatures.includes("rituals_in_motion") ? 2 : 0) +
    (moment.mood === "tender" ? 2 : 0) +
    (moment.mood === "repair" ? 2 : 0) +
    (moment.mood === "funny" ? 1 : 0)
  );
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// "2021-08-03" → "August 2021". Empty string when the photo carries no date
// (WhatsApp filename had none) — the beat then renders without a date kicker.
function photoLabel(ts: string | null | undefined): string {
  if (!ts) return "";
  const m = ts.match(/^(\d{4})-(\d{2})/);
  if (!m) return "";
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : m[1];
}

interface PhotoBeat {
  photo: FilmMedia;
  label: string;
}

/**
 * Build the candidate pool of film-worthy photos: real photos first
 * (screenshots/wallpapers excluded when we have enough real ones), and anything
 * the vision classifier scored 0 (screenshot/wallpaper/junk) is never eligible
 * unless it's all we have.
 */
function photoPool(media: FilmMedia[], target: number): FilmMedia[] {
  const ranked = [...media].sort((a, b) => tierOf(a) - tierOf(b));
  const good = ranked.filter((m) => tierOf(m) <= 2 && (m.score == null || m.score >= 1));
  if (good.length >= Math.max(1, target)) return good;
  // Fall back gradually so a sparse album still produces something.
  const decent = ranked.filter((m) => tierOf(m) <= 3);
  return decent.length >= Math.max(1, target) ? decent : ranked;
}

/** How many photo beats the film will actually show (count is seed-independent). */
function availablePhotoCount(media: FilmMedia[], target: number): number {
  if (target <= 0 || media.length === 0) return 0;
  return Math.min(target, photoPool(media, target).length);
}

/**
 * Choose up to `target` real shared photos to show as their own beats. Quality
 * comes from the vision classifier's memorability score (people-photos and
 * meaningful shots rank highest); spread comes from splitting the timeline into
 * `target` segments and taking the best-scoring photo in each, biased toward the
 * dates of the moments that made the cut so a photo sits near a related beat. A
 * `seed` breaks ties differently between renders, so fresh remakes vary.
 * Returns [] when photos are off or none were uploaded → the film is all text.
 */
function selectPhotoBeats(
  media: FilmMedia[],
  target: number,
  opts?: { anchorDates?: string[]; seed?: number },
): PhotoBeat[] {
  if (target <= 0 || media.length === 0) return [];

  const seed = opts?.seed ?? 0;
  const anchors = (opts?.anchorDates ?? [])
    .map(toDayNumber)
    .filter((d): d is number => d != null);

  const pool = photoPool(media, target);
  const composite = (m: FilmMedia): number => {
    let s = m.score == null ? 1.5 : m.score; // unscored → neutral-positive
    if (m.has_person === true) s += 1.5;
    if (m.kind === "photo") s += 0.5;
    const day = toDayNumber(m.ts);
    if (anchors.length && day != null) {
      const dist = Math.min(...anchors.map((a) => Math.abs(a - day)));
      if (dist <= 7) s += 1.2;
      else if (dist <= 31) s += 0.6;
    }
    return s;
  };

  const dated = pool.filter((m) => m.ts).sort((a, b) => (a.ts as string).localeCompare(b.ts as string));
  const undated = pool.filter((m) => !m.ts);

  const chosen: FilmMedia[] = [];
  if (dated.length) {
    const segs = Math.min(target, dated.length);
    for (let i = 0; i < segs; i++) {
      const start = Math.floor((i * dated.length) / segs);
      const end = Math.max(Math.floor(((i + 1) * dated.length) / segs), start + 1);
      const slice = dated.slice(start, end).filter((m) => !chosen.includes(m));
      if (slice.length === 0) continue;
      const sorted = [...slice].sort((a, b) => composite(b) - composite(a));
      // Pick among the top contenders so equally-strong photos rotate per seed.
      const topN = sorted.slice(0, Math.min(2, sorted.length));
      chosen.push(topN[seededIndex(seed + i, topN.length)]);
    }
  }
  // Fill any remaining slots by raw composite (leftover dated, then undated).
  if (chosen.length < target) {
    const rest = [...dated, ...undated]
      .filter((m) => !chosen.includes(m))
      .sort((a, b) => composite(b) - composite(a));
    for (const m of rest) {
      if (chosen.length >= target) break;
      chosen.push(m);
    }
  }

  chosen.sort((a, b) => (a.ts ?? "9999-12-31").localeCompare(b.ts ?? "9999-12-31"));
  return chosen.slice(0, target).map((photo) => ({ photo, label: photoLabel(photo.ts) }));
}

// Days since epoch from an ISO date string (YYYY-MM-DD), or null.
function toDayNumber(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const t = Date.parse(ts);
  return Number.isNaN(t) ? null : Math.floor(t / 86_400_000);
}

// Deterministic index in [0, n) from an integer seed — used to vary tie-breaks
// between renders without any global RNG state.
function seededIndex(seed: number, n: number): number {
  if (n <= 1) return 0;
  let x = (seed * 2654435761) >>> 0;
  x ^= x >>> 15;
  x = (x * 2246822519) >>> 0;
  return x % n;
}

function tierOf(item: FilmMedia): number {
  if (item.has_person === true) return 1;
  if (item.kind === "photo") return 2;
  if (item.has_person == null && item.kind == null) return 3;
  return 4;
}
