import type {
  CuratorOutput,
  Message,
  Milestone,
  MomentCandidate,
  Pattern,
} from "../types";

// Derive 8-12 milestones from Curator output + Pattern Historian + stats.
// No new LLM call — uses what we already have. The Narrator will optionally
// write ai_summary lines for these in a single pass.

interface Input {
  curator: CuratorOutput;
  candidatesById: Map<string, MomentCandidate>;
  patterns: Pattern[];
  messages: Message[];
}

export function deriveTimeline({ curator, candidatesById, patterns, messages }: Input): Milestone[] {
  const conv = messages.filter((m) => !m.isSystem);
  if (conv.length === 0) return [];

  const milestones: Milestone[] = [];

  // 1. First message
  const first = conv[0];
  milestones.push({
    id: "ms_first_message",
    kind: "first_message",
    date: first.ts.slice(0, 10),
    label: "The first message",
    messages: conv.slice(0, Math.min(4, conv.length)),
  });

  // Kept moments indexed by id with rich metadata
  const kept = curator.per_moment.filter((m) => m.keep);
  const keptById = new Map(kept.map((m) => [m.id, m]));

  function pickFirstWithSignature(sig: string): Milestone | null {
    const cand = curator.final_30
      .map((id) => ({ id, meta: keptById.get(id), c: candidatesById.get(id) }))
      .filter((x) => x.meta && x.c && x.meta.signatures?.includes(sig as any))
      .sort((a, b) => a.c!.startTs.localeCompare(b.c!.startTs))[0];
    if (!cand) return null;
    return {
      id: `ms_${sig}`,
      kind: "first_vulnerability",
      date: cand.c!.startTs.slice(0, 10),
      label: "",
      messages: cand.c!.messages,
    };
  }

  const firstShift = pickFirstWithSignature("the_shift");
  if (firstShift) {
    milestones.push({ ...firstShift, kind: "first_vulnerability", label: "The moment something shifted" });
  }

  const firstVuln = pickFirstWithSignature("almost_didnt_say");
  if (firstVuln) {
    milestones.push({ ...firstVuln, id: "ms_first_vulnerability", kind: "first_vulnerability", label: "The thing one of you almost didn't say" });
  }

  // First nickname appearance (from Pattern Historian)
  const firstNickname = patterns
    .filter((p) => p.kind === "nickname" && p.started)
    .sort((a, b) => (a.started ?? "").localeCompare(b.started ?? ""))[0];
  if (firstNickname?.started) {
    milestones.push({
      id: "ms_first_nickname",
      kind: "first_nickname",
      date: firstNickname.started.slice(0, 10),
      label: `"${firstNickname.phrase}" enters the chat`,
    });
  }

  // First fight (highest scored conflict_and_repair, taken chronologically)
  const fights = curator.final_30
    .map((id) => ({ id, meta: keptById.get(id), c: candidatesById.get(id) }))
    .filter((x) => x.meta && x.c && x.meta.signatures?.includes("conflict_and_repair" as any))
    .sort((a, b) => a.c!.startTs.localeCompare(b.c!.startTs));
  if (fights.length > 0) {
    const f = fights[0];
    milestones.push({
      id: "ms_first_fight",
      kind: "first_fight",
      date: f.c!.startTs.slice(0, 10),
      label: "The first hard one",
      messages: f.c!.messages,
    });
    // Biggest repair: highest-scored conflict_and_repair AFTER the first fight
    if (fights.length > 1) {
      const repair = fights.slice(1).sort((a, b) => (b.meta!.score ?? 0) - (a.meta!.score ?? 0))[0];
      milestones.push({
        id: "ms_biggest_repair",
        kind: "biggest_repair",
        date: repair.c!.startTs.slice(0, 10),
        label: "The one you came back from",
        messages: repair.c!.messages,
      });
    }
  }

  // Most active month
  const perMonth = new Map<string, number>();
  for (const m of conv) perMonth.set(m.ts.slice(0, 7), (perMonth.get(m.ts.slice(0, 7)) ?? 0) + 1);
  let busiest: { ym: string; n: number } | null = null;
  for (const [ym, n] of perMonth) if (!busiest || n > busiest.n) busiest = { ym, n };
  if (busiest) {
    milestones.push({
      id: "ms_busiest_month",
      kind: "most_active_month",
      date: `${busiest.ym}-15`,
      label: `${busiest.n.toLocaleString()} messages in ${humanMonth(busiest.ym)}`,
    });
  }

  // Longest silence
  let longestGapDays = 0;
  let longestGapEnd: string | null = null;
  for (let i = 1; i < conv.length; i++) {
    const d = (new Date(conv[i].ts).getTime() - new Date(conv[i - 1].ts).getTime()) / 86400000;
    if (d > longestGapDays) {
      longestGapDays = d;
      longestGapEnd = conv[i].ts;
    }
  }
  if (longestGapDays >= 7 && longestGapEnd) {
    milestones.push({
      id: "ms_longest_silence",
      kind: "longest_silence",
      date: longestGapEnd.slice(0, 10),
      label: `${Math.round(longestGapDays)} days of nothing`,
    });
  }

  // Funniest moment — highest scored 'funny' mood (uses new mood tag)
  const funny = curator.final_30
    .map((id) => ({ id, meta: keptById.get(id), c: candidatesById.get(id) }))
    .filter((x) => x.meta && x.c && (x.meta as any).mood === "funny")
    .sort((a, b) => (b.meta!.score ?? 0) - (a.meta!.score ?? 0))[0];
  if (funny) {
    milestones.push({
      id: "ms_funny",
      kind: "funniest_moment",
      date: funny.c!.startTs.slice(0, 10),
      label: "When you couldn't stop laughing",
      messages: funny.c!.messages,
    });
  }

  // Tender peak — highest tender
  const tender = curator.final_30
    .map((id) => ({ id, meta: keptById.get(id), c: candidatesById.get(id) }))
    .filter((x) => x.meta && x.c && (x.meta as any).mood === "tender")
    .sort((a, b) => (b.meta!.score ?? 0) - (a.meta!.score ?? 0))[0];
  if (tender) {
    milestones.push({
      id: "ms_tender",
      kind: "tender_peak",
      date: tender.c!.startTs.slice(0, 10),
      label: "Soft",
      messages: tender.c!.messages,
    });
  }

  // Last memorable
  const lastKept = curator.final_30
    .map((id) => ({ id, meta: keptById.get(id), c: candidatesById.get(id) }))
    .filter((x) => x.meta && x.c)
    .sort((a, b) => b.c!.startTs.localeCompare(a.c!.startTs))[0];
  if (lastKept) {
    milestones.push({
      id: "ms_last_memorable",
      kind: "last_memorable",
      date: lastKept.c!.startTs.slice(0, 10),
      label: "One of the most recent",
      messages: lastKept.c!.messages,
    });
  }

  // Sort chronologically, dedupe by id, cap at 12
  const seen = new Set<string>();
  const out: Milestone[] = [];
  for (const m of milestones.sort((a, b) => a.date.localeCompare(b.date))) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
    if (out.length >= 12) break;
  }
  return out;
}

function humanMonth(ym: string): string {
  const [y, m] = ym.split("-").map((s) => parseInt(s, 10));
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${months[m - 1]} ${y}`;
}
