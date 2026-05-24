import { MODELS, runJSONModel } from "./client";
import { SYNTHESIZER_SCHEMA } from "./schemas";
import { VOICE_SPEC } from "./voiceSpec";
import type { CuratedMoment, RelationshipType } from "../types";

const SYSTEM_PROMPT = `You are the Year Synthesizer for DearChats.

A separate Year Curator has already done the heavy lifting: for each year of
the relationship, it picked 10-25 best moments. Your job is to assemble the
FINAL ~30 moments for the whole walk, choosing across years with taste.

You are NOT re-curating raw chats. The hard taste work is done. You are
making a SECOND-PASS editorial decision: balancing the years, ensuring
narrative shape across time, removing duplicates of feeling.

== HOW TO CHOOSE ==

1. Treat each year as a chapter of its own. A 4-year chat should not have
   25 moments from year 1 and 5 from year 4. Aim for proportional spread,
   adjusted for how alive each year was.
2. Within a year, take the highest-scored items first.
3. Avoid two moments that feel structurally the same back-to-back across
   years (e.g. two "you said you were tired" repair moments).
4. Preserve the rare ones: "first" / "last" / "the_shift" signatures
   carry the most narrative weight — keep them even if their score is
   not the absolute top.
5. Forgotten / care-without-ceremony moments are the soul of the walk —
   reserve 4-7 slots for them across the final 30.
6. Final count: aim for 30. If the total kept pool is smaller, use what
   you have. Don't pad.

== OUTPUT ==

Return only JSON in the schema you've been given. final_30 must be a list
of moment ids in CHRONOLOGICAL order.

notes_for_narrator: 2-3 sentences in DearChats voice (see Voice Spec
below). This string IS sometimes shown to the user, so:
  - Address them in second person ("you", "he", "she" — never "the
    chat", "the conversation", "the data", "the relationship")
  - Do NOT use the words "chat", "sparse", "rich", "texture", "vibe"
  - Do NOT include schema names, counts, or JSON fragments
    (no "diversity_check", no "tender: 3", no "mood:")
  - Point at concrete recurring details — phrases, dates, rituals —
    not abstract qualities

${VOICE_SPEC}`;

interface YearInput {
  year: number;
  picks: Array<CuratedMoment & { date: string; brief: string; year_note?: string }>;
  year_note?: string;
}

export interface SynthesizerOutput {
  final_30: string[];
  notes_for_narrator: string;
}

export async function runYearSynthesizer(input: {
  per_year: YearInput[];
  relationship_type: RelationshipType;
  user_name: string;
  other_name: string;
  user_gender?: "male" | "female" | "nonbinary";
  other_gender?: "male" | "female" | "nonbinary";
}): Promise<SynthesizerOutput> {
  const pron = (g?: string) =>
    g === "male" ? "he/him" : g === "female" ? "she/her" : g === "nonbinary" ? "they/them" : "";
  const totalPicks = input.per_year.reduce((s, y) => s + y.picks.length, 0);

  // If the input is tiny enough to just take everything, skip the LLM call —
  // we already have curator's chronological order per year.
  if (totalPicks <= 30) {
    const flat = input.per_year
      .flatMap((y) => y.picks)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((m) => m.id);
    const notes = input.per_year
      .filter((y) => y.year_note)
      .map((y) => `${y.year}: ${y.year_note}`)
      .join(" ");
    return {
      final_30: flat,
      notes_for_narrator: notes || "",
    };
  }

  const userMsg = `relationship_type: ${input.relationship_type}
user_name: ${input.user_name}${input.user_gender ? ` (${input.user_gender}; ${pron(input.user_gender)})` : ""}
other_name: ${input.other_name}${input.other_gender ? ` (${input.other_gender}; ${pron(input.other_gender)})` : ""}

per-year curated picks (already filtered for quality — your job is the final cross-year cut):

${input.per_year.map((y) => `=== ${y.year} ${y.year_note ? `— ${y.year_note}` : ""} ===
${y.picks.map((p) =>
  `  ${p.id} | ${p.date} | mood:${p.mood} | sig:[${p.signatures.join(",")}] | score:${p.score}
    reason: ${p.internal_reason}
    brief: ${p.brief}`
).join("\n")}`).join("\n\n")}

Pick the final ~30 in chronological order. Return JSON per the schema.`;

  return runJSONModel<SynthesizerOutput>({
    model: MODELS.curator, // gpt-5.4 — same strong model as the curator
    system: SYSTEM_PROMPT,
    user: userMsg,
    maxTokens: 4000,
    schema: SYNTHESIZER_SCHEMA,
    validate: (v): v is SynthesizerOutput =>
      !!v && typeof v === "object" && Array.isArray((v as { final_30?: unknown }).final_30),
    shapeHint: `{"final_30":["<moment_id>"],"notes_for_narrator":"<string>"}`,
  });
}
