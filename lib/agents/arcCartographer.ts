import { MODELS, runJSONModel } from "./client";
import { CARTOGRAPHER_SCHEMA } from "./schemas";
import type { Chapter, ChapterId, Message, RelationshipType } from "../types";

// Generate month-by-month tiny summaries from raw messages so the
// Cartographer doesn't blow context. Then have it map chapters.

function monthlyBuckets(messages: Message[]): Array<{ month: string; sample: string; count: number }> {
  const buckets = new Map<string, Message[]>();
  for (const m of messages) {
    if (m.isSystem) continue;
    const month = m.ts.slice(0, 7);
    if (!buckets.has(month)) buckets.set(month, []);
    buckets.get(month)!.push(m);
  }
  const sorted = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return sorted.map(([month, msgs]) => {
    // Pick up to 6 sample messages roughly evenly spaced
    const samples: string[] = [];
    const step = Math.max(1, Math.floor(msgs.length / 6));
    for (let i = 0; i < msgs.length && samples.length < 6; i += step) {
      const t = msgs[i].text.replace(/\n/g, " / ").slice(0, 160);
      samples.push(`${msgs[i].sender}: ${t}`);
    }
    return { month, sample: samples.join(" | "), count: msgs.length };
  });
}

const SYSTEM_PROMPT = `You are the Arc Cartographer for DearChats. You read a month-by-month
summary of a long chat between two people and produce the SHAPE of their
relationship — the chapter boundaries, each chapter's title (mood-setting,
not summary), and a brief mood note for the Narrator.

Use these chapter ids EXACTLY (in this canonical order, but only include
chapters that fit the actual chat — skip ones that don't apply):
  beginnings, becoming, ordinary_sacred, friction, repair, distance, now

Titles should be SHORT and atmospheric — at most ~6 words. Examples of
the right register:
  "The careful months."
  "After her father got sick."
  "The year you both pretended to be fine."
  "When the jokes came back."
  "Now."

Output ONLY JSON, no prose, no fences:
{
  "chapters": [
    {
      "id": "<one of the chapter ids>",
      "title": "<short atmospheric title>",
      "span_start": "<YYYY-MM-DD>",
      "span_end": "<YYYY-MM-DD>",
      "mood_notes": "<internal: 1-2 sentences pointing the Narrator at what defines this chapter>"
    }
  ]
}

Rules:
- Cover the full timespan from first message to last (no gaps between chapters).
- 4-7 chapters total. Never more than 7.
- Order chronologically.
- "now" (if used) is the most recent chapter and includes the last date.
- A chat that ended a while ago can end on "distance" or another chapter — do NOT force "now".`;

export async function runArcCartographer(
  messages: Message[],
  rel: RelationshipType,
  user_name: string,
  other_name: string,
): Promise<Chapter[]> {
  const buckets = monthlyBuckets(messages);
  if (buckets.length === 0) return [];

  const userMsg = `relationship_type: ${rel}
participants: ${user_name} and ${other_name}

month_by_month (YYYY-MM | message_count | sample_messages):
${buckets.map((b) => `  ${b.month} | ${b.count} | ${b.sample}`).join("\n")}

Return JSON per the schema. Chapter ids must come from the canonical list.`;

  try {
    const parsed = await runJSONModel<{ chapters: Chapter[] }>({
      model: MODELS.cartographer,
      system: SYSTEM_PROMPT,
      user: userMsg,
      maxTokens: 4096,
      schema: CARTOGRAPHER_SCHEMA,
      validate: (v): v is { chapters: Chapter[] } =>
        !!v && typeof v === "object" && Array.isArray((v as { chapters?: unknown }).chapters),
      shapeHint: `{"chapters":[{"id":"beginnings|becoming|ordinary_sacred|friction|repair|distance|now","title":"<string>","span_start":"YYYY-MM-DD","span_end":"YYYY-MM-DD","mood_notes":"<string>"}]}`,
    });
    const valid = ["beginnings","becoming","ordinary_sacred","friction","repair","distance","now"];
    const filtered = (parsed.chapters ?? []).filter((c) => valid.includes(c.id));
    // Dedupe by id — the LLM occasionally emits two chapters with the same id
    // across different date spans. Keep the chronologically earliest one
    // (matches our canonical order).
    filtered.sort((a, b) => (a.span_start ?? "").localeCompare(b.span_start ?? ""));
    const seen = new Set<string>();
    const chapters: Chapter[] = [];
    for (const c of filtered) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      chapters.push(c);
    }
    return chapters;
  } catch {
    // Fallback: single "now" chapter spanning the whole chat
    const first = messages.find((m) => !m.isSystem)?.ts ?? "";
    const last = [...messages].reverse().find((m) => !m.isSystem)?.ts ?? "";
    return [{
      id: "now" as ChapterId,
      title: "All of it.",
      span_start: first.slice(0, 10),
      span_end: last.slice(0, 10),
      mood_notes: "Fallback chapter — Cartographer output failed to parse.",
    }];
  }
}
