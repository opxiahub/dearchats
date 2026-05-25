"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import MomentDialog from "@/components/MomentDialog";
import ImageLightbox from "@/components/ImageLightbox";
import MonthPhotosDialog from "@/components/MonthPhotosDialog";
import PrivateDictionary from "@/components/PrivateDictionary";
import ReaderMode from "@/components/reader/ReaderMode";
import BrandMark from "@/components/BrandMark";
import VideoStudioDialog from "@/components/VideoStudioDialog";
import { AudioToggleIcon } from "@/components/AudioToggleIcon";
import { getMusic } from "@/lib/music";
import type { Message, Pattern, ProcessingStatus, Walk } from "@/lib/types";

const Universe = dynamic(() => import("@/components/universe/Universe"), { ssr: false });

interface MediaItem {
  url: string;
  ts: string | null;
  filename: string;
  has_person?: boolean | null;
  kind?: string | null;
}

interface ProfileUser {
  name: string | null;
  email: string | null;
  picture: string | null;
}

type Mode = "universe" | "reader";

export default function WalkPage() {
  const params = useParams<{ sessionId: string }>();
  const [walk, setWalk] = useState<Walk | null>(null);
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [error, setError] = useState("");
  const [activeMomentId, setActiveMomentId] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState<string | null>(null);
  const [musicOn, setMusicOn] = useState(() => {
    if (typeof window === "undefined") return true;
    return sessionStorage.getItem("dc_music_on") !== "0";
  });
  const [mode, setMode] = useState<Mode>("universe");
  const [supportsWebGL, setSupportsWebGL] = useState<boolean | null>(null);
  const [viewMode, setViewMode] = useState<"all" | "year">("all");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [dictOpen, setDictOpen] = useState(false);
  const [monthPhotos, setMonthPhotos] = useState<{ month: number; photos: MediaItem[] } | null>(null);
  const [yearSummaryOpen, setYearSummaryOpen] = useState(false);
  const [storySummaryOpen, setStorySummaryOpen] = useState(false);
  const [videoStudioOpen, setVideoStudioOpen] = useState(false);
  const [statusLines, setStatusLines] = useState<string[]>([]);
  const [zoomSignal, setZoomSignal] = useState(0);
  // Whether the top-right ChromeMenu dropdown is open — used to hide the
  // top-center YearPicker on phones so the dropdown doesn't visually overlap it.
  const [chromeMenuOpen, setChromeMenuOpen] = useState(false);
  // Tracks whether the universe is currently zoomed in past the threshold.
  // Surfaces a zoom-out shortcut + swaps the bottom hint copy so users can
  // tell why drag is now panning instead of orbiting.
  const [universeZoomedIn, setUniverseZoomedIn] = useState(false);
  const introShownRef = useRef(false);

  function enterYear(y: number) {
    setSelectedYear(y);
    setViewMode("year");
    setYearSummaryOpen(false);
    setStorySummaryOpen(false);
    setVideoStudioOpen(false);
  }
  function exitYear() {
    setViewMode("all");
    setSelectedYear(null);
    setYearSummaryOpen(false);
  }

  useEffect(() => {
    let stop = false;
    async function loadUser() {
      try {
        const res = await fetch("/api/me");
        if (!res.ok) return;
        const data: { user: ProfileUser | null } = await res.json();
        if (!stop) setUser(data.user);
      } catch {}
    }
    loadUser();
    return () => { stop = true; };
  }, []);

  // WebGL capability detect
  useEffect(() => {
    try {
      const c = document.createElement("canvas");
      const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
      const ok = !!gl;
      setSupportsWebGL(ok);
      if (!ok) setMode("reader");
    } catch {
      setSupportsWebGL(false);
      setMode("reader");
    }
  }, []);

  // Poll walk
  useEffect(() => {
    let stop = false;
    let isFinal = false;
    async function tick() {
      try {
        const r = await fetch(`/api/walk/${params.sessionId}`);
        if (r.ok) {
          const w: Walk & { pipeline_error?: string } = await r.json();
          if (w.pipeline_error) { if (!stop) setError(w.pipeline_error); return; }
          if (!stop) setWalk(w);
          if (w.is_final) { isFinal = true; }
        } else if (r.status === 500) {
          const body = await r.json().catch(() => ({}));
          if (!stop) setError(body.error ?? "Something went wrong.");
          return;
        }
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : String(e));
        return;
      }
      if (!stop && !isFinal) setTimeout(tick, 3000);
    }
    tick();
    return () => { stop = true; };
  }, [params.sessionId]);

  // Keep the opening bridge fed with the same real chat-derived vignettes as
  // the processing screen while Phase B is still forming stars.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function fetchStatus() {
      try {
        const r = await fetch(`/api/status/${params.sessionId}`);
        if (r.ok) {
          const s: ProcessingStatus = await r.json();
          if (!stop) setStatusLines(s.vignettes ?? []);
          if (s.done || s.stage === "error") return;
        }
      } catch {}
      if (!stop) timer = setTimeout(fetchStatus, 2500);
    }
    fetchStatus();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [params.sessionId]);

  // Fetch media manifest. Polls every 4s while classification is still pending
  // so newly tagged photos flow into the universe live.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function fetchMedia() {
      try {
        const r = await fetch(`/api/media/${params.sessionId}`);
        if (r.ok) {
          const data: { media: MediaItem[] } = await r.json();
          if (!stop) {
            setMedia(data.media ?? []);
            const pending = (data.media ?? []).some((m) => m.has_person == null);
            if (pending) timer = setTimeout(fetchMedia, 4000);
          }
        }
      } catch {}
    }
    fetchMedia();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [params.sessionId]);

  const musicKey = walk ? (!walk.is_final && walk.moments.length === 0 ? "loading" : "explore") : null;

  function toggleMusic() {
    const next = !musicOn;
    setMusicOn(next);
    sessionStorage.setItem("dc_music_on", next ? "1" : "0");
    getMusic().setMuted(!next, 1200);
    if (next && musicKey) getMusic().crossfadeTo(musicKey, musicKey === "explore" ? 5000 : 1800);
  }

  // Music engine init
  useEffect(() => {
    sessionStorage.setItem("dc_music_on", musicOn ? "1" : "0");
    getMusic().setMuted(!musicOn, 1200);
    if (musicOn && musicKey) getMusic().crossfadeTo(musicKey, musicKey === "explore" ? 5000 : 1800);
  }, [musicKey, musicOn]);

  useEffect(() => () => { getMusic().setMuted(true); }, []);

  // First-load opening overlay timing
  useEffect(() => {
    if (walk && !introShownRef.current) {
      introShownRef.current = true;
    }
  }, [walk]);

  const uniqueChapters = useMemo(() => {
    if (!walk) return [];
    const sorted = [...walk.chapters].sort((a, b) => (a.span_start ?? "").localeCompare(b.span_start ?? ""));
    const seen = new Set<string>();
    return sorted.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  }, [walk]);

  const activeMoment = useMemo(() => {
    if (!activeMomentId || !walk) return null;
    return walk.moments.find((m) => m.id === activeMomentId) ?? null;
  }, [activeMomentId, walk]);

  if (error) {
    return (
      <main className="min-h-dvh flex items-center justify-center bg-ink text-parchment px-6">
        <div className="text-center">
          <p className="serif text-2xl mb-4">{error}</p>
          <Link href="/upload" className="serif italic underline">start a new walk</Link>
        </div>
      </main>
    );
  }
  if (!walk) {
    return (
      <main className="min-h-dvh flex items-center justify-center bg-ink text-mist">
        <p className="serif italic text-lg">…</p>
      </main>
    );
  }

  return (
    <main className="fixed inset-0 bg-[#070504] text-parchment overflow-hidden">
      {/* Soft top fade so reader-mode prose and any star labels never blur into
          the brandmark / profile menu when they scroll past them. */}
      <div className="header-fade" aria-hidden />

      {/* Universe canvas */}
      {mode === "universe" && supportsWebGL !== false && walk.moments.length > 0 && (
        <Universe
          walk={walk}
          media={media}
          activeMomentId={activeMomentId}
          onOpenMoment={setActiveMomentId}
          onOpenImage={setActiveImage}
          onOpenMonthPhotos={(month, photos) => setMonthPhotos({ month, photos })}
          onOpenYearSummary={() => setYearSummaryOpen(true)}
          onOpenStorySummary={() => setStorySummaryOpen(true)}
          finale={false}
          musicOn={musicOn}
          zoomSignal={zoomSignal}
          viewMode={viewMode}
          selectedYear={selectedYear}
          onZoomedChange={setUniverseZoomedIn}
        />
      )}

      {/* Reader-mode (2D fallback or user-chosen) */}
      {mode === "reader" && (
        <ReaderMode
          walk={walk}
          chapters={uniqueChapters}
          media={media}
          onOpenMoment={setActiveMomentId}
          onOpenImage={setActiveImage}
          musicOn={musicOn}
          selectedYear={viewMode === "year" ? selectedYear : null}
          onOpenVideo={() => setVideoStudioOpen(true)}
        />
      )}

      {/* Top-right chrome — music toggle and profile/menu side by side. */}
      <button
        type="button"
        onClick={toggleMusic}
        aria-label={musicOn ? "Mute music" : "Play music"}
        className="absolute top-3 sm:top-4 right-[60px] sm:right-[64px] z-30 flex h-11 w-11 items-center justify-center rounded-full border border-parchment/20 bg-ink/60 text-parchment/85 hover:border-parchment/60 transition touch-target backdrop-blur-md"
      >
        <AudioToggleIcon muted={!musicOn} />
      </button>
      <ChromeMenu
        user={user}
        showReaderToggle={supportsWebGL !== false}
        mode={mode}
        onModeToggle={() => setMode((m) => (m === "universe" ? "reader" : "universe"))}
        hasDictionary={(walk.private_dictionary?.patterns?.length ?? 0) > 0}
        onDictionary={() => setDictOpen(true)}
        onVideo={() => setVideoStudioOpen(true)}
        onOpenChange={setChromeMenuOpen}
      />

      <div className="absolute left-3 sm:left-4 top-3 sm:top-4 z-30">
        <BrandMark compact />
      </div>

      {mode === "universe" && (
        <div className="hidden lg:flex absolute right-4 top-20 z-20 flex-col gap-2">
          <button
            type="button"
            onClick={() => setZoomSignal((n) => n + 1)}
            aria-label="Zoom in"
            className="h-10 w-10 rounded-full border border-parchment/15 bg-ink/55 backdrop-blur-md text-parchment/80 hover:text-parchment hover:border-parchment/40 transition"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setZoomSignal((n) => n - 1)}
            aria-label="Zoom out"
            className="h-10 w-10 rounded-full border border-parchment/15 bg-ink/55 backdrop-blur-md text-parchment/80 hover:text-parchment hover:border-parchment/40 transition"
          >
            -
          </button>
        </div>
      )}

      {/* Top-center year picker — hidden on phones while the chrome menu is
          open so its dropdown doesn't visually overlap the year chip. */}
      {walk.moments.length > 0 && (
        <div className={`${chromeMenuOpen ? "hidden sm:block" : ""}`}>
          <YearPicker walk={walk} viewMode={viewMode} selectedYear={selectedYear} onAll={exitYear} onYear={enterYear} />
        </div>
      )}

      {/* Bottom-left identity badge — quiet, never blocks the view. Hidden on
          phones in portrait because the finale pill already occupies the
          bottom of the viewport. */}
      {mode === "universe" && (
        <div className="hidden sm:block absolute bottom-5 left-5 z-20 pointer-events-none max-w-[40vw]">
          <p className="text-[10px] tracking-[0.32em] text-mist/40 uppercase leading-relaxed truncate">
            {walk.opening.user_name} <span className="text-mist/25">&</span> {walk.opening.other_name}
            <br />
            <span className="text-mist/30">{walk.opening.duration_human.toLowerCase()}</span>
          </p>
        </div>
      )}

      {mode === "universe" && (
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 px-3 pad-safe-bottom max-w-[calc(100vw-1.5rem)] flex items-center gap-2">
          {universeZoomedIn ? (
            <button
              type="button"
              onClick={() => setZoomSignal((n) => n - 6)}
              className="rounded-full border border-parchment/25 bg-ink/65 backdrop-blur-md px-3.5 py-2 text-[10px] sm:text-[11px] tracking-[0.22em] sm:tracking-[0.26em] uppercase text-parchment/90 hover:border-parchment/55 hover:text-parchment transition touch-target flex items-center gap-1.5 whitespace-nowrap"
              aria-label="Zoom out to see the whole universe"
            >
              <ZoomOutIcon />
              <span>zoom out</span>
            </button>
          ) : (
            <p className="pointer-events-none rounded-full border border-parchment/10 bg-ink/45 backdrop-blur-md px-3.5 py-2 text-[9px] sm:text-[10px] tracking-[0.22em] sm:tracking-[0.26em] uppercase text-mist/65 text-center whitespace-nowrap">
              pinch to zoom
            </p>
          )}
        </div>
      )}

      {/* Guided opening bridge: keeps the user inside the story while Phase B
          finishes turning the curated memories into stars. */}
      <AnimatePresence>
        {walk && !walk.is_final && walk.moments.length === 0 && (
          <OpeningJourney
            walk={walk}
            media={media}
            statusLines={statusLines}
            musicOn={musicOn}
            onMusic={toggleMusic}
          />
        )}
      </AnimatePresence>

      {activeMoment && (
        <MomentDialog
          moment={activeMoment}
          userName={walk.opening.user_raw_name ?? walk.opening.user_name}
          chapterTitle={uniqueChapters.find((c) => c.id === activeMoment.chapter_id)?.title}
          onClose={() => setActiveMomentId(null)}
        />
      )}

      <ImageLightbox url={activeImage} onClose={() => setActiveImage(null)} />
      <PrivateDictionary open={dictOpen} walk={walk} onClose={() => setDictOpen(false)} />
      <StorySummaryDialog
        open={storySummaryOpen}
        walk={walk}
        onClose={() => setStorySummaryOpen(false)}
        onMakeFilm={() => {
          setStorySummaryOpen(false);
          setVideoStudioOpen(true);
        }}
      />
      <YearSummaryDialog
        open={yearSummaryOpen}
        walk={walk}
        year={selectedYear}
        onClose={() => setYearSummaryOpen(false)}
      />
      <MonthPhotosDialog
        open={monthPhotos !== null}
        year={selectedYear}
        month={monthPhotos?.month ?? null}
        photos={monthPhotos?.photos ?? []}
        onClose={() => setMonthPhotos(null)}
        onOpenImage={(url) => setActiveImage(url)}
      />
      <VideoStudioDialog
        open={videoStudioOpen}
        walk={walk}
        media={media}
        onClose={() => setVideoStudioOpen(false)}
        onPauseMusic={() => setMusicOn(false)}
      />
    </main>
  );
}

/**
 * Single floating chip that shows the current view and opens a clean dropdown
 * of all years on click. Years come with their per-year moment counts so the
 * picker doubles as a quick "where was the action" overview.
 */
function YearPicker({
  walk,
  viewMode,
  selectedYear,
  onAll,
  onYear,
}: {
  walk: Walk;
  viewMode: "all" | "year";
  selectedYear: number | null;
  onAll: () => void;
  onYear: (y: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const years = useMemo(() => {
    const first = Number(walk.opening.first_date.slice(0, 4));
    const last = Number(walk.opening.last_date.slice(0, 4));
    if (!Number.isFinite(first) || !Number.isFinite(last)) return [];
    const arr: number[] = [];
    for (let y = first; y <= last; y++) arr.push(y);
    return arr;
  }, [walk.opening.first_date, walk.opening.last_date]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); window.removeEventListener("keydown", onKey); };
  }, [open]);

  if (years.length < 1) return null;

  const label = viewMode === "all" ? "all years" : String(selectedYear);
  const countByYear = useMemo(() => {
    const map = new Map<number, number>();
    for (const m of walk.moments) {
      const y = Number(m.date.slice(0, 4));
      map.set(y, (map.get(y) ?? 0) + 1);
    }
    return map;
  }, [walk.moments]);

  return (
    <div ref={ref} className="absolute top-16 sm:top-4 left-1/2 -translate-x-1/2 z-30 max-w-[calc(100vw-7rem)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-parchment/20 bg-ink/60 backdrop-blur-md px-3.5 sm:px-4 py-2 text-[10px] sm:text-xs tracking-[0.24em] uppercase text-parchment/90 hover:border-parchment/45 transition min-w-[7rem] sm:min-w-[8rem] justify-center touch-target"
      >
        <span className="truncate">{label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-[min(20rem,90vw)] max-h-[70dvh] overflow-y-auto memory-scroll rounded-2xl border border-parchment/15 bg-[#0d0a09]/95 backdrop-blur-xl shadow-2xl shadow-black/60"
          >
            <YearPickerItem active={viewMode === "all"} onClick={() => { onAll(); setOpen(false); }}>
              <span>All years</span>
              <span className="text-mist/50 text-[10px] tracking-widest">{walk.moments.length} memories</span>
            </YearPickerItem>
            <div className="h-px bg-parchment/10" />
            {years.map((y) => {
              const c = countByYear.get(y) ?? 0;
              return (
                <YearPickerItem
                  key={y}
                  active={viewMode === "year" && selectedYear === y}
                  onClick={() => { onYear(y); setOpen(false); }}
                >
                  <span>{y}</span>
                  <span className="text-mist/50 text-[10px] tracking-widest">{c === 0 ? "quiet" : `${c} ${c === 1 ? "memory" : "memories"}`}</span>
                </YearPickerItem>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function YearPickerItem({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-4 px-4 py-3 text-xs tracking-[0.22em] uppercase transition ${
        active ? "bg-gold/12 text-parchment" : "text-mist hover:bg-parchment/[0.04] hover:text-parchment"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Single discreet menu icon. Opens a clean panel with music / mode / dictionary / exit.
 * Keeps the top of the viewport visually quiet while the universe breathes.
 */
function ChromeMenu({
  user,
  showReaderToggle,
  mode,
  onModeToggle,
  hasDictionary,
  onDictionary,
  onVideo,
  onOpenChange,
}: {
  user: ProfileUser | null;
  showReaderToggle: boolean;
  mode: "universe" | "reader";
  onModeToggle: () => void;
  hasDictionary: boolean;
  onDictionary: () => void;
  onVideo: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={ref} className="absolute top-3 sm:top-4 right-3 sm:right-4 z-30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Menu"
        className="h-11 w-11 rounded-full border border-parchment/20 bg-ink/60 backdrop-blur-md flex items-center justify-center text-parchment/85 hover:border-parchment/60 transition touch-target overflow-hidden"
      >
        {user?.picture ? (
          <img src={user.picture} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
        ) : user ? (
          <span className="flex h-full w-full items-center justify-center serif text-sm text-parchment bg-parchment/10">
            {profileInitials(user)}
          </span>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path d="M2 4h10M2 7h10M2 10h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="absolute top-full right-0 mt-2 w-[min(15rem,calc(100vw-1.5rem))] max-h-[70dvh] overflow-y-auto memory-scroll rounded-2xl border border-parchment/15 bg-[#0d0a09]/95 backdrop-blur-xl shadow-2xl shadow-black/60"
          >
            {user && (
              <div className="flex items-center gap-3 px-4 py-4 border-b border-parchment/10">
                <div className="h-10 w-10 rounded-full overflow-hidden border border-parchment/20 bg-parchment/10 shrink-0">
                  {user.picture ? (
                    <img src={user.picture} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center serif text-sm text-parchment">
                      {profileInitials(user)}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="serif text-base text-parchment truncate">{user.name || "Your profile"}</p>
                  {user.email && <p className="text-[11px] text-mist/60 truncate">{user.email}</p>}
                </div>
              </div>
            )}
            {showReaderToggle && (
              <MenuRow
                icon={mode === "universe" ? "doc" : "star"}
                label={mode === "universe" ? "Reader mode" : "Universe mode"}
                onClick={() => { onModeToggle(); setOpen(false); }}
              />
            )}
            {hasDictionary && (
              <MenuRow icon="book" label="Private dictionary" onClick={() => { onDictionary(); setOpen(false); }} />
            )}
            <MenuRow icon="film" label="Make memory film" onClick={() => { onVideo(); setOpen(false); }} />
            {user && (
              <>
                <div className="h-px bg-parchment/10" />
                <Link
                  href="/profile"
                  className="flex w-full items-center gap-3 px-4 py-3 text-xs tracking-[0.22em] uppercase text-mist hover:bg-parchment/[0.04] hover:text-parchment transition"
                  onClick={() => setOpen(false)}
                >
                  <MenuIcon kind="gallery" />
                  <span>View generations</span>
                </Link>
                <a
                  href="https://github.com/opxiahub/dearchats"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center gap-3 px-4 py-3 text-xs tracking-[0.22em] uppercase text-mist hover:bg-parchment/[0.04] hover:text-parchment transition"
                  onClick={() => setOpen(false)}
                >
                  <GitHubIcon />
                  <span>Star on GitHub</span>
                </a>
                <a
                  href="/api/auth/signout"
                  className="flex w-full items-center gap-3 px-4 py-3 text-xs tracking-[0.22em] uppercase text-mist hover:bg-parchment/[0.04] hover:text-parchment transition"
                >
                  <MenuIcon kind="signout" />
                  <span>Sign out</span>
                </a>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function profileInitials(user: ProfileUser): string {
  const source = user.name || user.email || "you";
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "Y";
}

function MenuRow({ icon, label, onClick, dim }: { icon: "book" | "note" | "doc" | "star" | "film"; label: string; onClick: () => void; dim?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-xs tracking-[0.22em] uppercase transition ${
        dim ? "text-mist/60 hover:text-parchment" : "text-mist hover:text-parchment"
      } hover:bg-parchment/[0.04]`}
    >
      <MenuIcon kind={icon} />
      <span>{label}</span>
    </button>
  );
}

function ZoomOutIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden className="shrink-0">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M4.6 7h4.8M11 11l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden className="shrink-0">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function MenuIcon({ kind }: { kind: "book" | "note" | "doc" | "star" | "film" | "gallery" | "signout" }) {
  const p = {
    book: "M3 3h7a2 2 0 012 2v8H5a2 2 0 00-2 2V3z",
    note: "M5 11V3l8-1v8M5 11a2 2 0 11-2-2 2 2 0 012 2zm8-1a2 2 0 11-2-2 2 2 0 012 2z",
    doc: "M4 2h5l4 4v8H4V2zM9 2v4h4",
    star: "M8 1l2 5 5 .5-4 3.5 1.5 5L8 12l-4.5 3 1.5-5L1 6.5 6 6z",
    film: "M3 3h10v10H3V3zM6 3v10M10 3v10M3 6h10M3 10h10",
    gallery: "M2.5 3.5h11v9h-11v-9zM5 7a1 1 0 100-2 1 1 0 000 2zM3 12l3.5-3.5L9 11l2.5-2.5L13 10",
    signout: "M9.5 2.5H3v11h6.5M7 8h7M11.5 5.5L14 8l-2.5 2.5",
  } as const;
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden className="shrink-0">
      <path d={p[kind]} stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const YEAR_DIALOG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function StorySummaryDialog({
  open,
  walk,
  onClose,
  onMakeFilm,
}: {
  open: boolean;
  walk: Walk;
  onClose: () => void;
  onMakeFilm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#070504]/88 backdrop-blur-sm px-4 py-6 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="All years story note"
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="relative w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto memory-scroll rounded-2xl border border-parchment/15 bg-[#070504] shadow-2xl shadow-black/70 px-5 py-6 sm:px-8 sm:py-8"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close story note"
              className="absolute right-3 top-3 h-11 w-11 rounded-full border border-parchment/15 bg-parchment/[0.03] text-parchment/75 hover:text-parchment hover:border-parchment/40 transition touch-target"
            >
              x
            </button>
            <p className="text-[10px] tracking-[0.34em] uppercase text-mist/50 mb-5">this is the story of</p>
            <h2 className="serif text-5xl sm:text-7xl leading-none text-parchment mb-4 text-balance overflow-wrap-anywhere">
              {walk.opening.duration_human}
            </h2>
            <p className="serif text-lg sm:text-2xl leading-snug text-mist text-balance overflow-wrap-anywhere">
              {walk.opening.message_count.toLocaleString()} messages between {walk.opening.user_name} & {walk.opening.other_name}
            </p>
            <p className="serif italic text-xl sm:text-3xl leading-snug text-parchment/95 text-balance mt-8">
              &ldquo;{walk.opening.line}&rdquo;
            </p>
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <YearSummaryStat label="years" value={walk.opening.duration_human} />
              <YearSummaryStat label="messages" value={walk.opening.message_count.toLocaleString()} />
              <YearSummaryStat label="memories" value={walk.moments.length.toLocaleString()} />
            </div>
            <button
              type="button"
              onClick={onMakeFilm}
              className="mt-8 w-full rounded-full border border-gold/40 bg-gold/15 px-5 py-3 text-xs tracking-[0.24em] uppercase text-parchment hover:border-gold/70 hover:bg-gold/20 transition"
            >
              Make memory film
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function YearSummaryDialog({
  open,
  walk,
  year,
  onClose,
}: {
  open: boolean;
  walk: Walk;
  year: number | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  const summary = useMemo(() => {
    if (!year) return null;
    const sig = walk.year_signatures?.find((s) => s.year === year);
    const moments = walk.moments.filter((m) => m.date.startsWith(String(year)));
    const moodCounts = new Map<string, number>();
    const monthCounts = new Map<number, number>();
    for (const moment of moments) {
      moodCounts.set(moment.mood, (moodCounts.get(moment.mood) ?? 0) + 1);
      const month = Number(moment.date.slice(5, 7));
      if (Number.isFinite(month)) monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
    }
    const dominantMood = [...moodCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const loudestMonth = [...monthCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return {
      line: sig?.line ?? `${year} held ${moments.length} ${moments.length === 1 ? "memory" : "memories"}.`,
      momentCount: sig?.moment_count ?? moments.length,
      messageCount: sig?.message_count ?? null,
      dominantMood,
      loudestMonth: loudestMonth ? YEAR_DIALOG_MONTHS[loudestMonth - 1] : null,
      isEmpty: sig?.is_empty ?? moments.length === 0,
    };
  }, [walk.moments, walk.year_signatures, year]);

  if (!year || !summary) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#070504]/88 backdrop-blur-sm px-4 py-6 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`${year} summary`}
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="relative w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto memory-scroll rounded-2xl border border-parchment/15 bg-[#070504] shadow-2xl shadow-black/70 px-5 py-6 sm:px-8 sm:py-8"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close year summary"
              className="absolute right-3 top-3 h-11 w-11 rounded-full border border-parchment/15 bg-parchment/[0.03] text-parchment/75 hover:text-parchment hover:border-parchment/40 transition touch-target"
            >
              x
            </button>
            <p className="text-[10px] tracking-[0.34em] uppercase text-mist/50 mb-4">year note</p>
            <h2 className="serif text-5xl sm:text-7xl leading-none text-parchment mb-6">{year}</h2>
            <p className="serif italic text-xl sm:text-3xl leading-snug text-parchment/95 text-balance">
              &ldquo;{summary.line}&rdquo;
            </p>
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <YearSummaryStat
                label="memories"
                value={summary.isEmpty ? "quiet" : summary.momentCount.toLocaleString()}
              />
              <YearSummaryStat
                label="messages"
                value={summary.messageCount == null ? "-" : summary.messageCount.toLocaleString()}
              />
              <YearSummaryStat
                label="texture"
                value={summary.dominantMood ? moodLabel(summary.dominantMood) : "quiet"}
              />
            </div>
            {summary.loudestMonth && (
              <p className="mt-6 text-xs tracking-[0.22em] uppercase text-mist/55">
                loudest month · {summary.loudestMonth}
              </p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function YearSummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-parchment/10 bg-[#110d0c] px-4 py-4">
      <p className="text-[10px] tracking-[0.26em] uppercase text-mist/45 mb-2">{label}</p>
      <p className="serif text-2xl text-parchment overflow-wrap-anywhere">{value}</p>
    </div>
  );
}

function moodLabel(mood: string): string {
  if (mood === "mundane_sacred") return "ordinary";
  if (mood === "forgotten") return "quiet";
  return mood;
}

function OpeningJourney({
  walk,
  media,
  statusLines,
  musicOn,
  onMusic,
}: {
  walk: Walk;
  media: MediaItem[];
  statusLines: string[];
  musicOn: boolean;
  onMusic: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [phase, setPhase] = useState(0);
  const [tick, setTick] = useState(0);
  const patterns = walk.private_dictionary?.patterns ?? [];
  const hasPatterns = patterns.length > 0;
  const hasStars = walk.moments.length > 0;
  const minPhaseBeforeExit = hasPatterns ? 3 : 2;

  useEffect(() => {
    const phaseTimer = setInterval(() => setPhase((n) => n + 1), 6800);
    const tickTimer = setInterval(() => setTick((n) => n + 1), 2400);
    return () => {
      clearInterval(phaseTimer);
      clearInterval(tickTimer);
    };
  }, []);

  useEffect(() => {
    if (!hasStars || phase < minPhaseBeforeExit) return;
    const t = setTimeout(() => setDismissed(true), 2200);
    return () => clearTimeout(t);
  }, [hasStars, minPhaseBeforeExit, phase]);

  const chatCards = useMemo(() => collectJourneyMessages(walk), [walk]);
  const visiblePatterns = useMemo(() => {
    if (patterns.length === 0) return [];
    const count = Math.min(3, patterns.length);
    return Array.from({ length: count }, (_, i) => patterns[(tick + i) % patterns.length]);
  }, [patterns, tick]);
  const visibleMedia = useMemo(() => {
    if (media.length === 0) return [];
    const count = Math.min(3, media.length);
    return Array.from({ length: count }, (_, i) => media[(tick + i) % media.length]);
  }, [media, tick]);

  if (dismissed) return null;

  const stage =
    phase === 0
      ? "opening"
      : phase === 1
        ? "map"
        : hasPatterns && phase === 2
          ? "dictionary"
          : hasStars
            ? "ready"
            : "forming";

  return (
    <motion.div
      className="absolute inset-0 z-40 flex items-center justify-center bg-[#070504] px-5 sm:px-6 pointer-events-none overflow-hidden"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.6, ease: "easeOut" }}
    >
      <div className="absolute inset-0 memory-sky opacity-70" />
      <div className="absolute inset-x-0 top-[16%] h-px bg-gradient-to-r from-transparent via-gold/20 to-transparent" />
      <div className="absolute inset-x-0 bottom-[18%] h-px bg-gradient-to-r from-transparent via-rose/15 to-transparent" />
      <button
        type="button"
        onClick={onMusic}
        aria-label={musicOn ? "Mute music" : "Play music"}
        className="pointer-events-auto absolute right-5 top-5 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-parchment/15 bg-ink/50 p-0 text-parchment/72 shadow-lg shadow-black/20 backdrop-blur-md transition hover:border-parchment/35 hover:text-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-parchment/45"
      >
        <AudioToggleIcon muted={!musicOn} />
      </button>

      <div className="relative z-10 w-full max-w-5xl max-h-[calc(100dvh-2rem)]">
        <AnimatePresence mode="wait">
          {stage === "opening" && (
            <JourneyPanel key="opening" eyebrow="this is the story of">
              <p className="serif text-5xl sm:text-6xl md:text-7xl leading-none text-balance">
                {walk.opening.duration_human}
              </p>
              <p className="serif text-base sm:text-xl md:text-2xl text-mist mt-4 text-balance overflow-wrap-anywhere">
                {walk.opening.message_count.toLocaleString()} messages between {walk.opening.user_name} & {walk.opening.other_name}
              </p>
              <p className="serif italic text-lg sm:text-2xl text-parchment/90 mt-10 text-balance max-w-3xl mx-auto">
                &ldquo;{walk.opening.line}&rdquo;
              </p>
            </JourneyPanel>
          )}

          {stage === "map" && (
            <JourneyPanel key="map" eyebrow="the first map is ready">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                <JourneyStat label="years" value={walk.opening.duration_human} />
                <JourneyStat label="messages" value={walk.opening.message_count.toLocaleString()} />
                <JourneyStat label="chapters" value={String(Math.max(1, walk.chapters.length))} />
              </div>
              <p className="serif italic text-xl sm:text-2xl text-parchment/90 mt-9 text-balance max-w-2xl mx-auto">
                Every star will open into a full exchange. The same story is also waiting in Reader Mode.
              </p>
            </JourneyPanel>
          )}

          {stage === "dictionary" && (
            <JourneyPanel key="dictionary" eyebrow="the private dictionary is surfacing">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                {visiblePatterns.map((pattern, index) => (
                  <DictionaryPreview key={`${pattern.kind}-${pattern.phrase}`} pattern={pattern} index={index} />
                ))}
              </div>
              <p className="serif italic text-xl sm:text-2xl text-parchment/90 mt-9 text-balance max-w-2xl mx-auto">
                These words will stay collected in Private Dictionary.
              </p>
            </JourneyPanel>
          )}

          {stage === "forming" && (
            <JourneyPanel key="forming" eyebrow="the stars are still forming">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_1.1fr] gap-5 items-center">
                <MediaPreview media={visibleMedia} />
                <ChatPreview cards={chatCards} tick={tick} fallbackLines={statusLines.length > 0 ? statusLines : [walk.opening.line]} />
              </div>
              <p className="text-[10px] tracking-[0.35em] uppercase text-mist/45 mt-9">
                building the constellation
              </p>
            </JourneyPanel>
          )}

          {stage === "ready" && (
            <JourneyPanel key="ready" eyebrow="the constellation is ready">
              <p className="serif italic text-3xl sm:text-5xl text-balance">
                The stars have arrived.
              </p>
              <p className="text-[10px] tracking-[0.35em] uppercase text-mist/45 mt-9">
                entering the universe
              </p>
            </JourneyPanel>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function JourneyPanel({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18, filter: "blur(10px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -16, filter: "blur(10px)" }}
      transition={{ duration: 1.0, ease: "easeOut" }}
      className="text-center max-h-[calc(100dvh-2rem)] overflow-hidden"
    >
      <p className="text-[10px] sm:text-xs tracking-[0.32em] sm:tracking-[0.35em] text-mist/55 uppercase mb-6 sm:mb-10">
        {eyebrow}
      </p>
      {children}
    </motion.div>
  );
}

function JourneyStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-parchment/12 bg-parchment/[0.035] px-3 py-3.5 sm:px-4 sm:py-5 backdrop-blur-md">
      <p className="text-[9px] sm:text-[10px] tracking-[0.26em] sm:tracking-[0.3em] uppercase text-mist/45 mb-2 sm:mb-3">{label}</p>
      <p className="serif text-xl sm:text-3xl text-parchment text-balance overflow-wrap-anywhere">{value}</p>
    </div>
  );
}

function DictionaryPreview({ pattern, index }: { pattern: Pattern; index: number }) {
  const kind = pattern.kind.replace("_", " ");
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.7 }}
      className={`rounded-lg border border-gold/18 bg-[#0d0a09]/72 px-4 py-4 sm:py-5 text-left backdrop-blur-md ${
        index > 1 ? "hidden sm:block" : ""
      }`}
    >
      <p className="text-[9px] sm:text-[10px] tracking-[0.26em] sm:tracking-[0.28em] uppercase text-gold/65 mb-3 sm:mb-4">{kind}</p>
      <p className="serif italic text-xl sm:text-2xl text-parchment overflow-wrap-anywhere">&ldquo;{pattern.phrase}&rdquo;</p>
      <p className="text-xs text-mist/65 mt-2 sm:mt-3 leading-relaxed text-balance line-clamp-2 sm:line-clamp-none">{pattern.meaning_hint}</p>
      <p className="text-[10px] tracking-[0.24em] uppercase text-mist/40 mt-5">
        {pattern.frequency} mentions
      </p>
    </motion.div>
  );
}

function MediaPreview({ media }: { media: MediaItem[] }) {
  if (media.length === 0) {
    return (
      <div className="min-h-[8.5rem] sm:min-h-[13rem] rounded-lg border border-parchment/10 bg-parchment/[0.03] flex items-center justify-center px-6 sm:px-8">
        <p className="serif italic text-lg sm:text-xl text-mist/75 text-balance">
          The photo trail is being checked in the background.
        </p>
      </div>
    );
  }
  return (
    <div className="relative min-h-[10.5rem] sm:min-h-[18rem]">
      {media.map((item, index) => (
        <motion.div
          key={item.url}
          initial={{ opacity: 0, y: 24, rotate: -4 + index * 4, scale: 0.9 }}
          animate={{ opacity: 0.95 - index * 0.18, y: index * 12, x: (index - 1) * 24, rotate: -5 + index * 5, scale: 1 - index * 0.04 }}
          exit={{ opacity: 0, y: -20, scale: 0.9 }}
          transition={{ duration: 0.9, ease: "easeOut" }}
          className="absolute left-1/2 top-0 h-36 w-28 sm:h-56 sm:w-44 -translate-x-1/2 rounded-md bg-[#f3eadb] p-1.5 sm:p-2 shadow-2xl shadow-black/60"
          style={{ zIndex: media.length - index }}
        >
          <img src={item.url} alt="" className="h-[82%] w-full rounded-sm object-cover" />
          <div className="mt-1.5 sm:mt-2 h-1.5 sm:h-2 w-14 sm:w-20 rounded-full bg-ink/10 mx-auto" />
        </motion.div>
      ))}
    </div>
  );
}

function ChatPreview({
  cards,
  tick,
  fallbackLines,
}: {
  cards: Array<{ date: string; messages: Message[]; line: string }>;
  tick: number;
  fallbackLines: string[];
}) {
  const card = cards.length > 0 ? cards[tick % cards.length] : null;
  const fallback = fallbackLines[tick % fallbackLines.length] ?? "";
  return (
    <div className="rounded-lg border border-parchment/12 bg-[#0d0a09]/74 px-4 py-4 sm:px-6 sm:py-6 text-left backdrop-blur-md">
      <p className="text-[9px] sm:text-[10px] tracking-[0.26em] sm:tracking-[0.3em] uppercase text-mist/45 mb-3 sm:mb-5">
        {card?.date ? formatJourneyDate(card.date) : "from the chat"}
      </p>
      <AnimatePresence mode="wait">
        <motion.div
          key={card?.date ?? fallback}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.7 }}
          className="space-y-3"
        >
          {card ? (
            <>
              <p className="serif italic text-lg sm:text-2xl text-parchment text-balance mb-3 sm:mb-5 line-clamp-3 sm:line-clamp-none">
                &ldquo;{card.line}&rdquo;
              </p>
              {card.messages.slice(0, 3).map((message, index) => (
                <div
                  key={`${message.ts}-${index}`}
                  className={`rounded-lg border border-parchment/10 bg-parchment/[0.035] px-3 py-2 sm:py-2.5 ${
                    index > 1 ? "hidden sm:block" : ""
                  }`}
                >
                  <p className="text-[10px] tracking-[0.22em] uppercase text-gold/55 mb-1 truncate">{message.sender}</p>
                  <p className="text-sm text-mist/80 leading-relaxed line-clamp-2 overflow-wrap-anywhere">{message.text}</p>
                </div>
              ))}
            </>
          ) : (
            <p className="serif italic text-2xl text-parchment text-balance">&ldquo;{fallback}&rdquo;</p>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function collectJourneyMessages(walk: Walk): Array<{ date: string; messages: Message[]; line: string }> {
  const fromTimeline = walk.timeline
    .filter((item) => (item.messages?.length ?? 0) > 0)
    .map((item) => ({
      date: item.date,
      messages: item.messages ?? [],
      line: item.ai_summary || item.label,
    }));
  const fromMoments = walk.moments
    .filter((moment) => moment.messages.length > 0)
    .map((moment) => ({
      date: moment.date,
      messages: moment.messages,
      line: moment.ai_summary,
    }));
  return [...fromTimeline, ...fromMoments].slice(0, 8);
}

function formatJourneyDate(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
