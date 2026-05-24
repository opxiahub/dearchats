import { MODELS, runJSONModel } from "./client";
import { CURATOR_SCHEMA } from "./schemas";
import { RUBRICS } from "../relationshipRubrics";
import type {
  MomentCandidate,
  CuratorOutput,
  RelationshipType,
  Message,
} from "../types";

const SYSTEM_PROMPT_BASE = `You are the Moment Curator for DearChats, a product that turns years of
WhatsApp messages between two people into a guided emotional walk through
their relationship.

Your job is narrow and high-stakes: from a set of candidate moments
(short threads of messages, with surrounding context windows) you will
choose the ones that, when read years later, would make this person
pause, smile, ache, or remember something they had forgotten they felt.

You are NOT writing for the user. A separate Narrator agent does that.
You are choosing which moments survive, scoring them, and tagging them.
Be honest in your reasoning — it will never be shown to the user.

== THE 7 SIGNATURES ==

The best moments share one of these:

1. ORDINARY-TURNED-PRECIOUS — a logistical or banal exchange that,
   given everything that happened before or after, is quietly
   devastating.

2. FIRST OR LAST OF ITS KIND — the first time a word, gesture, or topic
   appears, or the last. The moment a nickname is born. The final
   "good morning."

3. THE THING THEY ALMOST DIDN'T SAY — vulnerability that breaks the
   pattern of the chat. A confession buried in a long message.

4. CARE WITHOUT CEREMONY — small acts of showing up. Remembering a
   detail. An unprompted "are you okay?"

5. CONFLICT AND REPAIR — the friction, the cooling-off, the return.
   The repair matters more than the fight.

6. RITUALS IN MOTION — a single instance of something that, you can
   tell from context, has happened many times before.

7. THE SHIFT — the moment the relationship visibly changes register:
   from formal to casual, from friends to more, from close to distant.

== WHAT TO REJECT ==

- Pure logistics with no emotional residue
- Generic positivity ("haha", "love you too") UNLESS context makes
  it land
- Anything requiring you to invent backstory to feel meaningful
- The most dramatic moment in the chat, if picking it would make the
  walk feel like a soap opera. Drama is not the same as emotion.

== ANTI-PATTERNS (CRITICAL) ==

- Do not over-index on sadness. The best walks have texture: tenderness,
  friction, silliness, mundanity, repair, AND grief.
- Do not pick the longest or most quotable messages. Often the moment
  is in the gap, the one-word reply, the seen-not-replied beat.
- Do not reward eloquence. Reward truth-at-the-time. A clumsy "I think
  I miss you?" beats a polished paragraph.
- Do not pick more than 2 moments that feel structurally similar.
  Variety across the final 30 is non-negotiable.

== OUTPUT ==

Return ONLY JSON (no prose around it):

{
  "per_moment": [
    {
      "id": "<moment_id>",
      "keep": true|false,
      "score": <0-10, only if keep=true, else 0>,
      "signatures": ["<one or more of the 7 keys above, lowercase>"],
      "mood": "tender"|"funny"|"hard"|"repair"|"forgotten"|"mundane_sacred",
      "chapter_hint": "beginnings"|"becoming"|"ordinary_sacred"|"friction"|"repair"|"distance"|"now",
      "internal_reason": "<one plainspoken sentence — for the Narrator, never shown to the user>",
      "why_not": "<one sentence, only if keep=false>"
    }
  ],
  "final_30": ["<moment_ids in chronological order, exactly 30 if available, fewer if input is small>"],
  "notes_for_narrator": "<see strict rules below>"
}

== notes_for_narrator (CRITICAL — this string is sometimes shown to the USER) ==

2-3 sentences, written in the DearChats voice (see Voice Spec elsewhere
in your instructions). Address the user in second person where natural
("you", "he", "she" — never "the chat", "the user", "the relationship").

You MUST NOT:
  - Use the word "chat", "conversation", "data", "sparse", "rich",
    "texture", "vibe", "energy"
  - Include any field name, count, or JSON-like fragment
    (no "diversity_check", no "tender: 1", no "mood: ...")
  - Meta-narrate ("This chat is...", "These messages show...")
  - Use adjectives doing emotional work ("beautiful", "touching")

You MAY:
  - Quote a specific phrase that recurred ("he asked 'reached?' every
    Thursday")
  - Point at a pattern via concrete nouns ("the recipe she sent four
    days after a fight")
  - Name a small ritual ("the goodnights stopped in March")

Examples of GOOD notes_for_narrator:
  "You sent the grocery list. He sent the recipe back, four days later.
   That was the repair, that whole year."
  "She called him bhaiya for the first time on July 23. After that, it
   stuck."

Signature keys (use these exact strings):
  "ordinary_turned_precious", "first_or_last", "almost_didnt_say",
  "care_without_ceremony", "conflict_and_repair", "rituals_in_motion",
  "the_shift"

Mood guidance:
  - "tender" — affection, warmth, soft expressions of love or care
  - "funny" — jokes, banter, callback humor, chaos that lands
  - "hard" — fights, hurt, distance, the rough edges
  - "repair" — apologies, the return after a fight, soft landings
  - "forgotten" — small care that the user has likely forgotten:
    "did you eat", "got home?", "reached?", small promises, late-night
    one-liners of support. Most moments tagged with "care_without_ceremony"
    will be "forgotten".
  - "mundane_sacred" — ordinary logistics that aged into precious

Pick ONE mood per moment — the dominant one. Aim for spread across moods;
a walk of all "tender" or all "hard" feels flat.

Voice of internal_reason: plain, specific, no adjectives doing emotional
work. NOT "a touching moment of vulnerability" — instead "he says he's
been not-okay for weeks right after asking about her interview, hiding
it inside her news."`;

function buildSystemPrompt(rel: RelationshipType): string {
  return `${SYSTEM_PROMPT_BASE}

== RELATIONSHIP LENS ==

${RUBRICS[rel]}`;
}

function renderMessageBrief(m: Message, indent = "  "): string {
  const t = new Date(m.ts).toISOString().slice(0, 16).replace("T", " ");
  return `${indent}[${t}] ${m.sender}: ${m.text.replace(/\n/g, " / ").slice(0, 320)}`;
}

function renderCandidate(c: MomentCandidate): string {
  const before = (c.contextBefore ?? []).map((m) => renderMessageBrief(m, "  ~ ")).join("\n");
  const main = c.messages.map((m) => renderMessageBrief(m, "  > ")).join("\n");
  const after = (c.contextAfter ?? []).map((m) => renderMessageBrief(m, "  ~ ")).join("\n");
  return `=== ${c.id} ===
context_before:
${before || "  (none)"}
moment:
${main}
context_after:
${after || "  (none)"}`;
}

// Smaller batches → faster individual calls → can run more in parallel.
const BATCH_SIZE = 20;
const CONCURRENCY = 4;

export async function runMomentCurator(
  candidates: MomentCandidate[],
  rel: RelationshipType,
  user_name: string,
  other_name: string,
  onProgress?: (done: number, total: number) => void,
  user_gender?: "male" | "female" | "nonbinary",
  other_gender?: "male" | "female" | "nonbinary",
): Promise<CuratorOutput> {
  function pron(g?: "male" | "female" | "nonbinary"): string {
    if (g === "male") return "he/him";
    if (g === "female") return "she/her";
    if (g === "nonbinary") return "they/them";
    return "";
  }
  const system = buildSystemPrompt(rel);

  const batches: MomentCandidate[][] = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    batches.push(candidates.slice(i, i + BATCH_SIZE));
  }

  const allPerMoment: CuratorOutput["per_moment"] = [];
  const perBatchNotes: string[] = [];
  let nextIdx = 0;
  let done = 0;

  async function processBatch(batch: MomentCandidate[]) {
    const userMsg = `relationship_type: ${rel}
user_name: ${user_name}${user_gender ? ` (${user_gender}; ${pron(user_gender)})` : ""}
other_name: ${other_name}${other_gender ? ` (${other_gender}; ${pron(other_gender)})` : ""}

candidates:

${batch.map(renderCandidate).join("\n\n")}

Return JSON in the schema specified in the system prompt. For this batch
you may emit a final_30 with up to 30 ids from THIS batch; the orchestrator
will reconcile across batches.`;

    try {
      const parsed = await runJSONModel<CuratorOutput>({
        model: MODELS.curator,
        system,
        user: userMsg,
        maxTokens: 8000,
        schema: CURATOR_SCHEMA,
        validate: (v): v is CuratorOutput =>
          !!v && typeof v === "object" && Array.isArray((v as { per_moment?: unknown }).per_moment),
        shapeHint: `{"per_moment":[{"id":"<string>","keep":true|false,"score":<number>,"signatures":["<string>"],"mood":"tender|funny|hard|repair|forgotten|mundane_sacred","chapter_hint":"<chapter_id>","internal_reason":"<string>","why_not":"<string|null>"}],"final_30":["<id>"],"notes_for_narrator":"<string>"}`,
      });
      if (parsed.per_moment) allPerMoment.push(...parsed.per_moment);
      if (parsed.notes_for_narrator) perBatchNotes.push(parsed.notes_for_narrator);
    } catch (err) {
      console.error("[momentCurator] batch failed:", err);
    }
  }

  async function worker() {
    while (true) {
      const i = nextIdx++;
      if (i >= batches.length) return;
      await processBatch(batches[i]);
      done++;
      onProgress?.(done, batches.length);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Global selection: take all kept moments, sort by score, then enforce
  // ~30 with diversity across chapter hints + chronological order.
  const kept = allPerMoment
    .filter((m) => m.keep)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  // Enforce: at most 8 from any single chapter_hint to avoid lopsided walks.
  const chapterCounts = new Map<string, number>();
  const targetTotal = Math.min(30, kept.length);
  const finalIds: string[] = [];
  for (const m of kept) {
    if (finalIds.length >= targetTotal) break;
    const c = chapterCounts.get(m.chapter_hint) ?? 0;
    if (c >= 8) continue;
    finalIds.push(m.id);
    chapterCounts.set(m.chapter_hint, c + 1);
  }
  // If still under target, top up from any remaining (relax constraint).
  if (finalIds.length < targetTotal) {
    for (const m of kept) {
      if (finalIds.length >= targetTotal) break;
      if (!finalIds.includes(m.id)) finalIds.push(m.id);
    }
  }

  // Re-sort chronologically using candidate timestamps
  const idToTs = new Map(candidates.map((c) => [c.id, c.startTs]));
  finalIds.sort((a, b) => (idToTs.get(a) ?? "").localeCompare(idToTs.get(b) ?? ""));

  return {
    per_moment: allPerMoment,
    final_30: finalIds,
    diversity_check: {},
    notes_for_narrator: perBatchNotes.join(" "),
  };
}
