import { parseWhatsAppText } from "../parser/whatsapp";
import { segmentMessages, attachContext, computeOpeningStats } from "../parser/segmenter";
import { runTriageScout, applyScoutFilter } from "../agents/triageScout";
import { runMomentCurator } from "../agents/momentCurator";
import { runYearSynthesizer } from "../agents/yearSynthesizer";
import { runPatternHistorian } from "../agents/patternHistorian";
import { runArcCartographer } from "../agents/arcCartographer";
import { runNarrator } from "../agents/narrator";
import { runOpeningScribe, pickTimelineSamples } from "../agents/openingScribe";
import { buildVignettePool, computeChatStats } from "./vignettes";
import { deriveTimeline } from "./timeline";
import {
  getWalkRow,
  pushVignette,
  setPartialWalkJSON,
  setWalkJSON,
  updateWalkStatus,
} from "../db/walks";
import type {
  Chapter,
  ChapterId,
  CuratorOutput,
  Message,
  MomentCandidate,
  MomentOut,
  Mood,
  Walk,
  YearSignature,
} from "../types";

// In-memory cache for the parsed/scouted artifacts of each walk, so phase B
// doesn't have to re-parse the raw chat after the user picks relationship.
// Sized small (we only have a single user typing at a time in dev).
interface EagerArtifacts {
  messages: Message[];
  allCandidates: MomentCandidate[];
  survivors: MomentCandidate[];
  chapters: Chapter[];
  patterns: Awaited<ReturnType<typeof runPatternHistorian>>;
  openingLine: string;
  openingStats: ReturnType<typeof computeOpeningStats>;
  vignettePool: string[];
  vignetteIdx: number;
  // Set to true only once Phase A fully completes — Phase B must not run before this.
  phaseAComplete: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __dearchats_eager: Map<string, EagerArtifacts> | undefined;
}
const eager: Map<string, EagerArtifacts> =
  global.__dearchats_eager || (global.__dearchats_eager = new Map());

const SCOUT_SURVIVOR_TARGET = 150;

// Last line of defense for text that gets shown to the user. Strips:
//   - Anything resembling "diversity_check: ..." schema dumps
//   - Banned meta words the prompts already forbid ("this chat", "texture")
//   - Stray sentences that lead with "this chat"/"the chat"
function sanitizeUserFacing(raw: string): string {
  let s = raw.trim();
  // Cut off at the first "diversity_check" or similar schema leak.
  s = s.replace(/\s*\bdiversity_check\b[\s\S]*$/i, "").trim();
  s = s.replace(/\s*\b(per_moment|chapter_hint|signatures|notes_for_narrator)\b[^.]*$/i, "").trim();
  // Drop sentences that start with "this chat" / "the chat" / "this conversation".
  s = s
    .split(/(?<=[.!?])\s+/)
    .filter((sent) => !/^\s*(this|the)\s+(chat|conversation|data|relationship)\b/i.test(sent))
    .join(" ")
    .trim();
  // Strip wrapping straight or curly quotes the model sometimes adds.
  s = s.replace(/^["'“”]+/, "").replace(/["'“”]+$/, "").trim();
  return s;
}

function pumpVignettes(walkId: string) {
  const a = eager.get(walkId);
  if (!a) return;
  if (a.vignetteIdx < a.vignettePool.length) {
    pushVignette(walkId, a.vignettePool[a.vignetteIdx++]);
  }
}

/**
 * Phase A — runs as soon as the user uploads the file.
 * Everything here is relationship-agnostic so we don't waste compute
 * if the user changes their mind.
 */
export async function runPhaseA(walkId: string): Promise<void> {
  const walk = getWalkRow(walkId);
  if (!walk) throw new Error("walk not found");

  try {
    updateWalkStatus(walkId, { stage: "parsing", progress: 0.02 });
    const parsed = parseWhatsAppText(walk.raw_chat);
    if (parsed.messages.length === 0) {
      throw new Error(
        "We couldn't parse any messages from that file. Make sure it's a WhatsApp chat export (.txt or .zip without media).",
      );
    }
    const messages = parsed.messages;
    const openingStats = computeOpeningStats(messages);

    // Vignette pool — derived from the actual chat
    const chatStats = computeChatStats(messages);
    const vignettePool = buildVignettePool(chatStats);

    eager.set(walkId, {
      messages,
      allCandidates: [],
      survivors: [],
      chapters: [],
      patterns: [],
      openingLine: "",
      openingStats,
      vignettePool,
      vignetteIdx: 0,
      phaseAComplete: false,
    });
    pumpVignettes(walkId);

    // Pacing timer — keep pushing vignettes throughout the run.
    const vignetteTimer = setInterval(() => pumpVignettes(walkId), 2200);

    try {
      updateWalkStatus(walkId, { stage: "segmenting", progress: 0.06 });
      const allCandidates = segmentMessages(messages);
      eager.get(walkId)!.allCandidates = allCandidates;

      // Scout + Cartographer in parallel (both relationship-agnostic)
      updateWalkStatus(walkId, { stage: "scouting", progress: 0.12 });
      const [tags, chapters] = await Promise.all([
        runTriageScout(allCandidates, (done, total) => {
          updateWalkStatus(walkId, { progress: 0.12 + 0.18 * (done / total) });
        }),
        // Cartographer doesn't take relationship type today (it's a generic
        // chapter mapper). Pass a neutral hint — we'll re-tone chapter titles
        // in the Narrator pass anyway.
        runArcCartographer(messages, "romantic", walk.user_name, walk.other_name),
      ]);
      const survivors = applyScoutFilter(allCandidates, tags, SCOUT_SURVIVOR_TARGET);
      const survivorsWithCtx = attachContext(messages, survivors, 8);
      eager.get(walkId)!.survivors = survivorsWithCtx;
      eager.get(walkId)!.chapters = chapters;

      // Pattern Historian in parallel with Opening Scribe (both small)
      updateWalkStatus(walkId, { stage: "patterns", progress: 0.32 });
      const openingSamples = pickTimelineSamples(messages, 14);
      const [patterns, openingLine] = await Promise.all([
        runPatternHistorian(messages, "romantic", walk.user_name, walk.other_name),
        runOpeningScribe({
          relationship_type: "romantic",
          user_name: walk.user_name,
          other_name: walk.other_name,
          opening_stats: { ...openingStats, user_name: walk.user_name, other_name: walk.other_name },
          chapters,
          samples: openingSamples,
        }),
      ]);
      eager.get(walkId)!.patterns = patterns;
      eager.get(walkId)!.openingLine = openingLine;

      // Mark Phase A complete BEFORE saving — Phase B checks this flag.
      eager.get(walkId)!.phaseAComplete = true;

      // Save a partial walk so the user can navigate as soon as Phase A ends.
      const partial: Walk = {
        session_id: walkId,
        relationship_type: walk.relationship,
        opening: {
          ...openingStats,
          user_name: walk.user_name,
          other_name: walk.other_name,
          user_raw_name: walk.user_raw_name ?? walk.user_name,
          other_raw_name: walk.other_raw_name ?? walk.other_name,
          user_gender: walk.user_gender ?? undefined,
          other_gender: walk.other_gender ?? undefined,
          line: openingLine,
        },
        timeline: [],
        chapters,
        moments: [],
        private_dictionary: { intro_line: "The words only the two of you say.", patterns },
        forgotten: { intro_line: "The small care you stopped noticing.", moment_ids: [] },
      };
      setPartialWalkJSON(walkId, partial);
      updateWalkStatus(walkId, { stage: "awaiting_relationship", progress: 0.40, partial_ready: true });
    } finally {
      clearInterval(vignetteTimer);
    }
  } catch (err) {
    console.error("[orchestrator phaseA]", err);
    updateWalkStatus(walkId, { stage: "error", error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Phase B — fires when the user confirms relationship + names.
 * Curator + Narrator are the heavy LLM stages here.
 */
export async function runPhaseB(walkId: string): Promise<void> {
  const walk = getWalkRow(walkId);
  if (!walk) throw new Error("walk not found");
  const artifacts = eager.get(walkId);
  if (!artifacts || !artifacts.phaseAComplete) {
    // Eager artifacts missing or Phase A still running (server restart, or user
    // submitted the form before Phase A finished). Block until Phase A is done.
    console.log("[orchestrator phaseB] waiting for Phase A to complete…");
    await runPhaseA(walkId);
    return runPhaseB(walkId);
  }

  // Continue pumping vignettes through phase B too.
  const vignetteTimer = setInterval(() => pumpVignettes(walkId), 2200);

  try {
    const { messages, allCandidates, survivors, chapters, patterns, openingStats } = artifacts;
    const candidatesById = new Map(allCandidates.map((c) => [c.id, c]));

    function pickChapter(momentDate: string, hint: ChapterId): ChapterId {
      if (chapters.some((c) => c.id === hint)) return hint;
      const d = momentDate.slice(0, 10);
      const containing = chapters.find((c) => d >= c.span_start && d <= c.span_end);
      return (containing?.id ?? chapters[0]?.id ?? "now") as ChapterId;
    }

    // ── Per-year curation ──────────────────────────────────────────────
    // Group survivors by year. Each year is curated independently and in
    // parallel — smaller context per call, dedicated attention per year,
    // and a real "year signature" line for each.
    updateWalkStatus(walkId, { stage: "curating", progress: 0.45 });

    const survivorsByYear = new Map<number, MomentCandidate[]>();
    for (const c of survivors) {
      const y = Number(c.startTs.slice(0, 4));
      const list = survivorsByYear.get(y) ?? [];
      list.push(c);
      survivorsByYear.set(y, list);
    }

    // Full chat year range — even empty years get a signature entry
    const firstYear = Number(openingStats.first_date.slice(0, 4));
    const lastYear = Number(openingStats.last_date.slice(0, 4));
    const allYears: number[] = [];
    for (let y = firstYear; y <= lastYear; y++) allYears.push(y);

    // Precompute message counts per year for the year signatures.
    const msgsByYear = new Map<number, number>();
    for (const m of messages) {
      if (m.isSystem) continue;
      const y = Number(m.ts.slice(0, 4));
      msgsByYear.set(y, (msgsByYear.get(y) ?? 0) + 1);
    }

    const yearsWithCandidates = [...survivorsByYear.keys()].sort();
    let yearProgress = 0;
    const yearOutputs = await Promise.all(
      yearsWithCandidates.map(async (year) => {
        const yearCands = survivorsByYear.get(year)!;
        const out = await runMomentCurator(
          yearCands,
          walk.relationship,
          walk.user_name,
          walk.other_name,
          () => {
            yearProgress += 1 / Math.max(1, yearsWithCandidates.length * 3);
            updateWalkStatus(walkId, {
              progress: Math.min(0.72, 0.45 + 0.27 * Math.min(1, yearProgress)),
            });
          },
          walk.user_gender ?? undefined,
          walk.other_gender ?? undefined,
        );
        return { year, out };
      }),
    );

    // Build per-year picks for the synthesizer (only kept moments)
    const perYearPicksForSynth = yearOutputs.map(({ year, out }) => {
      const kept = out.per_moment.filter((m) => m.keep);
      const picks = kept.map((m) => {
        const cand = candidatesById.get(m.id);
        const brief = cand?.messages.slice(0, 2).map((mm) => `${mm.sender}: ${mm.text.slice(0, 80)}`).join(" / ") ?? "";
        return {
          id: m.id,
          keep: m.keep,
          score: m.score,
          signatures: m.signatures,
          mood: m.mood,
          chapter_hint: m.chapter_hint,
          internal_reason: m.internal_reason,
          date: cand?.startTs.slice(0, 10) ?? `${year}-06-15`,
          brief,
          year_note: out.notes_for_narrator,
        };
      });
      return { year, picks, year_note: out.notes_for_narrator };
    });

    // ── Synthesis ──────────────────────────────────────────────────────
    updateWalkStatus(walkId, { stage: "curating", progress: 0.74 });
    const synth = await runYearSynthesizer({
      per_year: perYearPicksForSynth,
      relationship_type: walk.relationship,
      user_name: walk.user_name,
      other_name: walk.other_name,
      user_gender: walk.user_gender ?? undefined,
      other_gender: walk.other_gender ?? undefined,
    });

    // Aggregate per_moment across years so existing downstream code keeps
    // working (timeline derivation etc).
    const aggregated: CuratorOutput = {
      per_moment: yearOutputs.flatMap(({ out }) => out.per_moment),
      final_30: synth.final_30,
      diversity_check: {},
      notes_for_narrator: synth.notes_for_narrator,
    };

    // Year signatures — one per year in the full range, including empties.
    const noteByYear = new Map(yearOutputs.map(({ year, out }) => [year, out.notes_for_narrator]));
    const countByYear = new Map<number, number>();
    for (const m of aggregated.per_moment) {
      if (!m.keep) continue;
      const cand = candidatesById.get(m.id);
      if (!cand) continue;
      const y = Number(cand.startTs.slice(0, 4));
      countByYear.set(y, (countByYear.get(y) ?? 0) + 1);
    }
    const yearSignatures: YearSignature[] = allYears.map((year) => {
      const msgCount = msgsByYear.get(year) ?? 0;
      const momentCount = countByYear.get(year) ?? 0;
      const hasActivity = msgCount > 0;
      const note = noteByYear.get(year);
      const cleaned = note ? sanitizeUserFacing(note) : "";
      const line = !hasActivity
        ? `${year} went by without a single message.`
        : cleaned.length > 0
          ? cleaned
          : `${year} held ${momentCount} ${momentCount === 1 ? "memory" : "memories"} across ${msgCount.toLocaleString()} messages.`;
      return {
        year,
        is_empty: !hasActivity,
        line,
        moment_count: momentCount,
        message_count: msgCount,
      };
    });

    const curatedById = new Map(
      aggregated.per_moment.filter((m) => m.keep).map((m) => [m.id, m]),
    );
    const curator = aggregated;

    const finalMomentsRaw = curator.final_30
      .map((id) => {
        const cand = candidatesById.get(id);
        const meta = curatedById.get(id);
        if (!cand || !meta) return null;
        return {
          id,
          chapter_id: pickChapter(cand.startTs, meta.chapter_hint),
          date: cand.startTs.slice(0, 10),
          mood: (meta.mood ?? "tender") as Mood,
          messages: cand.messages,
          curator_internal_reason: meta.internal_reason,
          signatures: meta.signatures,
        };
      })
      .filter(<T,>(x: T | null): x is T => x !== null);

    // Narrator — single call writes all the user-facing prose
    updateWalkStatus(walkId, { stage: "narrating", progress: 0.80 });
    const narratorOut = await runNarrator({
      relationship_type: walk.relationship,
      user_name: walk.user_name,
      other_name: walk.other_name,
      user_gender: walk.user_gender ?? undefined,
      other_gender: walk.other_gender ?? undefined,
      opening_stats: { ...openingStats, user_name: walk.user_name, other_name: walk.other_name },
      chapters,
      patterns,
      moments: finalMomentsRaw,
      curator_notes_for_narrator: curator.notes_for_narrator,
    });

    // Compose final walk
    const ctxByMoment = new Map(narratorOut.moment_contexts.map((m) => [m.moment_id, m.line]));
    const intrByChapter = new Map(narratorOut.chapter_intros.map((c) => [c.chapter_id, c.line]));

    const titledChapters: Chapter[] = chapters.map((c) => ({
      ...c,
      title: intrByChapter.get(c.id) ?? c.title,
    }));

    const moments: MomentOut[] = finalMomentsRaw.map((m) => ({
      id: m.id,
      chapter_id: m.chapter_id,
      date: m.date,
      mood: m.mood,
      ai_summary: ctxByMoment.get(m.id) ?? "",
      signatures: m.signatures,
      messages: m.messages,
    }));

    // Timeline derived from curator + patterns + messages (no LLM)
    const timeline = deriveTimeline({
      curator,
      candidatesById,
      patterns,
      messages,
    });

    // Forgotten moments — those whose mood OR signature flags them
    const forgottenIds = moments
      .filter((m) => m.mood === "forgotten" || m.signatures.includes("care_without_ceremony"))
      .map((m) => m.id);

    const finalWalk: Walk = {
      session_id: walkId,
      relationship_type: walk.relationship,
      opening: {
        ...openingStats,
        user_name: walk.user_name,
        other_name: walk.other_name,
        user_raw_name: walk.user_raw_name ?? walk.user_name,
        other_raw_name: walk.other_raw_name ?? walk.other_name,
        user_gender: walk.user_gender ?? undefined,
        other_gender: walk.other_gender ?? undefined,
        line: narratorOut.opening_card_line || artifacts.openingLine,
      },
      timeline,
      chapters: titledChapters,
      moments,
      year_signatures: yearSignatures,
      private_dictionary: {
        intro_line: narratorOut.private_dictionary_intro || "The words only the two of you say.",
        patterns,
      },
      forgotten: {
        intro_line: narratorOut.forgotten_section_intro || "The small care you stopped noticing.",
        moment_ids: forgottenIds,
      },
      is_final: true,
    };

    setWalkJSON(walkId, finalWalk);
  } catch (err) {
    console.error("[orchestrator phaseB]", err);
    updateWalkStatus(walkId, { stage: "error", error: err instanceof Error ? err.message : String(err) });
  } finally {
    clearInterval(vignetteTimer);
  }
}
