import { MODELS, runJSONModel } from "./client";
import { FILM_DIRECTOR_SCHEMA } from "./schemas";
import { VOICE_SPEC } from "./voiceSpec";
import type { Message, Pattern, RelationshipType, Walk, YearSignature } from "../types";
import type { FilmPlan } from "../film/scenes";

// Banned meta words, mirrored from the Curator/Narrator rules. Last-line defense
// against the director slipping into summary-speak in the user-facing captions.
const BANNED = /\b(chat|conversation|sparse|rich|texture|vibe|energy|journey|rollercoaster|beautiful|touching|heartwarming|powerful)\b/i;

function sanitizeCaption(raw: string): string {
  let s = raw.trim().replace(/^["'“”]+/, "").replace(/["'“”]+$/, "").trim();
  // Drop a sentence that opens with "this/the chat|conversation|relationship".
  s = s
    .split(/(?<=[.!?])\s+/)
    .filter((sent) => !/^\s*(this|the)\s+(chat|conversation|relationship)\b/i.test(sent))
    .join(" ")
    .trim();
  return s;
}

const GOLDEN = `GOLDEN CAPTION EXAMPLES — STUDY THE VOICE

[opening, romantic 6-year chat] "Six years of good mornings. This is some of it."
[a 2am "are you up?"] "You asked at 2am. She was. That mattered more than it should have."
[first time 'love' appears] "Buried in a message about laundry. Neither of you mentioned it the next day."
[best-friend fight → meme 3 days later] "Three days of silence, then a photo of a dog. That was the apology."
[sibling "did you eat"] "She asked. You forgot to answer. She asked again."
[closing] "Made from the parts you almost forgot."`;

const SYSTEM_PROMPT = `${VOICE_SPEC}

You are the Film Director of DearChats. You are handed a fully curated walk and
must cut it into a short vertical memory film — the thing the user will actually
share with the person who lived it with them. It must feel like reliving the whole
relationship in under a minute, not a highlight reel of peaks.

You receive: opening stats, the curated moments (each with date, chapter, mood,
signatures, the Curator's private reason, and a short message excerpt), the private
dictionary patterns, and per-year signatures.

Your job, in one pass:

1. ordered_moment_ids — choose EXACTLY {COUNT} moment ids (or all of them if fewer
   exist) and return them in CHRONOLOGICAL order. Build a real arc across the whole
   span — a beginning, the becoming, the ordinary-made-sacred, friction/repair if it
   exists, and now. Do NOT cluster one year or one mood. Spread across the years you
   are given. Favor moments that carry a turn (the_shift, first_or_last,
   conflict_and_repair, almost_didnt_say). Shared photos are woven in separately
   as their own dated beats — you do not place them, so just pick the best text.

2. scene_captions — one caption per chosen moment id (and optionally for the forgotten
   moment). Each is ONE line, max ~16 words, in the voice above. It is shown over the
   moment as the film breathes; it should point at the timing, the gap, the pattern —
   never restate the message. The reader has ~4 seconds. Make them feel something.

3. opening_line — ONE line (max ~14 words) for the title card. Specific to THIS
   relationship, not generic.

4. dictionary_phrase + dictionary_hint — pick the single most emotionally loaded
   private word/phrase/ritual to flash mid-film, with a short hint of what it meant.
   Use null for both if none is worth showing.

5. forgotten_moment_id — pick ONE moment id (ideally NOT already in ordered_moment_ids)
   for the quiet "what was forgotten" beat near the end. null if nothing fits.

6. closing_line — ONE final line (max ~12 words). Quiet. Earned, not inspirational.

${GOLDEN}

== OUTPUT ==
Return ONLY JSON, no prose, no fences:
{
  "ordered_moment_ids": ["<id>", ...],
  "scene_captions": [{"moment_id": "<id>", "caption": "<one line>"}],
  "opening_line": "<one line>",
  "dictionary_phrase": "<phrase or null>",
  "dictionary_hint": "<hint or null>",
  "forgotten_moment_id": "<id or null>",
  "closing_line": "<one line>"
}

If you reach for "beautiful", "journey", "powerful", a rhetorical question, or a
Hallmark closing — stop and rewrite toward the specific.`;

interface DirectorRawOutput {
  ordered_moment_ids: string[];
  scene_captions: Array<{ moment_id: string; caption: string }>;
  opening_line: string;
  dictionary_phrase: string | null;
  dictionary_hint: string | null;
  forgotten_moment_id: string | null;
  closing_line: string;
}

export interface FilmDirectorInput {
  walk: Walk;
  relationship_type: RelationshipType;
  user_name: string;
  other_name: string;
  patterns: Pattern[];
  year_signatures: YearSignature[];
  /** target number of text moments for the chosen length */
  targetMomentCount: number;
}

function excerpt(msgs: Message[]): string {
  return msgs
    .filter((m) => m.text.trim().length > 0)
    .slice(0, 3)
    .map((m) => `    ${m.sender}: ${m.text.replace(/\n/g, " / ").slice(0, 140)}`)
    .join("\n");
}

/**
 * Ask the Film Director to cut the walk into a shareable arc. Returns a FilmPlan
 * the scene builder can consume, or null if anything goes wrong — the caller then
 * falls back to the deterministic arc, so the film always renders.
 */
export async function runFilmDirector(input: FilmDirectorInput): Promise<FilmPlan | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  const { walk } = input;
  const moments = walk.moments;
  if (moments.length === 0) return null;

  const momentsBlock = moments
    .map(
      (m) => `--- ${m.id} | ${m.date} | chapter:${m.chapter_id} | mood:${m.mood} | signatures:[${m.signatures.join(",")}]
  front_line: ${m.ai_summary}
  messages:
${excerpt(m.messages)}`,
    )
    .join("\n");

  const yearsBlock =
    input.year_signatures
      .map((y) => `  - ${y.year}: ${y.is_empty ? "(silent year)" : `${y.moment_count} moments, ${y.message_count} messages`}`)
      .join("\n") || "  (none)";

  const patternsBlock =
    input.patterns
      .slice(0, 10)
      .map((p) => `  - "${p.phrase}" (${p.kind}): ${p.meaning_hint}${p.started ? ` [started ${p.started}]` : ""}${p.stopped ? ` [stopped ${p.stopped}]` : ""}`)
      .join("\n") || "  (none)";

  const userMsg = `relationship_type: ${input.relationship_type}
user_name: ${input.user_name}
other_name: ${input.other_name}
target_moment_count: ${input.targetMomentCount}

opening_stats:
  message_count: ${walk.opening.message_count}
  duration: ${walk.opening.duration_human}
  span: ${walk.opening.first_date} to ${walk.opening.last_date}
  existing_opening_line: ${walk.opening.line}

per_year:
${yearsBlock}

private_dictionary:
${patternsBlock}

moments (chronological — choose from these ids only):
${momentsBlock}

Return JSON per the schema. ordered_moment_ids must be ids from the list above, in chronological order.`;

  const isValid = (v: unknown): v is DirectorRawOutput => {
    if (!v || typeof v !== "object") return false;
    const o = v as Record<string, unknown>;
    return (
      Array.isArray(o.ordered_moment_ids) &&
      Array.isArray(o.scene_captions) &&
      typeof o.opening_line === "string" &&
      typeof o.closing_line === "string"
    );
  };

  let raw: DirectorRawOutput;
  try {
    raw = await runJSONModel<DirectorRawOutput>({
      model: MODELS.narrator,
      system: SYSTEM_PROMPT.replace(/\{COUNT\}/g, String(input.targetMomentCount)),
      user: userMsg,
      maxTokens: 4096,
      schema: FILM_DIRECTOR_SCHEMA,
      validate: isValid,
      shapeHint: `{
  "ordered_moment_ids": ["<id>"],
  "scene_captions": [{ "moment_id": "<id>", "caption": "<string>" }],
  "opening_line": "<string>",
  "dictionary_phrase": "<string|null>",
  "dictionary_hint": "<string|null>",
  "forgotten_moment_id": "<string|null>",
  "closing_line": "<string>"
}`,
    });
  } catch (err) {
    console.warn(`[filmDirector] failed, falling back to deterministic arc: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  // Keep only ids that exist; preserve the director's order.
  const validIds = new Set(moments.map((m) => m.id));
  const ordered = raw.ordered_moment_ids.filter((id) => validIds.has(id));
  if (ordered.length === 0) return null;

  const captions: Record<string, string> = {};
  for (const { moment_id, caption } of raw.scene_captions) {
    if (!validIds.has(moment_id)) continue;
    const clean = sanitizeCaption(caption);
    if (clean && !BANNED.test(clean)) captions[moment_id] = clean;
  }

  const openingClean = sanitizeCaption(raw.opening_line);
  const closingClean = sanitizeCaption(raw.closing_line);

  return {
    ordered_moment_ids: ordered,
    captions,
    opening_line: openingClean && !BANNED.test(openingClean) ? openingClean : undefined,
    dictionary_phrase: raw.dictionary_phrase,
    dictionary_hint: raw.dictionary_hint,
    forgotten_moment_id: raw.forgotten_moment_id && validIds.has(raw.forgotten_moment_id) ? raw.forgotten_moment_id : null,
    closing_line: closingClean && !BANNED.test(closingClean) ? closingClean : undefined,
  };
}
