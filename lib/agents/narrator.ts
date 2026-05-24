import { MODELS, runJSONModel } from "./client";
import { NARRATOR_SCHEMA } from "./schemas";
import { VOICE_SPEC } from "./voiceSpec";
import type {
  Chapter,
  Message,
  NarratorOutput,
  OpeningStats,
  Pattern,
  RelationshipType,
} from "../types";

const GOLDEN_EXAMPLES = `GOLDEN EXAMPLES — STUDY THE VOICE

— Opening Card Lines —

[Romantic, 6-year chat, ended a year ago]
"Six years of good mornings, one ordinary Tuesday they stopped."

[Best friends, college through marriage]
"You met at nineteen and have been roasting each other since;
the jokes got slower, the loyalty did not."

[Siblings, mid-twenties, scattered cities]
"Three cities, two timezones, one shared family WhatsApp you both
mute — and this thread, where the actual talking happens."

— Chapter Intros —

"The careful months."
"After her father got sick."
"The year you both pretended to be fine."
"When the jokes came back."
"Now."

— Moment Contexts —

[Romantic, "are you home?" sent at 2:14am]
"You sent this for the four-hundredth time. Three weeks later
she moved to Berlin."

[Best friend, long voice-note rant followed by "ok rant over thanks"]
"He let you have the whole rant and then said 'same time tomorrow'.
He meant it."

[Sibling, "did you eat" with no reply for 6 hours]
"She asked. You forgot to answer. She asked again the next day."

[Romantic, first time 'love' appears in the chat]
"Buried in a message about laundry. Neither of you addressed it
the next morning."

[Best friend, fight → silence → meme three days later]
"Three days of nothing, then a screenshot of a dog. That was the
apology."

[Sibling, mid-pandemic, "mom is being weird again"]
"This is the closest either of you got to saying you were worried."`;

const SYSTEM_PROMPT = `${VOICE_SPEC}

You are the Narrator of DearChats. You receive a fully curated walk
(opening stats, ~30 selected moments with the Curator's private internal
reasons, a chapter map, and patterns from the Historian).

You will produce, in one pass:

1. opening_card_line — ONE sentence (max ~18 words) that captures
   the emotional signature of THIS specific chat. Not generic. Must
   reference something only true of this relationship.

2. chapter_intros — one line per chapter (max ~10 words each).
   Mood-setting, not summary. Examples of the right register:
   "Then came winter." / "The year you went quiet."

3. moment_contexts — for EACH moment, ONE sentence (max ~22 words).
   This line is shown on the FRONT of a flip card; tapping reveals the
   actual messages. So the line should make the user want to tap.
   Use the Curator's internal_reason as your private source.
   NEVER restate the message. Point at:
   - the timing ("this was three weeks before she moved")
   - the silence around it ("she didn't reply for two days")
   - the pattern it broke or began ("the first time he said it first")
   - what was happening underneath

4. forgotten_section_intro — ONE line (max ~12 words) for the section
   titled "Moments you may have forgotten". Quiet and specific. Examples:
   "The small care you stopped noticing."
   "What you said when you were tired."

5. private_dictionary_intro — ONE line (max ~12 words) for the section
   that lists nicknames, recurring phrases, inside jokes. Examples:
   "The words only the two of you say."
   "Your private language."

6. timeline_intro — ONE line (max ~12 words) for the milestone timeline
   at the top. Examples:
   "The shape of it, in eight moments."
   "Eleven turning points."

${GOLDEN_EXAMPLES}

== OUTPUT ==

Return ONLY JSON, no prose, no fences:
{
  "opening_card_line": "<one sentence>",
  "chapter_intros": [
    {"chapter_id": "<one of the chapter ids in the input>", "line": "<one short line>"}
  ],
  "moment_contexts": [
    {"moment_id": "<id>", "line": "<one sentence, max ~22 words>"}
  ],
  "forgotten_section_intro": "<one line>",
  "private_dictionary_intro": "<one line>",
  "timeline_intro": "<one line>"
}

If you find yourself reaching for "beautiful", "powerful", "touching",
"journey" — stop and rewrite. Return to specifics.`;

interface NarratorInput {
  relationship_type: RelationshipType;
  user_name: string;
  other_name: string;
  user_gender?: "male" | "female" | "nonbinary";
  other_gender?: "male" | "female" | "nonbinary";
  opening_stats: OpeningStats;
  chapters: Chapter[];
  patterns: Pattern[];
  moments: Array<{
    id: string;
    date: string;
    chapter_id: string;
    messages: Message[];
    curator_internal_reason: string;
    signatures: string[];
  }>;
  curator_notes_for_narrator: string;
}

function pronounFor(g: "male" | "female" | "nonbinary"): string {
  if (g === "male") return "he/him";
  if (g === "female") return "she/her";
  return "they/them";
}

function renderMessages(msgs: Message[]): string {
  return msgs
    .map((m) => `  ${m.sender}: ${m.text.replace(/\n/g, " / ").slice(0, 240)}`)
    .join("\n");
}

export async function runNarrator(input: NarratorInput): Promise<NarratorOutput> {
  const userMsg = `relationship_type: ${input.relationship_type}
user_name: ${input.user_name}${input.user_gender ? ` (${input.user_gender}; use ${pronounFor(input.user_gender)})` : ""}
other_name: ${input.other_name}${input.other_gender ? ` (${input.other_gender}; use ${pronounFor(input.other_gender)})` : ""}

opening_stats:
  message_count: ${input.opening_stats.message_count}
  duration: ${input.opening_stats.duration_human}
  first_date: ${input.opening_stats.first_date}
  last_date: ${input.opening_stats.last_date}

chapters:
${input.chapters.map((c) => `  - id: ${c.id}
    title: ${c.title}
    span: ${c.span_start} to ${c.span_end}
    mood_notes: ${c.mood_notes}`).join("\n")}

patterns_summary:
${input.patterns.slice(0, 8).map((p) => `  - "${p.phrase}" (${p.kind}): ${p.meaning_hint}${p.started ? ` [started ${p.started}]` : ""}${p.stopped ? ` [stopped ${p.stopped}]` : ""}`).join("\n") || "  (none)"}

curator_notes_for_narrator: ${input.curator_notes_for_narrator || "(none)"}

moments (in chronological order):
${input.moments.map((m) => `--- ${m.id} | ${m.date} | chapter:${m.chapter_id} | signatures:[${m.signatures.join(",")}]
  curator_internal_reason: ${m.curator_internal_reason}
  messages:
${renderMessages(m.messages)}`).join("\n")}

Return JSON per the schema. One moment_contexts entry per moment id above. One chapter_intros entry per chapter id above. Voice spec is non-negotiable.`;

  const isNarratorOutput = (v: unknown): v is NarratorOutput => {
    if (!v || typeof v !== "object") return false;
    const o = v as Record<string, unknown>;
    return (
      typeof o.opening_card_line === "string" &&
      Array.isArray(o.chapter_intros) &&
      Array.isArray(o.moment_contexts)
    );
  };

  return runJSONModel<NarratorOutput>({
    model: MODELS.narrator,
    system: SYSTEM_PROMPT,
    user: userMsg,
    maxTokens: 16384,
    schema: NARRATOR_SCHEMA,
    validate: isNarratorOutput,
    shapeHint: `{
  "opening_card_line": "<string, one sentence>",
  "chapter_intros": [{ "chapter_id": "<id>", "line": "<string>" }],
  "moment_contexts": [{ "moment_id": "<id>", "line": "<string, <=22 words>" }],
  "timeline_intro": "<string|null>",
  "private_dictionary_intro": "<string|null>",
  "forgotten_section_intro": "<string|null>"
}`,
  });
}
