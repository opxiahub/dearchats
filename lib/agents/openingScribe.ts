import { MODELS, runTextModel } from "./client";
import { VOICE_SPEC } from "./voiceSpec";
import type { Chapter, Message, OpeningStats, RelationshipType } from "../types";

// A fast pre-pass that produces ONLY the opening_card_line so the user
// can enter the Walk within ~10-20s of upload, while the heavy curator
// + narrator pipeline continues in the background.

const SYSTEM_PROMPT = `${VOICE_SPEC}

You are the Opening Scribe for DearChats. You receive basic stats about a
chat between two people, the chapter arc, and a small sample of messages
from across the timeline. Your only job: produce ONE sentence (max ~18
words) — the emotional signature of THIS specific chat.

Examples of the right register:

"Six years of good mornings, one ordinary Tuesday they stopped."
"You met at nineteen and have been roasting each other since; the jokes got slower, the loyalty did not."
"Three cities, two timezones, one shared family WhatsApp you both mute — and this thread, where the actual talking happens."
"The chat where you talk about groceries. It is also the other thing."

Return ONLY the sentence. No quotes, no preamble, no markdown.

If you find yourself reaching for "beautiful", "powerful", "touching",
"journey", "ups and downs" — stop and rewrite. Return to specifics.`;

interface OpeningInput {
  relationship_type: RelationshipType;
  user_name: string;
  other_name: string;
  opening_stats: OpeningStats;
  chapters: Chapter[];
  samples: Message[]; // a handful spread across the timeline
}

export async function runOpeningScribe(input: OpeningInput): Promise<string> {
  const sampleLines = input.samples
    .map((m) => `  [${m.ts.slice(0, 10)}] ${m.sender}: ${m.text.replace(/\n/g, " / ").slice(0, 200)}`)
    .join("\n");

  const userMsg = `relationship_type: ${input.relationship_type}
user_name: ${input.user_name}
other_name: ${input.other_name}
duration: ${input.opening_stats.duration_human}
message_count: ${input.opening_stats.message_count}
first_date: ${input.opening_stats.first_date}
last_date: ${input.opening_stats.last_date}

chapter_arc: ${input.chapters.map((c) => c.title).join(" → ")}

sample_messages (spread across the timeline):
${sampleLines}

Now: one sentence. The emotional signature of this chat. Voice spec is non-negotiable.`;

  const text = await runTextModel({
    model: MODELS.openingScribe,
    system: SYSTEM_PROMPT,
    user: userMsg,
    maxTokens: 256,
  });

  return text.trim().replace(/^["']|["']$/g, "");
}

/** Spread N samples across the timeline of conv messages. */
export function pickTimelineSamples(messages: Message[], n = 14): Message[] {
  const conv = messages.filter((m) => !m.isSystem && m.text.length > 6);
  if (conv.length <= n) return conv;
  const out: Message[] = [];
  const step = (conv.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) {
    out.push(conv[Math.round(i * step)]);
  }
  return out;
}
