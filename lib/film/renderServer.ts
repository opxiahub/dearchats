import { createCanvas, loadImage, type SKRSContext2D, type Image } from "@napi-rs/canvas";
import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import { MOOD_TONE } from "@/components/universe/moodTone";
import { getDataDir } from "@/lib/db";
import { mediaPath } from "@/lib/db/media";
import { updateFilm } from "@/lib/db/films";
import type { MomentOut, Walk } from "@/lib/types";
import {
  buildFilmScenes,
  plannedTextCount,
  type FilmMedia,
  type FilmOptions,
  type FilmPlan,
  type FilmScene,
} from "./scenes";
import { runFilmDirector } from "@/lib/agents/filmDirector";

const execFileAsync = promisify(execFile);

const VIDEO_W = 720;
const VIDEO_H = 1280;
const CROSSFADE_S = 0.45;

export interface RenderInput {
  filmId: string;
  walk: Walk;
  media: FilmMedia[];
  options: FilmOptions;
}

export interface RenderResult {
  mp4Path: string;
  bytes: number;
  duration: number;
}

export function filmsDir(): string {
  return path.join(getDataDir(), "films");
}

export function filmOutputPath(walkId: string, filmId: string): string {
  return path.join(filmsDir(), walkId, `${filmId}.mp4`);
}

export async function renderFilmServer(input: RenderInput): Promise<RenderResult> {
  const { filmId, walk, media, options } = input;

  const workRoot = path.join(getDataDir(), "films", walk.session_id, "_tmp", filmId);
  await fs.mkdir(workRoot, { recursive: true });

  try {
    updateFilm(filmId, { status: "rendering", progress: 0.03, stage: "directing the film" });

    // LLM Film Director cuts the arc + writes scene captions in the DearChats
    // voice. Falls back to the deterministic arc (plan = null) on any failure.
    let plan: FilmPlan | null = null;
    try {
      plan = await runFilmDirector({
        walk,
        relationship_type: walk.relationship_type,
        user_name: walk.opening.user_name,
        other_name: walk.opening.other_name,
        patterns: walk.private_dictionary?.patterns ?? [],
        year_signatures: walk.year_signatures ?? [],
        targetMomentCount: plannedTextCount(media, options),
      });
    } catch (err) {
      console.warn(`[renderFilmServer] director threw, using deterministic arc: ${err instanceof Error ? err.message : String(err)}`);
    }

    const scenes = buildFilmScenes(walk, media, options, plan);
    const totalDuration = scenes.reduce((sum, s) => sum + s.duration, 0);

    updateFilm(filmId, { progress: 0.05, stage: "preparing scenes" });

    const sceneImages: string[] = [];
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const file = path.join(workRoot, `scene-${String(i).padStart(3, "0")}.png`);
      await renderSceneImage(scene, walk, options, file);
      sceneImages.push(file);
      const stageProgress = 0.05 + ((i + 1) / scenes.length) * 0.45;
      updateFilm(filmId, { progress: stageProgress, stage: `rendering scene ${i + 1}/${scenes.length}` });
    }

    updateFilm(filmId, { progress: 0.55, stage: "composing video" });

    const outDir = path.join(filmsDir(), walk.session_id);
    await fs.mkdir(outDir, { recursive: true });
    const mp4Path = filmOutputPath(walk.session_id, filmId);

    await runFfmpegCompose({
      sceneImages,
      sceneDurations: scenes.map((s) => s.duration),
      audioPath: options.includeMusic ? resolveMusicPath(walk.relationship_type) : null,
      outPath: mp4Path,
      onProgress: (p) => updateFilm(filmId, { progress: 0.55 + p * 0.4 }),
    });

    const stat = await fs.stat(mp4Path);
    updateFilm(filmId, {
      status: "ready",
      progress: 1,
      stage: "ready",
      mp4_path: mp4Path,
      bytes: stat.size,
      duration_seconds: totalDuration,
    });
    return { mp4Path, bytes: stat.size, duration: totalDuration };
  } finally {
    await fs.rm(workRoot, { recursive: true, force: true }).catch(() => {});
  }
}

function resolveMusicPath(relationship: Walk["relationship_type"]): string | null {
  const map: Record<Walk["relationship_type"], string> = {
    romantic: "film-romantic.mp3",
    best_friend: "film-best-friend.mp3",
    sibling: "film-sibling.mp3",
  };
  const p = path.join(process.cwd(), "public", "audio", map[relationship]);
  return p;
}

async function runFfmpegCompose(args: {
  sceneImages: string[];
  sceneDurations: number[];
  audioPath: string | null;
  outPath: string;
  onProgress?: (progress: number) => void;
}) {
  const { sceneImages, sceneDurations, audioPath, outPath } = args;
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const totalDuration = sceneDurations.reduce((a, b) => a + b, 0);
  const fps = 30;

  // Build per-image inputs + an xfade filter chain.
  // Each image is decoded at fps with the scene's exact duration; we then
  // crossfade them sequentially so cuts feel cinematic.
  const cmd: string[] = ["-y"];
  for (let i = 0; i < sceneImages.length; i++) {
    cmd.push("-loop", "1", "-t", String(sceneDurations[i]), "-i", sceneImages[i]);
  }
  let audioInputIndex = -1;
  if (audioPath) {
    try {
      await fs.access(audioPath);
      audioInputIndex = sceneImages.length;
      cmd.push("-stream_loop", "-1", "-i", audioPath);
    } catch {
      // audio file missing — render without audio
    }
  }

  // Filter chain.
  // Each scene already arrives at 720x1280; still re-assert pix_fmt + fps + setsar so
  // xfade gets identical inputs (it errors on mismatched timebases otherwise).
  const filters: string[] = [];
  const labels: string[] = [];
  for (let i = 0; i < sceneImages.length; i++) {
    const out = `v${i}`;
    filters.push(
      `[${i}:v]format=yuv420p,fps=${fps},scale=${VIDEO_W}:${VIDEO_H}:flags=lanczos,setsar=1,setpts=PTS-STARTPTS[${out}]`,
    );
    labels.push(out);
  }

  if (labels.length === 1) {
    filters.push(`[${labels[0]}]copy[vout]`);
  } else {
    let prevLabel = labels[0];
    let offset = sceneDurations[0] - CROSSFADE_S;
    for (let i = 1; i < labels.length; i++) {
      const out = i === labels.length - 1 ? "vout" : `vx${i}`;
      const xfade = Math.min(CROSSFADE_S, sceneDurations[i] / 2, sceneDurations[i - 1] / 2);
      filters.push(`[${prevLabel}][${labels[i]}]xfade=transition=fade:duration=${xfade.toFixed(3)}:offset=${offset.toFixed(3)}[${out}]`);
      prevLabel = out;
      offset += sceneDurations[i] - xfade;
    }
  }

  cmd.push("-filter_complex", filters.join(";"), "-map", "[vout]");

  if (audioInputIndex >= 0) {
    cmd.push(
      "-map",
      `${audioInputIndex}:a`,
      "-af",
      `afade=t=in:st=0:d=1.0,afade=t=out:st=${Math.max(0, totalDuration - 1.4).toFixed(2)}:d=1.4,volume=0.55`,
      "-c:a",
      "aac",
      "-b:a",
      "160k",
    );
  } else {
    cmd.push("-an");
  }

  cmd.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-profile:v",
    "high",
    "-level:v",
    "4.0",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-movflags",
    "+faststart",
    "-t",
    totalDuration.toFixed(3),
    "-shortest",
    outPath,
  );

  await execFileAsync(ffmpeg, cmd, { timeout: 240_000, maxBuffer: 1024 * 1024 * 4 });
}

// ---------------- scene drawing (server canvas) ----------------

async function renderSceneImage(
  scene: FilmScene,
  walk: Walk,
  options: FilmOptions,
  outPath: string,
) {
  const canvas = createCanvas(VIDEO_W, VIDEO_H);
  const ctx = canvas.getContext("2d");
  // mid-scene snapshot: t=0.5 gives the most representative still
  await drawSceneStatic(ctx, scene, walk, options, 0.5);
  const png = await canvas.encode("png");
  await fs.writeFile(outPath, png);
}

async function drawSceneStatic(
  ctx: SKRSContext2D,
  scene: FilmScene,
  walk: Walk,
  options: FilmOptions,
  t: number,
) {
  const mood =
    scene.kind === "moment"
      ? scene.moment.mood
      : scene.kind === "forgotten"
        ? "forgotten"
        : "mundane_sacred";
  drawBackground(ctx, mood, t);

  if (scene.kind === "opening") {
    drawKicker(ctx, "dearchats");
    drawWrapped(
      ctx,
      options.includeNames ? `${walk.opening.user_name} & ${walk.opening.other_name}` : "A memory film",
      64,
      340,
      590,
      62,
      "serif",
      "#f1ead8",
      1.04,
    );
    drawWrapped(
      ctx,
      `${walk.opening.duration_human} · ${walk.opening.message_count.toLocaleString()} messages`,
      68,
      520,
      560,
      24,
      "sans",
      "rgba(168,158,145,0.82)",
      1.35,
    );
    const openingLine = scene.line ?? walk.opening.line;
    drawWrapped(ctx, `“${openingLine}”`, 68, 760, 560, 36, "serifItalic", "rgba(241,234,216,0.94)", 1.18);
    return;
  }

  if (scene.kind === "moment") {
    const line = scene.caption ?? scene.moment.ai_summary;
    drawKicker(ctx, formatDate(scene.moment.date));
    drawWrapped(ctx, `“${line}”`, 68, 360, 580, 42, "serifItalic", "#f1ead8", 1.16, 5);
    if (options.includeMessages) drawMessagePreview(ctx, scene.moment, walk, 650);
    return;
  }

  if (scene.kind === "photo") {
    const img = await loadServerImage(walk.session_id, scene.photo.filename);
    if (scene.label) drawKicker(ctx, scene.label);
    if (img) {
      drawPolaroid(ctx, img, 128, 300, 464, 580, -0.03);
    } else {
      drawWrapped(ctx, "a photo you shared", 68, 600, 560, 38, "serifItalic", "rgba(241,234,216,0.92)", 1.16);
    }
    return;
  }

  if (scene.kind === "dictionary") {
    drawKicker(ctx, "a private word");
    drawWrapped(ctx, scene.phrase, 70, 430, 580, 78, "serifItalic", "#f1ead8", 1.0);
    drawWrapped(ctx, scene.hint, 74, 625, 560, 30, "sans", "rgba(241,234,216,0.78)", 1.32);
    return;
  }

  if (scene.kind === "forgotten") {
    drawKicker(ctx, "what was forgotten");
    drawWrapped(ctx, `“${scene.caption ?? scene.moment.ai_summary}”`, 68, 450, 580, 46, "serifItalic", "#f1ead8", 1.15);
    drawWrapped(ctx, formatDate(scene.moment.date), 72, 720, 560, 24, "sans", "rgba(168,158,145,0.72)", 1.3);
    return;
  }

  drawWrapped(ctx, "DearChats", 74, 510, 560, 76, "serif", "#f1ead8", 1);
  drawWrapped(
    ctx,
    scene.kind === "ending" && scene.line ? scene.line : "made from the parts you almost forgot",
    78,
    620,
    540,
    28,
    "sans",
    "rgba(168,158,145,0.82)",
    1.35,
  );
}

function drawBackground(ctx: SKRSContext2D, mood: keyof typeof MOOD_TONE, t: number) {
  const tone = MOOD_TONE[mood];
  const bg = ctx.createLinearGradient(0, 0, 0, VIDEO_H);
  bg.addColorStop(0, "#110d0c");
  bg.addColorStop(1, "#070504");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIDEO_W, VIDEO_H);

  const glow = ctx.createRadialGradient(
    VIDEO_W * 0.5,
    VIDEO_H * (0.28 + Math.sin(t * Math.PI) * 0.04),
    10,
    VIDEO_W * 0.5,
    VIDEO_H * 0.35,
    520,
  );
  glow.addColorStop(0, tone.glow.replace("0.35", "0.42"));
  glow.addColorStop(1, "rgba(7,5,4,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, VIDEO_W, VIDEO_H);

  ctx.fillStyle = "rgba(241,234,216,0.55)";
  for (let i = 0; i < 70; i++) {
    const x = (i * 97 + 43) % VIDEO_W;
    const y = (i * 173 + Math.sin(t * 3 + i) * 8 + 19) % VIDEO_H;
    const r = i % 7 === 0 ? 1.4 : 0.8;
    ctx.globalAlpha = 0.18 + (i % 5) * 0.045;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawKicker(ctx: SKRSContext2D, text: string) {
  ctx.font = "18px Inter, sans-serif";
  ctx.fillStyle = "rgba(168,158,145,0.68)";
  ctx.fillText(text.toUpperCase(), 70, 92);
}

function drawWrapped(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
  face: "serif" | "serifItalic" | "sans",
  color: string,
  lineHeight: number,
  maxLines = 8,
) {
  const family = face === "sans" ? "Inter, sans-serif" : "Georgia, serif";
  const style = face === "serifItalic" ? "italic " : "";
  ctx.font = `${style}${size}px ${family}`;
  ctx.fillStyle = color;
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines && visible.length > 0) {
    visible[visible.length - 1] = `${visible[visible.length - 1].replace(/[.,;:!?…]*$/, "")}…`;
  }
  visible.forEach((l, i) => ctx.fillText(l, x, y + i * size * lineHeight));
}

function drawPolaroid(
  ctx: SKRSContext2D,
  img: Image,
  x: number,
  y: number,
  w: number,
  h: number,
  rotation: number,
) {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(rotation);
  ctx.fillStyle = "#f3eadb";
  roundRect(ctx, -w / 2, -h / 2, w, h, 18);
  ctx.fill();
  drawImageCover(ctx, img, -w / 2 + 24, -h / 2 + 24, w - 48, h - 128);
  ctx.restore();
}

function drawImageCover(ctx: SKRSContext2D, img: Image, x: number, y: number, w: number, h: number) {
  const iw = img.width;
  const ih = img.height;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function drawMessagePreview(ctx: SKRSContext2D, moment: MomentOut, walk: Walk, y: number) {
  const messages = moment.messages.filter((m) => m.text.trim().length > 0).slice(0, 2);
  let cursor = y;
  for (const message of messages) {
    const isUser = message.sender === (walk.opening.user_raw_name ?? walk.opening.user_name);
    const text = message.text.length > 86 ? `${message.text.slice(0, 86)}…` : message.text;
    const x = isUser ? 158 : 70;
    const w = 492;
    ctx.fillStyle = isUser ? "rgba(216,160,144,0.17)" : "rgba(241,234,216,0.08)";
    roundRect(ctx, x, cursor, w, 92, 24);
    ctx.fill();
    drawWrapped(ctx, text, x + 26, cursor + 38, w - 52, 22, "sans", "rgba(241,234,216,0.86)", 1.22);
    cursor += 112;
  }
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function loadServerImage(walkId: string, filename: string): Promise<Image | null> {
  try {
    const p = mediaPath(walkId, filename);
    const buf = await fs.readFile(p);
    return await loadImage(buf);
  } catch {
    return null;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
