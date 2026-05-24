import type { Message } from "../types";

// WhatsApp exports come in a handful of date/time formats. Common shapes:
//   iOS:     "[12/03/22, 11:47:13 PM] Abhi: hey"
//   iOS:     "[03/12/2022, 23:47:13] Abhi: hey"
//   Android: "12/03/22, 11:47 PM - Abhi: hey"
//   Android: "12/03/2022, 23:47 - Abhi: hey"
//
// We try several patterns. Each pattern captures (date, time, sender, text).
// The first line of a multi-line message matches; subsequent lines get
// appended to the previous message until the next header line.

interface HeaderMatch {
  date: string;
  time: string;
  sender: string;
  text: string;
}

const PATTERNS: Array<{ re: RegExp; build: (m: RegExpMatchArray) => HeaderMatch }> = [
  // iOS bracketed: [d/m/yy, h:mm:ss AM/PM] Sender: text   OR   [d/m/yyyy, HH:mm:ss] Sender: text
  {
    re: /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\]\s+([^:]+?):\s?([\s\S]*)$/,
    build: (m) => ({ date: m[1], time: m[2], sender: m[3].trim(), text: m[4] }),
  },
  // Android dash: d/m/yy, h:mm AM/PM - Sender: text   OR   d/m/yyyy, HH:mm - Sender: text
  {
    re: /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\s+-\s+([^:]+?):\s?([\s\S]*)$/,
    build: (m) => ({ date: m[1], time: m[2], sender: m[3].trim(), text: m[4] }),
  },
];

// System lines have no ":" after sender (e.g., "Messages and calls are end-to-end encrypted.")
const SYSTEM_PATTERNS: Array<RegExp> = [
  /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\]\s+(.+)$/,
  /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\s+-\s+(.+)$/,
];

function parseDateTime(date: string, time: string): string | null {
  // Normalize date. Try d/m/yy(yy) (most international exports).
  const dateParts = date.split("/").map((p) => parseInt(p, 10));
  if (dateParts.length !== 3 || dateParts.some(isNaN)) return null;
  let [d, mo, y] = dateParts;
  if (y < 100) y += 2000;
  // Some US exports flip to m/d/y. Heuristic: if first part > 12, it's day-first.
  // If second part > 12, swap. Otherwise assume day-first (international default).
  if (mo > 12 && d <= 12) {
    [d, mo] = [mo, d];
  }

  let hour = 0;
  let min = 0;
  let sec = 0;
  const tMatch = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap][Mm])?$/);
  if (!tMatch) return null;
  hour = parseInt(tMatch[1], 10);
  min = parseInt(tMatch[2], 10);
  sec = tMatch[3] ? parseInt(tMatch[3], 10) : 0;
  const ampm = tMatch[4]?.toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;

  const dt = new Date(Date.UTC(y, mo - 1, d, hour, min, sec));
  if (isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function tryHeader(line: string): { match: HeaderMatch; isSystem: false } | { systemText: string; date: string; time: string; isSystem: true } | null {
  for (const { re, build } of PATTERNS) {
    const m = line.match(re);
    if (m) return { match: build(m), isSystem: false };
  }
  for (const re of SYSTEM_PATTERNS) {
    const m = line.match(re);
    if (m) return { systemText: m[3], date: m[1], time: m[2], isSystem: true };
  }
  return null;
}

export interface ParseResult {
  messages: Message[];
  participants: string[];
  warnings: string[];
}

export function parseWhatsAppText(raw: string): ParseResult {
  // Strip BOM, normalize newlines, strip invisible Unicode WA inserts (U+200E).
  const text = raw
    .replace(/^﻿/, "")
    .replace(/‎/g, "")
    .replace(/\r\n?/g, "\n");
  const lines = text.split("\n");

  const messages: Message[] = [];
  const warnings: string[] = [];
  const participants = new Map<string, number>();

  let current: Message | null = null;

  for (const line of lines) {
    if (line.trim() === "") {
      if (current) current.text += "\n";
      continue;
    }
    const h = tryHeader(line);
    if (!h) {
      // Continuation of previous message
      if (current) {
        current.text += (current.text ? "\n" : "") + line;
      }
      continue;
    }

    // Commit previous
    if (current) {
      current.text = current.text.trim();
      if (current.text || current.isSystem) messages.push(current);
    }

    if (h.isSystem) {
      const ts = parseDateTime(h.date, h.time);
      if (!ts) {
        current = null;
        continue;
      }
      current = {
        ts,
        sender: "__system__",
        text: h.systemText.trim(),
        isSystem: true,
      };
    } else {
      const ts = parseDateTime(h.match.date, h.match.time);
      if (!ts) {
        current = null;
        continue;
      }
      // Skip media-only placeholders
      const isMediaPlaceholder =
        /^<Media omitted>$/i.test(h.match.text.trim()) ||
        /image omitted/i.test(h.match.text) ||
        /video omitted/i.test(h.match.text) ||
        /audio omitted/i.test(h.match.text) ||
        /sticker omitted/i.test(h.match.text) ||
        /GIF omitted/i.test(h.match.text);

      if (isMediaPlaceholder) {
        current = null;
        continue;
      }
      current = {
        ts,
        sender: h.match.sender,
        text: h.match.text.trim(),
      };
      participants.set(h.match.sender, (participants.get(h.match.sender) || 0) + 1);
    }
  }
  if (current) {
    current.text = current.text.trim();
    if (current.text || current.isSystem) messages.push(current);
  }

  if (messages.length === 0) {
    warnings.push("No messages parsed — file may not be a WhatsApp export, or uses an unsupported date format.");
  }

  // Top 2 participants by volume (filter system)
  const ranked = [...participants.entries()]
    .filter(([s]) => s !== "__system__")
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s);

  return { messages, participants: ranked, warnings };
}
