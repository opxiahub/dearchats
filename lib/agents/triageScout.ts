import { MODELS, runJSONModel } from "./client";
import { SCOUT_SCHEMA } from "./schemas";
import type { MomentCandidate, ScoutTag } from "../types";

const SYSTEM_PROMPT = `You are the Triage Scout for DearChats. Your job is volume work, not
artistry: from many candidate moments, separate the ones with ANY
emotional residue from the ones that are pure logistics.

You are the first filter. You will be wrong sometimes. Bias toward
KEEPING anything that might matter — a later, smarter agent will make
the final call. False negatives (dropping a real moment) hurt the
product. False positives (keeping a forgettable moment) only cost
compute. Err generously.

== KEEP IF the moment contains ANY of ==

- Emotion words, even small ones ("hate", "miss", "scared", "proud",
  "sorry", "thank you" said with weight, "I can't", "I love")
- A question that probes feeling ("are you okay?", "what's wrong?",
  "you good?")
- A confession, apology, or admission
- A pet name, nickname, or term of endearment
- A first-time-something tone (announcement, revealing news)
- A late-night timestamp (after midnight) combined with substance
- A long message from either person (signals weight)
- A long pause INSIDE the thread (someone took time to reply)
- A callback that hints at a shared joke or ritual
- A reference to family, home, a date, an anniversary, a place
- Conflict markers: "fine.", "whatever", "we need to talk", silence
  after a heavy message
- Care without ceremony: "did you eat", "got home?", "take care"

== DROP IF the moment is ==

- Pure logistics with no affect: addresses, times, "ok", "k", "lol"
  exchanges, link-sharing without comment, group-event coordination
- Forwarded content with no personal reaction
- Deleted-message markers with no surrounding context

== OUTPUT ==

Return a JSON object with a single key "items" whose value is an array, one entry per input:
{
  "items": [
    {"id": "<moment_id>",
     "keep": true|false,
     "heat": 0|1|2|3,
     "tag": "ordinary"|"care"|"conflict"|"vulnerability"|"ritual"|"joke"|"first_or_last"|"longing"|"repair"|"mundane_sacred"|"unsure"}
  ]
}

Be fast. Do not explain.`;

function renderMoment(c: MomentCandidate): string {
  const date = new Date(c.startTs).toISOString().slice(0, 16).replace("T", " ");
  const lines = c.messages
    .map((m) => `  ${m.sender}: ${m.text.replace(/\n/g, " / ").slice(0, 240)}`)
    .join("\n");
  return `--- ${c.id} (${date}) ---\n${lines}`;
}

const BATCH_SIZE = 30;

export async function runTriageScout(
  candidates: MomentCandidate[],
  onProgress?: (done: number, total: number) => void,
): Promise<ScoutTag[]> {
  const results: ScoutTag[] = [];
  const batches: MomentCandidate[][] = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    batches.push(candidates.slice(i, i + BATCH_SIZE));
  }

  // Run in parallel with limited concurrency. The API will rate-limit us if needed.
  const CONCURRENCY = 12;
  let nextIdx = 0;
  let done = 0;

  const worker = async () => {
    while (true) {
      const i = nextIdx++;
      if (i >= batches.length) return;
      const batch = batches[i];
      const userMsg = batch.map(renderMoment).join("\n\n");

      try {
        const parsed = await runJSONModel<{ items: ScoutTag[] }>({
          model: MODELS.scout,
          system: SYSTEM_PROMPT,
          user: userMsg,
          maxTokens: 4096,
          schema: SCOUT_SCHEMA,
          validate: (v): v is { items: ScoutTag[] } =>
            !!v && typeof v === "object" && Array.isArray((v as { items?: unknown }).items),
          shapeHint: `{"items":[{"id":"<string>","keep":true|false,"heat":0|1|2|3,"tag":"<string>"}]}`,
        });
        for (const tag of parsed.items) {
          results.push({
            id: tag.id,
            keep: !!tag.keep,
            heat: (Math.max(0, Math.min(3, tag.heat ?? 0)) as 0 | 1 | 2 | 3),
            tag: tag.tag ?? "unsure",
          });
        }
      } catch (err) {
        void err;
        // If a batch fails, default to keeping all — bias toward recall.
        for (const c of batch) {
          results.push({ id: c.id, keep: true, heat: 1, tag: "unsure" });
        }
      }
      done++;
      onProgress?.(done, batches.length);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

// Convenience: filter candidates by scout result, keeping top ~150.
export function applyScoutFilter(
  candidates: MomentCandidate[],
  tags: ScoutTag[],
  limit = 150,
): MomentCandidate[] {
  const byId = new Map(tags.map((t) => [t.id, t]));
  const scored = candidates
    .map((c) => ({ c, t: byId.get(c.id) }))
    .filter(({ t }) => t && t.keep)
    .sort((a, b) => (b.t!.heat - a.t!.heat));
  return scored.slice(0, limit).map(({ c }) => c);
}
