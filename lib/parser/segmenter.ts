import type { Message, MomentCandidate } from "../types";

// Time-gap based segmentation. A new moment starts when:
//   - more than GAP_MINUTES since the previous message, OR
//   - we have already accumulated MAX_MESSAGES messages in the current moment.
//
// Then we drop trivially short moments (e.g., a single "ok" exchanged alone)
// because they almost never carry emotional weight without context.

const GAP_MINUTES = 45;
const MAX_MESSAGES = 25;
const MIN_MESSAGES = 2;

function diffMin(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 60000;
}

export function segmentMessages(messages: Message[]): MomentCandidate[] {
  const conv = messages.filter((m) => !m.isSystem);
  const candidates: MomentCandidate[] = [];
  let cur: Message[] = [];

  const flush = () => {
    if (cur.length >= MIN_MESSAGES) {
      const id = `m_${String(candidates.length + 1).padStart(4, "0")}`;
      candidates.push({
        id,
        startTs: cur[0].ts,
        endTs: cur[cur.length - 1].ts,
        messages: cur,
      });
    }
    cur = [];
  };

  for (let i = 0; i < conv.length; i++) {
    const msg = conv[i];
    if (cur.length === 0) {
      cur.push(msg);
      continue;
    }
    const last = cur[cur.length - 1];
    const gap = diffMin(last.ts, msg.ts);
    if (gap > GAP_MINUTES || cur.length >= MAX_MESSAGES) {
      flush();
      cur.push(msg);
    } else {
      cur.push(msg);
    }
  }
  flush();

  return candidates;
}

// Attach ±10 message context windows to a subset of candidates (for the Curator).
export function attachContext(
  all: Message[],
  candidates: MomentCandidate[],
  windowSize = 10,
): MomentCandidate[] {
  const conv = all.filter((m) => !m.isSystem);
  const tsToIdx = new Map<string, number>();
  conv.forEach((m, i) => tsToIdx.set(`${m.ts}|${m.sender}|${m.text}`, i));

  return candidates.map((c) => {
    const firstKey = `${c.messages[0].ts}|${c.messages[0].sender}|${c.messages[0].text}`;
    const lastKey = `${c.messages[c.messages.length - 1].ts}|${c.messages[c.messages.length - 1].sender}|${c.messages[c.messages.length - 1].text}`;
    const firstIdx = tsToIdx.get(firstKey) ?? 0;
    const lastIdx = tsToIdx.get(lastKey) ?? 0;
    return {
      ...c,
      contextBefore: conv.slice(Math.max(0, firstIdx - windowSize), firstIdx),
      contextAfter: conv.slice(lastIdx + 1, lastIdx + 1 + windowSize),
    };
  });
}

export function computeOpeningStats(messages: Message[]): {
  message_count: number;
  duration_human: string;
  first_date: string;
  last_date: string;
} {
  const conv = messages.filter((m) => !m.isSystem);
  if (conv.length === 0) {
    return {
      message_count: 0,
      duration_human: "no time at all",
      first_date: new Date().toISOString().slice(0, 10),
      last_date: new Date().toISOString().slice(0, 10),
    };
  }
  const first = new Date(conv[0].ts);
  const last = new Date(conv[conv.length - 1].ts);
  const days = (last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24);
  let duration_human: string;
  if (days < 31) {
    duration_human = `${Math.max(1, Math.round(days))} days`;
  } else if (days < 365) {
    duration_human = `${Math.round(days / 30)} months`;
  } else {
    const years = Math.floor(days / 365);
    const remMonths = Math.round((days - years * 365) / 30);
    if (remMonths === 0) duration_human = `${years} year${years > 1 ? "s" : ""}`;
    else duration_human = `${years} year${years > 1 ? "s" : ""}, ${remMonths} month${remMonths > 1 ? "s" : ""}`;
  }
  return {
    message_count: conv.length,
    duration_human,
    first_date: first.toISOString().slice(0, 10),
    last_date: last.toISOString().slice(0, 10),
  };
}
