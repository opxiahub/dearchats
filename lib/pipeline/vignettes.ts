import type { Message } from "../types";

// Generate a pool of poetic, factually-grounded vignettes from the chat itself.
// These cycle on the processing screen in order, no repeats, until the
// pipeline finishes. The first ones land in ~5s so the screen never feels
// frozen — that "this AI sees us" effect.

interface Stats {
  total: number;
  span_days: number;
  span_years: number;
  span_months_rem: number;
  late_night: number;          // messages after midnight, before 5am
  early_morning: number;       // messages between 5am and 8am
  longest_gap_days: number;
  longest_gap_when: string | null; // ISO date the gap ENDED
  busiest_month: { ym: string; count: number } | null;
  quietest_month: { ym: string; count: number } | null;
  per_sender: Record<string, number>;
  longest_msg_chars: number;
  laughter_count: number;
  question_count: number;
  love_count: number;
  miss_count: number;
  sorry_count: number;
  goodnight_count: number;
  goodmorning_count: number;
  weekend_count: number;
  weekday_count: number;
  past_2am_nights: number;
  shortest_reply: { gap_sec: number } | null;
}

function monthKey(ts: string): string {
  return ts.slice(0, 7);
}

function humanMonth(ym: string): string {
  const [y, m] = ym.split("-").map((s) => parseInt(s, 10));
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${months[m - 1]} ${y}`;
}

export function computeChatStats(messages: Message[]): Stats {
  const conv = messages.filter((m) => !m.isSystem);
  const total = conv.length;
  if (total === 0) {
    return {
      total: 0, span_days: 0, span_years: 0, span_months_rem: 0,
      late_night: 0, early_morning: 0, longest_gap_days: 0, longest_gap_when: null,
      busiest_month: null, quietest_month: null, per_sender: {}, longest_msg_chars: 0,
      laughter_count: 0, question_count: 0, love_count: 0, miss_count: 0,
      sorry_count: 0, goodnight_count: 0, goodmorning_count: 0,
      weekend_count: 0, weekday_count: 0, past_2am_nights: 0, shortest_reply: null,
    };
  }

  const first = new Date(conv[0].ts);
  const last = new Date(conv[conv.length - 1].ts);
  const span_days = Math.max(1, Math.round((last.getTime() - first.getTime()) / 86400000));
  const span_years = Math.floor(span_days / 365);
  const span_months_rem = Math.round((span_days - span_years * 365) / 30);

  let late_night = 0;
  let early_morning = 0;
  let weekend_count = 0;
  let weekday_count = 0;
  const past_2am_dates = new Set<string>();
  const per_month = new Map<string, number>();
  const per_sender: Record<string, number> = {};
  let longest_msg_chars = 0;
  let laughter_count = 0;
  let question_count = 0;
  let love_count = 0;
  let miss_count = 0;
  let sorry_count = 0;
  let goodnight_count = 0;
  let goodmorning_count = 0;

  let longest_gap_days = 0;
  let longest_gap_when: string | null = null;
  let shortest_reply_sec = Infinity;

  for (let i = 0; i < conv.length; i++) {
    const m = conv[i];
    const d = new Date(m.ts);
    const hour = d.getUTCHours();
    const day = d.getUTCDay(); // 0=Sun, 6=Sat
    const isWeekend = day === 0 || day === 6;
    if (isWeekend) weekend_count++; else weekday_count++;

    if (hour >= 0 && hour < 5) late_night++;
    if (hour >= 5 && hour < 8) early_morning++;
    if (hour >= 2 && hour < 5) past_2am_dates.add(m.ts.slice(0, 10));

    per_month.set(monthKey(m.ts), (per_month.get(monthKey(m.ts)) ?? 0) + 1);
    per_sender[m.sender] = (per_sender[m.sender] ?? 0) + 1;

    if (m.text.length > longest_msg_chars) longest_msg_chars = m.text.length;

    const lower = m.text.toLowerCase();
    if (/\b(haha+|lol|lmao|rofl|lmfao|hehe+)\b/.test(lower)) laughter_count++;
    if (m.text.includes("?")) question_count++;
    if (/\blove\b/.test(lower)) love_count++;
    if (/\bmiss\b/.test(lower)) miss_count++;
    if (/\bsorry\b/.test(lower)) sorry_count++;
    if (/\bgood\s*night\b|\bgn\b|\bgnight\b/.test(lower)) goodnight_count++;
    if (/\bgood\s*morning\b|\bgm\b|\bgmorning\b/.test(lower)) goodmorning_count++;

    if (i > 0) {
      const prev = new Date(conv[i - 1].ts);
      const gap_sec = (d.getTime() - prev.getTime()) / 1000;
      const gap_days = gap_sec / 86400;
      if (gap_days > longest_gap_days) {
        longest_gap_days = gap_days;
        longest_gap_when = m.ts.slice(0, 10);
      }
      // Only count "replies": different sender, less than 5 min
      if (conv[i - 1].sender !== m.sender && gap_sec < shortest_reply_sec && gap_sec > 0) {
        shortest_reply_sec = gap_sec;
      }
    }
  }

  let busiest_month: Stats["busiest_month"] = null;
  let quietest_month: Stats["quietest_month"] = null;
  for (const [ym, count] of per_month.entries()) {
    if (!busiest_month || count > busiest_month.count) busiest_month = { ym, count };
    // Skip the first/last month (likely partial)
    if (!quietest_month || count < quietest_month.count) {
      if (ym !== first.toISOString().slice(0, 7) && ym !== last.toISOString().slice(0, 7)) {
        quietest_month = { ym, count };
      }
    }
  }

  return {
    total,
    span_days,
    span_years,
    span_months_rem,
    late_night,
    early_morning,
    longest_gap_days: Math.round(longest_gap_days),
    longest_gap_when,
    busiest_month,
    quietest_month,
    per_sender,
    longest_msg_chars,
    laughter_count,
    question_count,
    love_count,
    miss_count,
    sorry_count,
    goodnight_count,
    goodmorning_count,
    weekend_count,
    weekday_count,
    past_2am_nights: past_2am_dates.size,
    shortest_reply: isFinite(shortest_reply_sec) ? { gap_sec: Math.round(shortest_reply_sec) } : null,
  };
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

/**
 * Build a deduplicated, ordered pool of vignettes for THIS chat.
 * Returned in the order they should appear on the processing screen.
 * Anything that produces a vacuous line (e.g. zero counts) is filtered out.
 */
export function buildVignettePool(stats: Stats): string[] {
  const lines: string[] = [];

  // Opening line — always there
  lines.push(`Reading ${fmtNum(stats.total)} messages…`);

  // Duration
  if (stats.span_years >= 1) {
    const y = stats.span_years;
    const m = stats.span_months_rem;
    lines.push(`Walking through ${y} year${y > 1 ? "s" : ""}${m ? `, ${m} month${m > 1 ? "s" : ""}` : ""} of chat…`);
  } else if (stats.span_days >= 30) {
    lines.push(`Walking through ${Math.round(stats.span_days / 30)} months of chat…`);
  } else {
    lines.push(`Walking through ${stats.span_days} days of chat…`);
  }

  // Sender split
  const senders = Object.entries(stats.per_sender).sort((a, b) => b[1] - a[1]);
  if (senders.length >= 2 && senders[0][1] + senders[1][1] > 0) {
    const ratio = senders[0][1] / (senders[0][1] + senders[1][1]);
    if (ratio > 0.6) {
      lines.push(`Noticing that ${senders[0][0]} did more of the talking…`);
    } else {
      lines.push(`Noticing how evenly the words moved between you…`);
    }
  }

  // Late night
  if (stats.late_night >= 50) {
    lines.push(`Finding the ${fmtNum(stats.late_night)} messages sent after midnight…`);
  } else if (stats.late_night >= 10) {
    lines.push(`Counting the ${fmtNum(stats.late_night)} times one of you was up too late…`);
  }

  // Past 2am
  if (stats.past_2am_nights >= 30) {
    lines.push(`Remembering the ${fmtNum(stats.past_2am_nights)} nights that went past 2am…`);
  } else if (stats.past_2am_nights >= 5) {
    lines.push(`Noticing the nights one of you couldn't sleep…`);
  }

  // Longest gap
  if (stats.longest_gap_days >= 14 && stats.longest_gap_when) {
    lines.push(`Remembering the ${stats.longest_gap_days} days you didn't speak…`);
  } else if (stats.longest_gap_days >= 5) {
    lines.push(`Noticing the small silences between you…`);
  }

  // Busiest month
  if (stats.busiest_month && stats.busiest_month.count >= 200) {
    lines.push(`The month you wrote ${fmtNum(stats.busiest_month.count)} messages — ${humanMonth(stats.busiest_month.ym)}…`);
  }

  // Quietest month
  if (stats.quietest_month && stats.quietest_month.count < 30 && stats.busiest_month && stats.quietest_month.count < stats.busiest_month.count / 5) {
    lines.push(`And the month you barely wrote at all — ${humanMonth(stats.quietest_month.ym)}…`);
  }

  // Greetings
  if (stats.goodmorning_count >= 30) {
    lines.push(`Finding ${fmtNum(stats.goodmorning_count)} good mornings between you…`);
  }
  if (stats.goodnight_count >= 30) {
    lines.push(`And ${fmtNum(stats.goodnight_count)} good nights…`);
  }

  // Affection words
  if (stats.love_count >= 10) {
    lines.push(`Counting the ${fmtNum(stats.love_count)} times you said "love"…`);
  }
  if (stats.miss_count >= 10) {
    lines.push(`The ${fmtNum(stats.miss_count)} times one of you said "miss"…`);
  }
  if (stats.sorry_count >= 10) {
    lines.push(`The ${fmtNum(stats.sorry_count)} apologies, big and small…`);
  }

  // Laughter
  if (stats.laughter_count >= 50) {
    lines.push(`Listening for the ${fmtNum(stats.laughter_count)} times you laughed…`);
  }

  // Questions
  if (stats.question_count >= 200) {
    lines.push(`The ${fmtNum(stats.question_count)} questions you asked each other…`);
  }

  // Weekend rhythm
  const weekendShare = stats.weekend_count / Math.max(1, stats.weekend_count + stats.weekday_count);
  if (weekendShare > 0.45) {
    lines.push(`Most of the talking happened on weekends…`);
  } else if (weekendShare < 0.20) {
    lines.push(`Mostly weekdays — between everything else you were doing…`);
  }

  // Longest message
  if (stats.longest_msg_chars >= 800) {
    lines.push(`Finding the long message — ${fmtNum(stats.longest_msg_chars)} characters, all in one breath…`);
  }

  // Shortest reply
  if (stats.shortest_reply && stats.shortest_reply.gap_sec <= 5) {
    lines.push(`The reply that came back in ${stats.shortest_reply.gap_sec} seconds…`);
  }

  // Closing vignettes — used at the very end while Narrator + Letter run
  lines.push(`Choosing the ones that mattered most…`);
  lines.push(`Finding what to point at, and what to leave alone…`);
  lines.push(`Writing the last page…`);

  return lines;
}
