"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Walk } from "@/lib/types";
import { MOOD_TONE } from "@/components/universe/moodTone";
import { getMusic } from "@/lib/music";
import {
  buildFilmScenes,
  DEFAULT_FILM_OPTIONS,
  type FilmMedia,
  type FilmOptions,
  type FilmScene,
} from "@/lib/film/scenes";

interface MediaItem {
  url: string;
  ts: string | null;
  filename: string;
  has_person?: boolean | null;
  kind?: string | null;
}

interface Props {
  open: boolean;
  walk: Walk;
  media: MediaItem[];
  onClose: () => void;
  onPauseMusic?: () => void;
}

interface ServerFilm {
  id: string;
  status: "queued" | "rendering" | "ready" | "error";
  progress: number;
  stage: string | null;
  options: FilmOptions;
  duration_seconds: number | null;
  bytes: number | null;
  error: string | null;
  video_url: string | null;
  created_at: number;
  updated_at: number;
}

const POLL_INTERVAL_MS = 1500;

export default function VideoStudioDialog({ open, walk, media, onClose, onPauseMusic }: Props) {
  const [options, setOptions] = useState<FilmOptions>(DEFAULT_FILM_OPTIONS);
  const [film, setFilm] = useState<ServerFilm | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [customizing, setCustomizing] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);

  const filmMedia = useMemo<FilmMedia[]>(
    () =>
      media.map((m) => ({
        url: m.url,
        filename: m.filename,
        ts: m.ts,
        has_person: m.has_person ?? null,
        kind: m.kind ?? null,
      })),
    [media],
  );
  const previewScenes = useMemo(() => buildFilmScenes(walk, filmMedia, options), [walk, filmMedia, options]);

  const rendering = film?.status === "rendering" || film?.status === "queued" || loading;
  const ready = film?.status === "ready" && film.video_url;
  const videoUrl = ready ? film.video_url : null;

  const clearPoll = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const fetchLatest = useCallback(
    async (signal?: AbortSignal): Promise<ServerFilm | null> => {
      const res = await fetch(`/api/walk/${walk.session_id}/film`, {
        cache: "no-store",
        signal,
      });
      if (!res.ok) throw new Error("Could not load film status.");
      const data = (await res.json()) as { film: ServerFilm | null };
      return data.film;
    },
    [walk.session_id],
  );

  const schedulePoll = useCallback(
    (delayMs: number) => {
      clearPoll();
      pollTimer.current = setTimeout(async () => {
        try {
          const latest = await fetchLatest();
          if (!mountedRef.current) return;
          if (latest) {
            setFilm(latest);
            if (latest.options) setOptions(latest.options);
            if (latest.status === "rendering" || latest.status === "queued") {
              schedulePoll(POLL_INTERVAL_MS);
            } else if (latest.status === "error") {
              setError(latest.error ?? "The film could not be rendered.");
            }
          }
        } catch {
          // transient network — try again
          schedulePoll(POLL_INTERVAL_MS * 2);
        }
      }, delayMs);
    },
    [fetchLatest, clearPoll],
  );

  // Open: fetch latest film, then resume polling if a job is mid-flight.
  useEffect(() => {
    mountedRef.current = true;
    if (!open) return;
    const controller = new AbortController();
    setError("");
    setLoading(true);
    fetchLatest(controller.signal)
      .then((latest) => {
        if (!mountedRef.current) return;
        setFilm(latest);
        if (latest?.options) setOptions(latest.options);
        if (latest && (latest.status === "rendering" || latest.status === "queued")) {
          schedulePoll(POLL_INTERVAL_MS);
        }
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setError("Could not load the latest film.");
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
    return () => {
      mountedRef.current = false;
      controller.abort();
      clearPoll();
    };
  }, [open, fetchLatest, schedulePoll, clearPoll]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !rendering) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open, rendering]);

  function updateOptions(next: (current: FilmOptions) => FilmOptions) {
    setOptions(next);
    setError("");
  }

  async function createFilm() {
    onPauseMusic?.();
    try {
      getMusic().setMuted(true, 1200);
    } catch {
      // music engine is unavailable in some test contexts
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/walk/${walk.session_id}/film`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ options }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not start the film render.");
      }
      const data = (await res.json()) as { film: ServerFilm };
      setFilm(data.film);
      schedulePoll(POLL_INTERVAL_MS);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the film render.");
    } finally {
      setLoading(false);
    }
  }

  async function shareFilm() {
    if (!videoUrl) return;
    try {
      const res = await fetch(videoUrl);
      if (!res.ok) throw new Error("Could not download the film for sharing.");
      const blob = await res.blob();
      const file = new File([blob], "dearchats-memory-film.mp4", { type: "video/mp4" });
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
        share?: (data: ShareData) => Promise<void>;
      };
      if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
        try {
          await nav.share({
            title: "DearChats memory film",
            text: "A short memory film made from DearChats.",
            files: [file],
          });
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError("Sharing was blocked by this browser. The MP4 is ready to save.");
          return;
        }
      }
      setError("This browser cannot share video files directly. The MP4 is ready to save.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not share the film.");
    }
  }

  function downloadFilm() {
    if (!videoUrl) return;
    const a = document.createElement("a");
    a.href = `${videoUrl}&download=1`;
    a.rel = "noopener";
    a.download = "dearchats-memory-film.mp4";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const progressPct = Math.max(0, Math.min(1, film?.progress ?? 0));
  const stageLabel = film?.stage ?? (loading ? "preparing" : "");

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-[#070504]/90 backdrop-blur-md pad-safe-bottom pad-safe-top"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={() => {
            if (!rendering) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Memory film studio"
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="relative w-full max-w-5xl max-h-[100dvh] sm:max-h-[calc(100dvh-3rem)] overflow-y-auto memory-scroll sm:rounded-2xl border-x-0 sm:border border-parchment/15 bg-[#070504] shadow-2xl shadow-black/70"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={rendering}
              aria-label="Close memory film studio"
              className="absolute right-3 top-3 z-10 h-11 w-11 rounded-full border border-parchment/15 bg-[#070504]/80 text-parchment/85 hover:text-parchment hover:border-parchment/40 disabled:opacity-40 transition touch-target text-lg leading-none"
            >
              ×
            </button>
            <section className="px-4 py-6 sm:px-8 sm:py-8">
              <p className="mx-auto max-w-3xl pr-12 text-center text-[12px] sm:text-sm leading-relaxed text-mist/65">
                Turn this walk into a short memory film you can keep, send, or share with the person who lived it with you.
              </p>
              <div className="mt-6">
                <div className="mx-auto w-full max-w-[300px] sm:max-w-[360px]">
                  {videoUrl ? (
                    <video
                      key={videoUrl}
                      src={videoUrl}
                      controls
                      playsInline
                      preload="metadata"
                      onError={() =>
                        setError("This browser could not load the saved MP4. Try Save MP4 or remake the film.")
                      }
                      className="aspect-[9/16] w-full rounded-[1.25rem] border border-parchment/15 bg-black object-cover shadow-2xl shadow-black/55"
                    />
                  ) : (
                    <FilmPreview walk={walk} scenes={previewScenes} options={options} rendering={rendering} />
                  )}
                </div>

                <div className="mx-auto mt-6 w-full max-w-4xl">
                  {rendering && (
                    <div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-parchment/10">
                        <div
                          className="h-full rounded-full bg-gold transition-all"
                          style={{ width: `${Math.round(progressPct * 100)}%` }}
                        />
                      </div>
                      <p className="mt-3 text-center text-[10px] tracking-[0.28em] uppercase text-mist/60">
                        {stageLabel ? `${stageLabel} · ` : ""}
                        {Math.round(progressPct * 100)}%
                      </p>
                      <p className="mt-2 text-center text-[11px] leading-relaxed text-mist/45">
                        Your film is rendering on our servers. Please keep this window open
                        until it&rsquo;s ready.
                      </p>
                    </div>
                  )}

                  {!rendering && film && film.status === "error" && (
                    <p className="rounded-xl border border-rose/30 bg-rose/10 px-4 py-3 text-sm text-parchment/85">
                      {film.error ?? "The last render failed. Try creating it again."}
                    </p>
                  )}

                  {error && !rendering && (
                    <p className="mt-3 rounded-xl border border-rose/30 bg-rose/10 px-4 py-3 text-sm text-parchment/85">
                      {error}
                    </p>
                  )}

                  <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <button
                      type="button"
                      onClick={createFilm}
                      disabled={rendering}
                      className="flex min-h-12 items-center justify-center rounded-full border border-gold/40 bg-gold/15 px-4 py-3 text-center text-[11px] tracking-[0.18em] uppercase leading-snug text-parchment hover:border-gold/70 hover:bg-gold/20 disabled:opacity-45 transition touch-target"
                    >
                      {videoUrl ? "Remake film" : "Create film"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCustomizing((v) => !v)}
                      disabled={rendering}
                      className="flex min-h-12 items-center justify-center rounded-full border border-parchment/18 bg-parchment/[0.04] px-4 py-3 text-center text-[11px] tracking-[0.18em] uppercase leading-snug text-parchment/85 hover:border-parchment/40 disabled:opacity-35 transition touch-target"
                    >
                      Customize
                    </button>
                    <button
                      type="button"
                      onClick={shareFilm}
                      disabled={!videoUrl || rendering}
                      className="flex min-h-12 items-center justify-center rounded-full border border-parchment/18 bg-parchment/[0.04] px-4 py-3 text-center text-[11px] tracking-[0.18em] uppercase leading-snug text-parchment/85 hover:border-parchment/40 disabled:opacity-35 transition touch-target"
                    >
                      Share film
                    </button>
                    <button
                      type="button"
                      onClick={downloadFilm}
                      disabled={!videoUrl || rendering}
                      className="flex min-h-12 items-center justify-center rounded-full border border-parchment/18 bg-parchment/[0.04] px-4 py-3 text-center text-[11px] tracking-[0.18em] uppercase leading-snug text-parchment/85 hover:border-parchment/40 disabled:opacity-35 transition touch-target"
                    >
                      Save MP4
                    </button>
                  </div>

                  <p className="mt-5 text-center text-[11px] leading-relaxed text-mist/55">
                    Films are rendered on our servers and kept private to your account. We keep the latest version ready —
                    open this any time to play, save, or share it.
                  </p>
                </div>
              </div>
            </section>
            <CustomizeFilmDialog
              open={customizing}
              options={options}
              hasMedia={media.length > 0}
              onClose={() => setCustomizing(false)}
              onUpdate={updateOptions}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function FilmPreview({
  walk,
  scenes,
  options,
  rendering,
}: {
  walk: Walk;
  scenes: FilmScene[];
  options: FilmOptions;
  rendering: boolean;
}) {
  const firstMoment = scenes.find(
    (scene): scene is Extract<FilmScene, { kind: "moment" }> => scene.kind === "moment",
  );
  const firstPhoto = scenes.find(
    (scene): scene is Extract<FilmScene, { kind: "photo" }> => scene.kind === "photo",
  );
  const photo = options.includePhotos ? firstPhoto?.photo : null;
  const tone = MOOD_TONE[firstMoment?.moment.mood ?? "mundane_sacred"];
  return (
    <div
      className="relative aspect-[9/16] w-full overflow-hidden rounded-[1.25rem] border border-parchment/15 bg-[#080605] shadow-2xl shadow-black/55"
      style={{ boxShadow: `0 24px 60px ${tone.glow}` }}
    >
      <div className="absolute inset-0 constellation-field opacity-80" />
      <div className="absolute inset-0 memory-signal-breath" />
      <div className="relative z-10 flex h-full flex-col p-5 sm:p-6">
        <div className="shrink-0">
          <p className="text-[9px] tracking-[0.32em] uppercase text-mist/55">
            {rendering ? "rendering" : "preview"}
          </p>
          <h3 className="serif mt-4 text-2xl sm:text-3xl leading-tight text-parchment text-balance overflow-wrap-anywhere">
            {options.includeNames ? `${walk.opening.user_name} & ${walk.opening.other_name}` : "A memory film"}
          </h3>
          <p className="mt-3 text-[10px] tracking-[0.24em] uppercase text-mist/55">
            {Math.round(scenes.reduce((n, scene) => n + scene.duration, 0))} seconds
          </p>
        </div>
        {photo ? (
          <div className="flex min-h-0 flex-1 items-center justify-center py-5">
            <div className="w-[70%] sm:w-[72%] rotate-[-3deg] rounded-md bg-[#f3eadb] p-2 shadow-2xl shadow-black/60">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="" className="aspect-[4/5] w-full rounded-sm object-cover" />
            </div>
          </div>
        ) : (
          <div className="flex-1" />
        )}
        <div className="shrink-0 rounded-xl bg-[#070504]/45 p-3 backdrop-blur-[1px]">
          <p className="serif italic text-base sm:text-lg leading-snug text-parchment/95 text-balance overflow-wrap-anywhere">
            &ldquo;{firstMoment?.moment.ai_summary ?? walk.opening.line}&rdquo;
          </p>
        </div>
      </div>
    </div>
  );
}

function CustomizeFilmDialog({
  open,
  options,
  hasMedia,
  onClose,
  onUpdate,
}: {
  open: boolean;
  options: FilmOptions;
  hasMedia: boolean;
  onClose: () => void;
  onUpdate: (next: (current: FilmOptions) => FilmOptions) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-20 flex items-stretch sm:items-center justify-center sm:rounded-2xl bg-[#070504]/85 px-4 py-5 backdrop-blur-md pad-safe-bottom pad-safe-top"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Customize memory film"
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="relative w-full max-w-lg max-h-full overflow-y-auto memory-scroll rounded-2xl border border-parchment/15 bg-[#0d0a09] px-5 py-6 shadow-2xl shadow-black/70 sm:px-6"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close customization"
              className="absolute right-3 top-3 h-11 w-11 rounded-full border border-parchment/15 bg-[#0d0a09]/80 text-parchment/85 hover:text-parchment hover:border-parchment/40 transition touch-target text-lg leading-none"
            >
              ×
            </button>
            <p className="text-[10px] tracking-[0.32em] uppercase text-mist/50 mb-4">customize film</p>
            <div className="grid gap-3">
              <ToggleRow
                label="Show names"
                description={
                  options.includeNames
                    ? "Uses both display names on the title card."
                    : "Uses a quieter anonymous title."
                }
                checked={options.includeNames}
                onChange={(v) => onUpdate((o) => ({ ...o, includeNames: v }))}
              />
              <ToggleRow
                label="Include photos"
                description={
                  hasMedia
                    ? "Adds selected polaroids when they match the chosen memories."
                    : "No uploaded photos were found for this walk."
                }
                checked={options.includePhotos && hasMedia}
                disabled={!hasMedia}
                onChange={(v) => onUpdate((o) => ({ ...o, includePhotos: v }))}
              />
              <ToggleRow
                label="Message excerpts"
                description={
                  options.includeMessages
                    ? "Shows short, selected bubbles only."
                    : "Uses dates and narration without message text."
                }
                checked={options.includeMessages}
                onChange={(v) => onUpdate((o) => ({ ...o, includeMessages: v }))}
              />
              <ToggleRow
                label="Soft music"
                description="Adds the relationship score to the exported video."
                checked={options.includeMusic}
                onChange={(v) => onUpdate((o) => ({ ...o, includeMusic: v }))}
              />
            </div>
            <div className="mt-5">
              <p className="text-[10px] tracking-[0.28em] uppercase text-mist/45 mb-3">length</p>
              <div className="grid grid-cols-2 gap-2">
                <LengthButton
                  active={options.length === "short"}
                  onClick={() => onUpdate((o) => ({ ...o, length: "short" }))}
                >
                  30s
                </LengthButton>
                <LengthButton
                  active={options.length === "standard"}
                  onClick={() => onUpdate((o) => ({ ...o, length: "standard" }))}
                >
                  1 min
                </LengthButton>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 w-full rounded-full border border-gold/40 bg-gold/15 px-5 py-3 text-xs tracking-[0.22em] uppercase text-parchment hover:border-gold/70 hover:bg-gold/20 transition touch-target"
            >
              Done
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`flex items-center justify-between gap-4 rounded-xl border border-parchment/10 bg-[#080605]/62 px-4 py-3 ${
        disabled ? "opacity-45" : ""
      }`}
    >
      <span className="min-w-0">
        <span className="block text-sm text-parchment">{label}</span>
        <span className="mt-0.5 block text-xs leading-snug text-mist/55">{description}</span>
      </span>
      <input
        type="checkbox"
        className="h-5 w-5 accent-[#c9a961]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function LengthButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-3 text-xs tracking-[0.24em] uppercase transition touch-target ${
        active
          ? "border-gold/50 bg-gold/15 text-parchment"
          : "border-parchment/12 bg-parchment/[0.03] text-mist hover:text-parchment hover:border-parchment/28"
      }`}
    >
      {children}
    </button>
  );
}
