"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import type { ProcessingStatus } from "@/lib/types";
import BrandMark from "@/components/BrandMark";
import { getMusic } from "@/lib/music";
import { AudioToggleIcon } from "@/components/AudioToggleIcon";

interface MediaItem { url: string; ts: string | null; filename: string }

const STAGE_LINES: Record<string, string[]> = {
  parsing: [
    "Opening the export…",
    "Finding the first messages…",
    "Separating the chat from the noise…",
  ],
  segmenting: [
    "Finding where one memory ends and another begins…",
    "Grouping the conversations that belong together…",
    "Letting the shape of the years come through…",
  ],
  scouting: [
    "Looking for the moments with a pulse…",
    "Skipping the ordinary noise, keeping the ordinary magic…",
    "Finding the messages that still carry weight…",
  ],
  patterns: [
    "Listening for private words and old rituals…",
    "Finding the phrases only the two of you would understand…",
    "Collecting the little callbacks hidden in the chat…",
  ],
  arc: [
    "Drawing the chapters of the relationship…",
    "Finding the bends in the story…",
    "Arranging the years into a walkable path…",
  ],
  awaiting_relationship: [
    "Waiting at the doorway…",
    "Keeping the first map warm…",
    "Ready when you are…",
  ],
  curating: [
    "Choosing the memories that deserve a star…",
    "Comparing the years without flattening them…",
    "Keeping the moments that still feel alive…",
    "Building the constellation…",
  ],
  narrating: [
    "Writing the captions with care…",
    "Giving each memory a quiet opening line…",
    "Polishing the last few stars…",
    "Preparing the walk…",
  ],
  done: [
    "Opening the universe…",
    "The walk is ready…",
  ],
};

function uniqueMedia(items: MediaItem[]): MediaItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

export default function ProcessingPage() {
  const params = useParams<{ sessionId: string }>();
  const router = useRouter();
  const sessionId = params.sessionId;
  const [status, setStatus] = useState<ProcessingStatus | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [whisperIdx, setWhisperIdx] = useState(0);
  const [polaroidIdx, setPolaroidIdx] = useState(0);
  const [copyTick, setCopyTick] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [ready, setReady] = useState(false);
  const [visualProgress, setVisualProgress] = useState(0);
  const [departing, setDeparting] = useState(false);
  const [musicOn, setMusicOn] = useState(true);
  const vignetteCountRef = useRef(0);
  const displayMedia = useMemo(() => uniqueMedia(media), [media]);

  useEffect(() => {
    sessionStorage.setItem("dc_music_on", musicOn ? "1" : "0");
    getMusic().setMuted(!musicOn, 1200);
    if (musicOn) getMusic().crossfadeTo("loading", 1800);
  }, [musicOn]);

  function toggleMusic() {
    const next = !musicOn;
    setMusicOn(next);
    sessionStorage.setItem("dc_music_on", next ? "1" : "0");
    getMusic().setMuted(!next, 1200);
    if (next) getMusic().crossfadeTo("loading", 1800);
  }

  // Poll status
  useEffect(() => {
    let stop = false;
    async function tick() {
      try {
        const res = await fetch(`/api/status/${sessionId}`);
        if (res.ok) {
          const s: ProcessingStatus = await res.json();
          if (!stop) setStatus(s);
          if (s.partial_ready) { setReady(true); return; }
          if (s.stage === "error") return;
        }
      } catch {}
      if (!stop) setTimeout(tick, 1200);
    }
    tick();
    return () => { stop = true; };
  }, [sessionId]);

  // Fetch media while the loading screen is visible. Media extraction happens
  // in the background, so the manifest can grow after the first response.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function fetchOnce() {
      try {
        const r = await fetch(`/api/media/${sessionId}`);
        if (r.ok) {
          const d: { media: MediaItem[] } = await r.json();
          if (!cancelled) setMedia(d.media ?? []);
        }
      } catch {}
      if (!cancelled && !departing) timer = setTimeout(fetchOnce, 2500);
    }
    fetchOnce();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [departing, sessionId]);

  // Whisper advance — rotate through real chat-derived lines slowly enough
  // that each one can actually be read.
  useEffect(() => {
    if (!status?.vignettes?.length) return;
    vignetteCountRef.current = status.vignettes.length;
    setWhisperIdx((i) => Math.min(i, status.vignettes.length - 1));
  }, [status?.vignettes?.length]);

  // Keep elapsed time honest even when copy is intentionally slower.
  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Copy cadence. The media carousel can move faster; text needs a longer
  // hold so the ritual feels composed instead of twitchy.
  useEffect(() => {
    const t = setInterval(() => {
      setCopyTick((n) => n + 1);
      setWhisperIdx((i) => {
        const count = vignetteCountRef.current;
        if (count === 0) return 0;
        return Math.min(i + 1, count - 1);
      });
    }, 6800);
    return () => clearInterval(t);
  }, []);

  // Polaroid carousel: advance through the unique media set.
  useEffect(() => {
    if (displayMedia.length < 2) return;
    const t = setInterval(() => setPolaroidIdx((i) => (i + 1) % displayMedia.length), 2600);
    return () => clearInterval(t);
  }, [displayMedia.length]);

  // Smooth the visible progress independently from backend updates. When the
  // walk is ready to enter, fill the bar completely before the portal opens.
  useEffect(() => {
    const target = ready ? 1 : Math.max(visualProgress, status?.progress ?? 0);
    setVisualProgress(Math.min(1, target));
  }, [ready, status?.progress, visualProgress]);

  // Once ready, let the progress bar visibly finish, then hold a beat for the
  // depart animation before transitioning to the walk bridge.
  // `departing` is intentionally NOT in the dep array — including it causes
  // the cleanup to cancel the navigation timeout the moment we set it.
  useEffect(() => {
    if (!ready) return;
    const departTimer = setTimeout(() => setDeparting(true), 1500);
    const navTimer = setTimeout(() => router.push(`/walk/${sessionId}`), 3100);
    return () => {
      clearTimeout(departTimer);
      clearTimeout(navTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sessionId]);

  const stage = status?.stage ?? "parsing";
  const fallbackLines = STAGE_LINES[stage] ?? STAGE_LINES.parsing;
  const fallbackLine = fallbackLines[copyTick % fallbackLines.length];
  const latestVignette = status?.vignettes?.[whisperIdx];
  const showFallback = !latestVignette || copyTick % 2 === 0;
  const line = ready ? "Opening the universe…" : showFallback ? fallbackLine : latestVignette;
  const isError = status?.stage === "error";
  const stagePct = Math.round(visualProgress * 100);

  return (
    <main className="fixed inset-0 bg-[#070504] text-parchment overflow-hidden">
      {/* Backdrop nebula */}
      <div className="absolute inset-0 pointer-events-none memory-sky" />
      <Starfield />

      <div className="header-fade" aria-hidden />
      <div className="absolute left-3 sm:left-5 top-3 sm:top-5 z-30 pad-safe-top">
        <BrandMark compact />
      </div>
      <button
        type="button"
        onClick={toggleMusic}
        aria-label={musicOn ? "Mute music" : "Play music"}
        className="absolute right-3 sm:right-5 top-3 sm:top-5 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-parchment/15 bg-ink/50 p-0 text-parchment/72 shadow-lg shadow-black/20 backdrop-blur-md transition hover:border-parchment/35 hover:text-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-parchment/45 touch-target"
      >
        <AudioToggleIcon muted={!musicOn} />
      </button>

      {/* Slowly-forming constellation in the center */}
      <ConstellationFormation progress={status?.progress ?? 0} />

      {/* Polaroids developing in the corners */}
      <PolaroidCarousel media={displayMedia} index={polaroidIdx} />

      {/* Wormhole depart overlay */}
      <AnimatePresence>
        {departing && (
          <motion.div
            className="absolute inset-0 z-30 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="absolute inset-0 bg-radial-portal"
              initial={{ scale: 0.1, opacity: 0 }}
              animate={{ scale: 8, opacity: 1 }}
              transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Center card — sits in the upper-middle on phones so it never collides
          with the bottom polaroid carousel. */}
      <div className="absolute inset-0 z-20 flex items-center sm:items-center justify-center px-5 sm:px-6 pt-[18dvh] sm:pt-0 pb-[28dvh] sm:pb-0">
        <div className="relative z-10 w-full max-w-xl text-center">
          {isError ? (
            <>
              <p className="serif text-2xl text-rose mb-4">Something went wrong.</p>
              <p className="text-mist text-sm">{status?.error}</p>
              <button
                onClick={() => router.push("/upload")}
                className="mt-10 serif italic px-8 py-3 border border-parchment/40 rounded-full hover:bg-parchment hover:text-ink transition-colors"
              >
                Try again
              </button>
            </>
          ) : (
            <>
              <AnimatePresence mode="wait">
                <motion.p
                  key={line + whisperIdx}
                  initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
                  transition={{ duration: 1.1, ease: "easeOut" }}
                  className="serif italic display-md text-balance leading-snug px-2 overflow-wrap-anywhere"
                >
                  {line}
                </motion.p>
              </AnimatePresence>

              <div className="mt-10 sm:mt-16 mx-auto w-full max-w-xs">
                <div className="h-px bg-mist/20 relative overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${stagePct}%` }}
                    transition={{ duration: 1.0 }}
                    className="absolute top-0 left-0 h-px bg-parchment"
                  />
                </div>
                <p className="text-mist/40 text-xs tracking-[0.25em] uppercase mt-4">
                  {ready ? "entering the universe" : `${stage} · ${elapsed}s`}
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      <style jsx>{`
        .bg-radial-portal {
          background: radial-gradient(circle at center,
            #f3eadb 0%,
            #c9a961 10%,
            #c77b6a 22%,
            #3b1f38 38%,
            transparent 60%);
        }
      `}</style>
    </main>
  );
}

function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    let raf = 0;
    const stars: Array<{ x: number; y: number; r: number; a: number; sp: number }> = [];
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c!.width = window.innerWidth * dpr;
      c!.height = window.innerHeight * dpr;
      c!.style.width = window.innerWidth + "px";
      c!.style.height = window.innerHeight + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars.length = 0;
      const n = Math.floor((window.innerWidth * window.innerHeight) / 5500);
      for (let i = 0; i < n; i++) {
        stars.push({
          x: Math.random() * window.innerWidth,
          y: Math.random() * window.innerHeight,
          r: Math.random() * 1.3 + 0.2,
          a: Math.random() * 0.6 + 0.2,
          sp: 0.3 + Math.random() * 0.9,
        });
      }
    }
    let t = 0;
    function tick() {
      t += 0.016;
      ctx!.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const s of stars) {
        const tw = 0.5 + 0.5 * Math.sin(t * s.sp + s.x * 0.01);
        ctx!.globalAlpha = s.a * tw;
        ctx!.fillStyle = "#f1ead8";
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    }
    resize();
    tick();
    window.addEventListener("resize", resize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={ref} className="absolute inset-0 pointer-events-none" />;
}

function ConstellationFormation({ progress }: { progress: number }) {
  const dotCount = 26;
  const visible = Math.max(2, Math.floor(progress * dotCount));
  const dots = Array.from({ length: dotCount }, (_, i) => {
    const angle = i * 137.508 * Math.PI / 180;
    const r = 60 + Math.sqrt(i / dotCount) * 180;
    return { x: 50 + Math.cos(angle) * r * 0.18, y: 50 + Math.sin(angle) * r * 0.18 * 0.7, i };
  });
  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
      <div className="relative h-[440px] w-[440px] max-w-[80vw] max-h-[60vh] opacity-80">
        {dots.map((d) => (
          <motion.span
            key={d.i}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: d.i < visible ? 0.85 : 0, scale: d.i < visible ? 1 : 0 }}
            transition={{ duration: 1.4, delay: d.i * 0.04 }}
            className="absolute rounded-full bg-parchment"
            style={{
              left: `${d.x}%`,
              top: `${d.y}%`,
              width: 6,
              height: 6,
              boxShadow: "0 0 18px rgba(241,234,216,0.55)",
              transform: "translate(-50%, -50%)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function PolaroidCarousel({ media, index }: { media: MediaItem[]; index: number }) {
  // Always render the slot so the bottom region keeps a stable height — when
  // photos finish extracting mid-load, the page doesn't jump.
  const count = media.length > 0 ? Math.min(4, media.length) : 0;
  const cards = Array.from({ length: count }, (_, slot) => media[(index + slot) % media.length]);
  return (
    <div className="absolute inset-x-0 bottom-4 sm:bottom-10 z-10 pointer-events-none flex justify-center pad-safe-bottom">
      <div className="relative h-[150px] w-[130px] sm:h-[220px] sm:w-[180px]">
        <AnimatePresence mode="popLayout">
          {cards.map((m, i) => {
            const centered = i - (count - 1) / 2;
            const active = i === 0;
            return (
              <motion.div
                key={m.url}
                initial={{ opacity: 0, scale: 0.78, y: 24, rotate: centered * 8, filter: "blur(14px)" }}
                animate={{
                  opacity: active ? 0.95 : 0.52 - i * 0.05,
                  scale: active ? 1.04 : 0.92 - i * 0.04,
                  x: centered * 34,
                  y: Math.abs(centered) * 10 + i * 5,
                  rotate: centered * 8,
                  filter: "blur(0px)",
                  zIndex: count - i,
                }}
                exit={{ opacity: 0, scale: 0.82, y: -28, filter: "blur(12px)" }}
                transition={{ duration: 0.95, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0"
              >
                <div className="h-full w-full rounded-md bg-[#f3eadb] p-2 shadow-2xl shadow-black/60">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.url} alt="" className="h-[80%] w-full object-cover rounded-sm" />
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
