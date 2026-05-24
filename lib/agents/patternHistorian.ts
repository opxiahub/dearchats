import { MODELS, runJSONModel } from "./client";
import { HISTORIAN_SCHEMA } from "./schemas";
import type { Message, Pattern, RelationshipType } from "../types";

// Two-stage: (1) code-side n-gram extraction over the whole chat; (2) LLM
// filter for which n-grams are EMOTIONALLY meaningful vs just frequent.

const STOPWORDS = new Set([
  "the","a","an","is","are","was","were","i","you","we","he","she","it","they",
  "to","of","in","on","at","for","and","or","but","so","if","then","that","this",
  "be","been","being","have","has","had","do","did","does","not","no","yes",
  "ok","okay","ya","yeah","hmm","lol","haha","like","just","really","very",
  "my","your","his","her","its","our","their","me","him","them","us",
  "with","from","by","as","up","down","out","about","into","over","under",
  "can","could","would","should","will","wont","won't","cant","can't","dont","don't",
  "im","i'm","ill","i'll","ive","i've","its","it's","thats","that's","whats","what's",
  "u","ur","r","n",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zA-Z'\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

function ngrams(tokens: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) {
    out.push(tokens.slice(i, i + n).join(" "));
  }
  return out;
}

interface PhraseStat {
  phrase: string;
  count: number;
  first: string;
  last: string;
}

function harvestPhrases(messages: Message[]): PhraseStat[] {
  const stats = new Map<string, PhraseStat>();
  for (const m of messages) {
    if (m.isSystem) continue;
    const toks = tokenize(m.text);
    const grams = [...ngrams(toks, 2), ...ngrams(toks, 3), ...ngrams(toks, 4)];
    for (const g of grams) {
      const s = stats.get(g);
      if (s) {
        s.count++;
        s.last = m.ts;
      } else {
        stats.set(g, { phrase: g, count: 1, first: m.ts, last: m.ts });
      }
    }
  }
  // Keep phrases appearing at least 4 times across at least 2 weeks of span.
  const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;
  return [...stats.values()]
    .filter((s) => s.count >= 4 && new Date(s.last).getTime() - new Date(s.first).getTime() >= TWO_WEEKS)
    .sort((a, b) => b.count - a.count)
    .slice(0, 60);
}

const SYSTEM_PROMPT = `You are the Pattern Historian for DearChats. You receive a list of frequent
phrases from a long chat between two specific people, with first/last
occurrence dates and counts. Your job is to identify which of these are
EMOTIONALLY MEANINGFUL — rituals, nicknames, callback jokes, recurring
phrases of care — versus which are just statistically frequent noise
(common verbs, logistics, etc.).

For each meaningful phrase:
- classify as nickname | ritual | callback_joke | phrase
- if you can tell from the dates that it STARTED at some point (didn't
  exist early on) or STOPPED at some point (suddenly absent), note that
  — these are the most precious findings.
- write a one-sentence "meaning_hint" in restrained, specific language
  (this is internal — points to what makes it matter).

Output ONLY JSON, no prose, no fences:
{
  "patterns": [
    {
      "phrase": "<exact phrase>",
      "kind": "nickname"|"ritual"|"callback_joke"|"phrase",
      "started": "<YYYY-MM-DD or null>",
      "stopped": "<YYYY-MM-DD or null>",
      "frequency": <int>,
      "meaning_hint": "<one sentence>"
    }
  ]
}

Aim for 8-15 patterns. Bias toward fewer, more interesting ones over a long
list. If you can't tell something is meaningful, drop it.`;

export async function runPatternHistorian(
  messages: Message[],
  rel: RelationshipType,
  user_name: string,
  other_name: string,
): Promise<Pattern[]> {
  const phrases = harvestPhrases(messages);
  if (phrases.length === 0) return [];

  const total = messages.length;
  const span = `${messages[0]?.ts.slice(0, 10)} to ${messages[messages.length - 1]?.ts.slice(0, 10)}`;

  const userMsg = `relationship_type: ${rel}
participants: ${user_name} and ${other_name}
chat_span: ${span}
total_messages: ${total}

candidate_phrases (phrase | count | first_seen | last_seen):
${phrases.map((p) => `  "${p.phrase}" | ${p.count} | ${p.first.slice(0, 10)} | ${p.last.slice(0, 10)}`).join("\n")}

Return JSON per the schema.`;

  try {
    const parsed = await runJSONModel<{ patterns: Pattern[] }>({
      model: MODELS.historian,
      system: SYSTEM_PROMPT,
      user: userMsg,
      maxTokens: 4096,
      schema: HISTORIAN_SCHEMA,
      validate: (v): v is { patterns: Pattern[] } =>
        !!v && typeof v === "object" && Array.isArray((v as { patterns?: unknown }).patterns),
      shapeHint: `{"patterns":[{"phrase":"<string>","kind":"nickname|ritual|callback_joke|phrase|emoji","started":"YYYY-MM-DD|null","stopped":"YYYY-MM-DD|null","frequency":<number>,"meaning_hint":"<string>"}]}`,
    });
    return parsed.patterns.slice(0, 15);
  } catch {
    return [];
  }
}
