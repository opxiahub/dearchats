"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Html, Stars, Sparkles } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import type { Chapter, MomentOut, Walk } from "@/lib/types";
import { MOOD_TONE } from "./moodTone";

interface UniverseProps {
  walk: Walk;
  media: Array<{ url: string; ts: string | null; filename: string; has_person?: boolean | null; kind?: string | null }>;
  onOpenMoment: (id: string) => void;
  onOpenImage: (url: string) => void;
  onOpenMonthPhotos: (month: number, photos: Array<{ url: string; ts: string | null; filename: string }>) => void;
  onOpenYearSummary: () => void;
  onOpenStorySummary: () => void;
  zoomSignal?: number;
  activeMomentId: string | null;
  finale: boolean;
  musicOn: boolean;
  viewMode: "all" | "year";
  selectedYear: number | null;
  onZoomedChange?: (zoomed: boolean) => void;
}

interface PlacedMoment {
  moment: MomentOut;
  pos: [number, number, number];
  color: THREE.Color;
  size: number;
  index: number;
  // Year-view extras:
  isEmptyMonth?: boolean;
  monthLabel?: string;
  monthQuietLine?: string;
}

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const EMPTY_MONTH_LINES = [
  "{m} went quiet.",
  "Nothing landed in {m}.",
  "{m} passed without a stop.",
  "{m} drifted by.",
  "No mark was left in {m}.",
];

const MIN_ZOOM_SCALE = 0.36;
const MAX_ZOOM_SCALE = 1.75;

/**
 * Spiral-galaxy layout: all moments live in a single flat-ish disk so the
 * camera can see the whole constellation at once. Moments are placed along a
 * golden-angle spiral, ordered chronologically (radius grows with time).
 * Chapters get a floating label at the average angle/radius of their moments.
 */
function layoutMoments(moments: MomentOut[], chapters: Chapter[]): {
  placed: PlacedMoment[];
} {
  void chapters;
  if (moments.length === 0) return { placed: [] };

  const sorted = [...moments].sort((a, b) => a.date.localeCompare(b.date));
  const n = sorted.length;
  const golden = Math.PI * (3 - Math.sqrt(5)); // 137.5°
  const maxRadius = 9;

  const placed: PlacedMoment[] = sorted.map((m, i) => {
    const t = i / Math.max(1, n - 1);
    const r = 2.4 + Math.sqrt(t) * maxRadius;
    const angle = i * golden;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    // Slight z dither for parallax, not a real time-axis
    const z = (Math.sin(i * 0.91) + Math.cos(i * 1.37)) * 0.8;
    const tone = MOOD_TONE[m.mood];
    const color = new THREE.Color(tone.color);
    const important =
      m.signatures.includes("first_or_last") ||
      m.signatures.includes("the_shift") ||
      m.signatures.includes("conflict_and_repair");
    const size = important ? 0.36 : m.mood === "forgotten" ? 0.22 : 0.27;
    return { moment: m, pos: [x, y, z], color, size, index: i };
  });

  return { placed };
}

interface YearStats {
  totalMoments: number;
  dominantMood: string | null;
  loudestMonth: string | null;
  isQuietYear: boolean;
}

/**
 * Year view: a smaller version of the main universe. Each month gets one
 * clearly labeled star, placed in a golden-angle constellation so the view
 * still feels like the ALL galaxy instead of a separate timeline widget.
 */
function layoutYear(
  moments: MomentOut[],
  year: number,
  firstDate: string,
  lastDate: string,
): { placed: PlacedMoment[]; yearLabel: string; stats: YearStats } {
  const firstYear = Number(firstDate.slice(0, 4));
  const firstMonth = Number(firstDate.slice(5, 7));
  const lastYear = Number(lastDate.slice(0, 4));
  const lastMonth = Number(lastDate.slice(5, 7));

  // Aggregate stats for the floating year card.
  const yearMoments = moments.filter((m) => m.date.startsWith(String(year)));
  const moodCounts = new Map<string, number>();
  const monthCounts = new Map<number, number>();
  for (const m of yearMoments) {
    moodCounts.set(m.mood, (moodCounts.get(m.mood) ?? 0) + 1);
    const mo = Number(m.date.slice(5, 7));
    monthCounts.set(mo, (monthCounts.get(mo) ?? 0) + 1);
  }
  const dominantMood = [...moodCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const loudestMonthNum = [...monthCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const stats: YearStats = {
    totalMoments: yearMoments.length,
    dominantMood,
    loudestMonth: loudestMonthNum ? MONTH_NAMES[loudestMonthNum - 1] : null,
    isQuietYear: yearMoments.length === 0,
  };

  const placed: PlacedMoment[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const maxRadius = 5.8;

  for (let m = 1; m <= 12; m++) {
    const inChatRange =
      year >= firstYear &&
      year <= lastYear &&
      !(year === firstYear && m < firstMonth) &&
      !(year === lastYear && m > lastMonth);

    const t = (m - 1) / 11;
    const r = 1.7 + Math.sqrt(t) * maxRadius;
    const angle = (m - 1) * golden;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r - 0.25;
    const z = (Math.sin(m * 0.91) + Math.cos(m * 1.37)) * 0.55;

    const monthKey = `${year}-${String(m).padStart(2, "0")}`;
    const inMonth = inChatRange ? moments.filter((mo) => mo.date.startsWith(monthKey)) : [];
    if (inMonth.length === 0) {
      const tpl = EMPTY_MONTH_LINES[(m + year) % EMPTY_MONTH_LINES.length];
      placed.push({
        moment: {
          id: `__empty_${monthKey}`,
          chapter_id: "now",
          date: `${monthKey}-15`,
          mood: "mundane_sacred",
          ai_summary: tpl.replace("{m}", MONTH_NAMES[m - 1]),
          signatures: [],
          messages: [],
        } as MomentOut,
        pos: [x, y, z],
        color: new THREE.Color("#5a5147"),
        size: 0.16,
        index: m - 1,
        isEmptyMonth: true,
        monthLabel: MONTH_SHORT[m - 1],
        monthQuietLine: tpl.replace("{m}", MONTH_NAMES[m - 1]),
      });
    } else {
      const pick = [...inMonth].sort((a, b) => {
        const aw =
          (a.signatures.includes("the_shift") ? 3 : 0) +
          (a.signatures.includes("first_or_last") ? 2 : 0) +
          (a.signatures.includes("conflict_and_repair") ? 2 : 0) +
          (a.mood === "tender" ? 1 : 0);
        const bw =
          (b.signatures.includes("the_shift") ? 3 : 0) +
          (b.signatures.includes("first_or_last") ? 2 : 0) +
          (b.signatures.includes("conflict_and_repair") ? 2 : 0) +
          (b.mood === "tender" ? 1 : 0);
        return bw - aw;
      })[0];
      const tone = MOOD_TONE[pick.mood];
      const importantInMonth = inMonth.some(
        (mo) => mo.signatures.includes("the_shift") || mo.signatures.includes("first_or_last"),
      );
      placed.push({
        moment: pick,
        pos: [x, y, z],
        color: new THREE.Color(tone.color),
        size: importantInMonth ? 0.42 : 0.34,
        index: m - 1,
        monthLabel: MONTH_SHORT[m - 1],
      });
    }
  }
  return { placed, yearLabel: String(year), stats };
}

function makeGlowTexture(): THREE.Texture {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,0.7)");
  g.addColorStop(0.45, "rgba(255,255,255,0.18)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

let _glowTex: THREE.Texture | null = null;
function getGlowTexture() {
  if (!_glowTex) _glowTex = makeGlowTexture();
  return _glowTex;
}

/**
 * Per-month photo deck: a small stack of card silhouettes anchored under the
 * month's star. Thickness grows with photo count (capped at 5 visible cards).
 * Click → opens the MonthPhotosDialog with all that month's photos.
 */
function MonthDeck({
  placed,
  count,
  coverUrl,
  onOpen,
}: {
  placed: PlacedMoment;
  count: number;
  coverUrl: string | null;
  onOpen: () => void;
}) {
  if (count === 0 || !placed.monthLabel) return null;
  const [x, y, z] = placed.pos;
  return (
    <Suspense fallback={null}>
      <MonthDeckStack
        position={[x, y - 0.72, z + 0.16]}
        count={count}
        coverUrl={coverUrl}
        monthLabel={placed.monthLabel}
        onOpen={onOpen}
      />
    </Suspense>
  );
}

function MonthDeckStack({
  position,
  count,
  coverUrl,
  monthLabel,
  onOpen,
}: {
  position: [number, number, number];
  count: number;
  coverUrl: string | null;
  monthLabel: string;
  onOpen: () => void;
}) {
  const texture = coverUrl ? useLoader(THREE.TextureLoader, coverUrl) : null;
  useEffect(() => {
    if (!texture) return;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
  }, [texture]);
  const visibleCards = Math.min(5, count);
  const hover = useRef(false);
  const ref = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!ref.current) return;
    const target = hover.current ? 1.12 : 1;
    const next = ref.current.scale.x + (target - ref.current.scale.x) * 0.14;
    ref.current.scale.setScalar(next);
  });

  return (
    <group
      ref={ref}
      position={position}
      onPointerEnter={(e) => { e.stopPropagation(); hover.current = true; document.body.style.cursor = "pointer"; }}
      onPointerLeave={() => { hover.current = false; document.body.style.cursor = "auto"; }}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
    >
      {Array.from({ length: visibleCards }).map((_, i) => {
        const centered = i - (visibleCards - 1) / 2;
        const isTop = i === visibleCards - 1;
        return (
          <group
            key={i}
            position={[centered * 0.018, -i * 0.012, i * 0.014]}
            rotation={[0, 0, centered * 0.09]}
          >
            <mesh>
              <planeGeometry args={[0.48, 0.62]} />
              <meshStandardMaterial color="#f3eadb" roughness={0.92} />
            </mesh>
            {isTop && texture && (
              <mesh position={[0, 0.055, 0.012]}>
                <planeGeometry args={[0.39, 0.41]} />
                <meshBasicMaterial map={texture} toneMapped={false} />
              </mesh>
            )}
            {isTop && (
              <mesh position={[0, -0.22, 0.013]}>
                <planeGeometry args={[0.22, 0.025]} />
                <meshBasicMaterial color="#d8ccba" transparent opacity={0.55} />
              </mesh>
            )}
          </group>
        );
      })}
      {/* Invisible hit area so the small 3D deck remains easy to tap/click. */}
      <mesh position={[0, 0, 0.09]}>
        <planeGeometry args={[0.82, 0.86]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Html
        position={[0, -0.54, 0.12]}
        center
        distanceFactor={12}
        style={{ pointerEvents: "none", userSelect: "none" }}
        zIndexRange={[20, 0]}
      >
        <span className="text-[10px] tracking-[0.22em] uppercase text-mist/75 whitespace-nowrap drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
          {count} {count === 1 ? "pic" : "pics"}
        </span>
      </Html>
    </group>
  );
}

function MonthLabel({ placed }: { placed: PlacedMoment }) {
  if (!placed.monthLabel) return null;
  const [x, y, z] = placed.pos;
  const mag = Math.hypot(x, y) || 1;
  const out = 0.72;
  const lx = x + (x / mag) * out;
  const ly = y + (y / mag) * out;
  return (
    <Html
      position={[lx, ly, z]}
      center
      distanceFactor={11}
      style={{ pointerEvents: "none", userSelect: "none" }}
      zIndexRange={[10, 0]}
    >
      <div className={`serif italic text-[15px] whitespace-nowrap drop-shadow-[0_2px_10px_rgba(0,0,0,0.75)] ${placed.isEmptyMonth ? "text-mist/50" : "text-parchment/90"}`}>
        {placed.monthLabel}
      </div>
    </Html>
  );
}

function formatStarDate(iso: string): string {
  const year = iso.slice(0, 4);
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const monthName = MONTH_SHORT[month - 1] ?? "";
  return `${monthName} ${day} ${year}`;
}

function StarDateLabel({ placed }: { placed: PlacedMoment }) {
  if (placed.isEmptyMonth) return null;
  const [x, y, z] = placed.pos;
  return (
    <Html
      position={[x, y - 0.52, z]}
      center
      distanceFactor={13}
      style={{ pointerEvents: "none", userSelect: "none" }}
      zIndexRange={[9, 0]}
    >
      <div className="text-[9px] sm:text-[10px] tracking-[0.18em] uppercase text-parchment/72 whitespace-nowrap drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]">
        {formatStarDate(placed.moment.date)}
      </div>
    </Html>
  );
}

function MemoryStar({
  placed,
  active,
  pulse,
  onClick,
}: {
  placed: PlacedMoment;
  active: boolean;
  pulse: number;
  onClick: () => void;
}) {
  const coreRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Sprite>(null);
  const flareRef = useRef<THREE.Sprite>(null);
  const hover = useRef(false);
  const tex = useMemo(() => getGlowTexture(), []);
  const baseSize = placed.size;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const wobble = 1 + Math.sin(t * 1.1 + placed.index * 0.7) * 0.05;
    const activeBoost = active || hover.current ? 1.45 : 1;
    const pulseBoost = 1 + pulse * 0.7;
    if (coreRef.current) coreRef.current.scale.setScalar(baseSize * wobble * activeBoost * pulseBoost);
    if (haloRef.current) {
      const s = baseSize * 5.5 * activeBoost * pulseBoost * (1 + Math.sin(t * 0.9 + placed.index) * 0.05);
      haloRef.current.scale.set(s, s, s);
      (haloRef.current.material as THREE.SpriteMaterial).opacity = 0.55 + pulse * 0.3 + (active ? 0.15 : 0);
    }
    if (flareRef.current) {
      const s = baseSize * 11 * activeBoost * pulseBoost;
      flareRef.current.scale.set(s, s, s);
      (flareRef.current.material as THREE.SpriteMaterial).opacity = 0.22 + pulse * 0.35 + (active ? 0.1 : 0);
    }
  });

  return (
    <group
      position={placed.pos}
      onPointerEnter={(e) => { e.stopPropagation(); hover.current = true; document.body.style.cursor = "pointer"; }}
      onPointerLeave={() => { hover.current = false; document.body.style.cursor = "auto"; }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      {/* Outer soft flare */}
      <sprite ref={flareRef}>
        <spriteMaterial
          map={tex}
          color={placed.color}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={0.22}
        />
      </sprite>
      {/* Inner bright halo */}
      <sprite ref={haloRef}>
        <spriteMaterial
          map={tex}
          color={placed.color}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={0.55}
        />
      </sprite>
      {/* Core — emissive, bloom picks it up */}
      <mesh ref={coreRef}>
        <sphereGeometry args={[1, 18, 18]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive={placed.color}
          emissiveIntensity={4.5}
          roughness={0.2}
          metalness={0}
        />
      </mesh>
    </group>
  );
}

function CenterYearMarker({
  year,
  onOpen,
}: {
  year: string;
  onOpen: () => void;
}) {
  const coreRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Sprite>(null);
  const tex = useMemo(() => getGlowTexture(), []);
  const color = useMemo(() => new THREE.Color("#c9a961"), []);
  const hover = useRef(false);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const pulse = 1 + Math.sin(t * 1.05) * 0.06;
    const boost = hover.current ? 1.14 : 1;
    if (coreRef.current) coreRef.current.scale.setScalar(0.72 * pulse * boost);
    if (haloRef.current) {
      const s = 4.8 * pulse * boost;
      haloRef.current.scale.set(s, s, s);
      (haloRef.current.material as THREE.SpriteMaterial).opacity = hover.current ? 0.72 : 0.52;
    }
  });

  return (
    <group
      position={[0, 0, 1.4]}
      onPointerEnter={(e) => { e.stopPropagation(); hover.current = true; document.body.style.cursor = "pointer"; }}
      onPointerLeave={() => { hover.current = false; document.body.style.cursor = "auto"; }}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
    >
      <sprite ref={haloRef}>
        <spriteMaterial
          map={tex}
          color={color}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={0.52}
        />
      </sprite>
      <mesh ref={coreRef}>
        <sphereGeometry args={[1, 24, 24]} />
        <meshStandardMaterial
          color="#fff6df"
          emissive={color}
          emissiveIntensity={3.8}
          roughness={0.25}
        />
      </mesh>
      <Html
        position={[0, -1.05, 0.08]}
        center
        distanceFactor={9}
        style={{ pointerEvents: "none", userSelect: "none" }}
        zIndexRange={[18, 0]}
      >
        <div className="text-center">
          <div className="serif text-4xl sm:text-5xl md:text-6xl leading-none text-parchment drop-shadow-[0_2px_18px_rgba(0,0,0,0.8)]">
            {year}
          </div>
          <div className="mt-2 text-[9px] sm:text-[10px] tracking-[0.28em] uppercase text-mist/60 whitespace-nowrap drop-shadow-[0_2px_10px_rgba(0,0,0,0.75)]">
            tap for year note
          </div>
        </div>
      </Html>
    </group>
  );
}

function CenterStoryMarker({ onOpen }: { onOpen: () => void }) {
  const coreRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Sprite>(null);
  const tex = useMemo(() => getGlowTexture(), []);
  const color = useMemo(() => new THREE.Color("#c77b6a"), []);
  const hover = useRef(false);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const pulse = 1 + Math.sin(t * 0.85) * 0.05;
    const boost = hover.current ? 1.16 : 1;
    if (coreRef.current) coreRef.current.scale.setScalar(0.66 * pulse * boost);
    if (haloRef.current) {
      const s = 4.5 * pulse * boost;
      haloRef.current.scale.set(s, s, s);
      (haloRef.current.material as THREE.SpriteMaterial).opacity = hover.current ? 0.68 : 0.48;
    }
  });

  return (
    <group
      position={[0, 0, 1.35]}
      onPointerEnter={(e) => { e.stopPropagation(); hover.current = true; document.body.style.cursor = "pointer"; }}
      onPointerLeave={() => { hover.current = false; document.body.style.cursor = "auto"; }}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
    >
      <sprite ref={haloRef}>
        <spriteMaterial
          map={tex}
          color={color}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={0.48}
        />
      </sprite>
      <mesh ref={coreRef}>
        <sphereGeometry args={[1, 24, 24]} />
        <meshStandardMaterial
          color="#fff6df"
          emissive={color}
          emissiveIntensity={3.5}
          roughness={0.25}
        />
      </mesh>
      <Html
        position={[0, -1, 0.08]}
        center
        distanceFactor={10}
        style={{ pointerEvents: "none", userSelect: "none" }}
        zIndexRange={[18, 0]}
      >
        <div className="text-center">
          <div className="serif text-2xl sm:text-3xl md:text-4xl leading-none text-parchment drop-shadow-[0_2px_18px_rgba(0,0,0,0.8)] whitespace-nowrap">
            All years
          </div>
          <div className="mt-2 text-[9px] sm:text-[10px] tracking-[0.28em] uppercase text-mist/60 whitespace-nowrap drop-shadow-[0_2px_10px_rgba(0,0,0,0.75)]">
            tap for story note
          </div>
        </div>
      </Html>
    </group>
  );
}

function Polaroid({
  url,
  position,
  rotation,
  scale,
  onOpen,
}: {
  url: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  onOpen: () => void;
}) {
  const tex = useLoader(THREE.TextureLoader, url);
  const ref = useRef<THREE.Group>(null);
  const hover = useRef(false);
  useEffect(() => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
  }, [tex]);
  const seed = useMemo(() => Math.random() * 10, []);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    ref.current.position.y = position[1] + Math.sin(t * 0.35 + seed) * 0.15;
    ref.current.rotation.z = rotation[2] + Math.sin(t * 0.28 + seed) * 0.04;
    const target = hover.current ? scale * 1.08 : scale;
    const cur = ref.current.scale.x;
    const next = cur + (target - cur) * 0.15;
    ref.current.scale.setScalar(next);
  });
  const w = 1.3;
  const h = 1.6;
  return (
    <group
      ref={ref}
      position={position}
      rotation={rotation}
      scale={scale}
      onPointerEnter={(e) => { e.stopPropagation(); hover.current = true; document.body.style.cursor = "pointer"; }}
      onPointerLeave={() => { hover.current = false; document.body.style.cursor = "auto"; }}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
    >
      <mesh position={[0, -0.05, -0.02]}>
        <planeGeometry args={[w + 0.18, h + 0.32]} />
        <meshStandardMaterial color="#f3eadb" roughness={0.95} />
      </mesh>
      <mesh>
        <planeGeometry args={[w, h - 0.42]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * Pick the polaroids that *anchor* curated moments rather than the first 14
 * in the manifest. Score each photo by proximity to a curated moment's month,
 * with a bonus for "important" signatures (the_shift, first_or_last, repair).
 * Always reserve a slot for the chronologically first and last photo so the
 * visual timeline has bookends.
 */
function selectPolaroids(
  media: Array<{ url: string; ts: string | null; has_person?: boolean | null; kind?: string | null }>,
  placed: PlacedMoment[],
  limit = 14,
): Array<{ url: string; ts: string | null; score: number }> {
  if (media.length === 0) return [];

  // Prefer real photos with people. Fall back through tiers in order:
  //   1) photos with people
  //   2) anything classified as "photo" without people (e.g. landscape)
  //   3) unclassified (classification still in flight)
  //   4) screenshots / wallpapers / other (last resort)
  const tierOf = (m: { has_person?: boolean | null; kind?: string | null }): number => {
    if (m.has_person === true) return 1;
    if (m.kind === "photo") return 2;
    if (m.has_person == null && (m.kind == null)) return 3;
    return 4;
  };

  // Build a month → importance map from curated moments.
  const monthWeight = new Map<string, number>();
  for (const p of placed) {
    const key = p.moment.date.slice(0, 7);
    const important =
      p.moment.signatures.includes("first_or_last") ||
      p.moment.signatures.includes("the_shift") ||
      p.moment.signatures.includes("conflict_and_repair");
    monthWeight.set(key, (monthWeight.get(key) ?? 0) + (important ? 2 : 1));
  }
  const months = [...monthWeight.keys()].sort();

  function monthDistance(a: string, b: string): number {
    const [ay, am] = a.split("-").map(Number);
    const [by, bm] = b.split("-").map(Number);
    return Math.abs((ay - by) * 12 + (am - bm));
  }

  const scored = media.map((m) => {
    let proximityScore = 0.05;
    if (m.ts) {
      const month = m.ts.slice(0, 7);
      const direct = monthWeight.get(month) ?? 0;
      let proximity = 0;
      for (const mm of months) {
        const d = monthDistance(month, mm);
        if (d <= 2) proximity = Math.max(proximity, (monthWeight.get(mm) ?? 0) / (1 + d));
      }
      proximityScore = direct * 2 + proximity;
    }
    return { ...m, score: proximityScore, tier: tierOf(m) };
  });

  if (media.length <= limit) {
    return scored.sort((a, b) => (a.ts ?? "") < (b.ts ?? "") ? -1 : 1);
  }

  // Fill picks tier by tier so we exhaust people-photos before falling back.
  const picked = new Set<string>();
  const out: typeof scored = [];

  // Bookends: chronologically first + last photos, ideally from tier 1.
  const tier1 = scored.filter((s) => s.tier === 1 && s.ts).sort((a, b) => (a.ts! < b.ts! ? -1 : 1));
  const tsSource = tier1.length >= 2 ? tier1 : scored.filter((s) => s.ts).sort((a, b) => (a.ts! < b.ts! ? -1 : 1));
  if (tsSource[0]) { out.push(tsSource[0]); picked.add(tsSource[0].url); }
  if (tsSource[tsSource.length - 1] && !picked.has(tsSource[tsSource.length - 1].url)) {
    out.push(tsSource[tsSource.length - 1]);
    picked.add(tsSource[tsSource.length - 1].url);
  }

  for (const tier of [1, 2, 3, 4]) {
    if (out.length >= limit) break;
    const pool = scored
      .filter((s) => s.tier === tier && !picked.has(s.url))
      .sort((a, b) => b.score - a.score);
    for (const item of pool) {
      if (out.length >= limit) break;
      out.push(item);
      picked.add(item.url);
    }
  }
  return out.sort((a, b) => (a.ts ?? "") < (b.ts ?? "") ? -1 : 1);
}

function PolaroidField({
  media,
  placed,
  onOpenImage,
}: {
  media: Array<{ url: string; ts: string | null; has_person?: boolean | null; kind?: string | null }>;
  placed: PlacedMoment[];
  onOpenImage: (url: string) => void;
}) {
  const { size } = useThree();
  // Phones get smaller, fewer polaroids so the constellation breathes.
  const isNarrow = size.width < 640;
  const limit = isNarrow ? 8 : 14;
  const scaleMul = isNarrow ? 0.7 : 1.0;
  const items = useMemo(() => {
    if (placed.length === 0 || media.length === 0) return [];
    const picks = selectPolaroids(media, placed, limit);
    return picks.map((m, i) => {
      let anchor: PlacedMoment | null = null;
      if (m.ts) {
        const monthKey = m.ts.slice(0, 7);
        anchor = placed.find((p) => p.moment.date.slice(0, 7) === monthKey) ?? null;
      }
      if (!anchor) anchor = placed[Math.floor((i / Math.max(1, picks.length - 1)) * (placed.length - 1))];
      const offsetAngle = i * 0.97;
      const offsetR = 1.45 + (i % 3) * 0.55;
      const pos: [number, number, number] = [
        anchor.pos[0] + Math.cos(offsetAngle) * offsetR,
        anchor.pos[1] + Math.sin(offsetAngle) * offsetR,
        anchor.pos[2] + 1.2 + (i % 4) * 0.3,
      ];
      const rot: [number, number, number] = [0, (i % 2 === 0 ? 1 : -1) * 0.12, (Math.random() - 0.5) * 0.35];
      const scale = (0.74 + (i % 3) * 0.1) * scaleMul;
      return { ...m, pos, rot, scale };
    });
  }, [media, placed, limit, scaleMul]);

  return (
    <>
      {items.map((it) => (
        <Suspense key={it.url} fallback={null}>
          <Polaroid url={it.url} position={it.pos} rotation={it.rot} scale={it.scale} onOpen={() => onOpenImage(it.url)} />
        </Suspense>
      ))}
    </>
  );
}

/**
 * EchoField: a faint scatter of tiny specks in the same disk as the
 * constellation, one speck per ~50 messages, capped. These represent the
 * *underlying volume* of the chat — invisible most of the time, but they
 * make a 30k chat feel denser than a 3k chat without adding stars. Kept
 * well below the bloom threshold so they don't compete with curated stars.
 */
function EchoField({ messageCount }: { messageCount: number }) {
  const obj = useMemo(() => {
    const target = Math.min(1800, Math.max(80, Math.floor(messageCount / 50)));
    const positions = new Float32Array(target * 3);
    const golden = Math.PI * (3 - Math.sqrt(5));
    const maxR = 13;
    // Use a stable PRNG so the field is identical across renders.
    let s = 1337;
    const rand = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    for (let i = 0; i < target; i++) {
      // Mix golden-spiral with jitter — same general disk as the stars.
      const t = i / target;
      const baseR = Math.sqrt(t) * maxR;
      const jitter = (rand() - 0.5) * 2.4;
      const r = Math.max(0.4, baseR + jitter);
      const angle = i * golden + (rand() - 0.5) * 0.6;
      positions[i * 3 + 0] = Math.cos(angle) * r;
      positions[i * 3 + 1] = Math.sin(angle) * r;
      positions[i * 3 + 2] = (rand() - 0.5) * 1.6;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const m = new THREE.PointsMaterial({
      color: new THREE.Color("#a89e91"),
      size: 0.04,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    return new THREE.Points(g, m);
  }, [messageCount]);
  return <primitive object={obj} />;
}

function Threads({ placed }: { placed: PlacedMoment[] }) {
  const obj = useMemo(() => {
    if (placed.length < 2) return null;
    const points = placed.map((p) => new THREE.Vector3(...p.pos));
    const g = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color("#c9a961"),
      transparent: true,
      opacity: 0.22,
    });
    return new THREE.Line(g, mat);
  }, [placed]);
  if (!obj) return null;
  return <primitive object={obj} />;
}

function CameraRig({
  placed,
  finale,
  focusIndex,
  viewMode,
  zoomSignal,
  onZoomedChange,
}: {
  placed: PlacedMoment[];
  finale: boolean;
  focusIndex: number | null;
  viewMode: "all" | "year";
  zoomSignal?: number;
  onZoomedChange?: (zoomed: boolean) => void;
}) {
  const { camera, gl, size } = useThree();
  const targetPos = useRef(new THREE.Vector3(0, 2, 22));
  const targetLook = useRef(new THREE.Vector3(0, 0, 0));
  const scrollRot = useRef(0);
  const baseRot = useRef(0);
  const touchY = useRef(0);
  const touchX = useRef(0);
  const pinchDistance = useRef<number | null>(null);
  const zoomScale = useRef(1);
  const lastZoomSignal = useRef(zoomSignal ?? 0);
  const panOffset = useRef(new THREE.Vector2(0, 0));
  const panTarget = useRef(new THREE.Vector2(0, 0));
  const pointerPan = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 });

  function isZoomedIn() {
    return zoomScale.current < 0.96;
  }

  function applyPan(dx: number, dy: number, invert = false) {
    const strength = viewMode === "year" ? 0.012 : 0.016;
    const maxPan = viewMode === "year" ? 4.8 : 7.5;
    const dir = invert ? -1 : 1;
    panTarget.current.x = THREE.MathUtils.clamp(panTarget.current.x - dx * strength * dir, -maxPan, maxPan);
    panTarget.current.y = THREE.MathUtils.clamp(panTarget.current.y + dy * strength * dir, -maxPan, maxPan);
  }

  // Narrow / portrait viewports need the camera pulled back so the whole
  // constellation fits, plus a wider FOV. We re-derive this on every render —
  // useThree.size already updates on resize/orientation change.
  const aspect = size.width / Math.max(1, size.height);
  const isPortrait = aspect < 0.9;
  const isNarrow = size.width < 640;
  // Multiplier applied to the natural orbit radius. Smaller phones zoom out.
  const distScale = isPortrait ? (isNarrow ? 1.55 : 1.28) : 1.0;

  useEffect(() => {
    // FOV widens on portrait/phones so the disk doesn't get clipped at the edges.
    const fov = isPortrait ? (isNarrow ? 68 : 60) : 52;
    if (camera instanceof THREE.PerspectiveCamera && camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }, [camera, isPortrait, isNarrow]);

  useEffect(() => {
    const dom = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomScale.current = THREE.MathUtils.clamp(zoomScale.current + e.deltaY * 0.0015, MIN_ZOOM_SCALE, MAX_ZOOM_SCALE);
        return;
      }
      scrollRot.current += e.deltaY * 0.0025;
    };
    // Track touch movement: vertical swipes still accelerate the orbit (the
    // existing behaviour), but horizontal swipes also rotate, which is the
    // more natural gesture on a phone.
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        const a = e.touches[0];
        const b = e.touches[1];
        pinchDistance.current = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        return;
      }
      pinchDistance.current = null;
      touchY.current = e.touches[0]?.clientY ?? 0;
      touchX.current = e.touches[0]?.clientX ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        const a = e.touches[0];
        const b = e.touches[1];
        const nextDistance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (pinchDistance.current && nextDistance > 0) {
          const ratio = pinchDistance.current / nextDistance;
          zoomScale.current = THREE.MathUtils.clamp(zoomScale.current * ratio, MIN_ZOOM_SCALE, MAX_ZOOM_SCALE);
        }
        pinchDistance.current = nextDistance;
        return;
      }
      const cy = e.touches[0]?.clientY ?? 0;
      const cx = e.touches[0]?.clientX ?? 0;
      const dy = touchY.current - cy;
      const dx = touchX.current - cx;
      if (isZoomedIn()) {
        applyPan(dx, dy, true);
        touchY.current = cy;
        touchX.current = cx;
        return;
      }
      // Use the larger axis so a horizontal drag-to-orbit feels right.
      scrollRot.current += (Math.abs(dx) > Math.abs(dy) ? dx : dy) * 0.0035;
      touchY.current = cy;
      touchX.current = cx;
    };
    const onTouchEnd = () => {
      pinchDistance.current = null;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch" || !isZoomedIn()) return;
      pointerPan.current = { active: true, x: e.clientX, y: e.clientY };
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!pointerPan.current.active || !isZoomedIn()) return;
      const dx = pointerPan.current.x - e.clientX;
      const dy = pointerPan.current.y - e.clientY;
      applyPan(dx, dy);
      pointerPan.current = { active: true, x: e.clientX, y: e.clientY };
    };
    const onPointerUp = () => {
      pointerPan.current.active = false;
    };
    dom.addEventListener("wheel", onWheel, { passive: false });
    dom.addEventListener("touchstart", onTouchStart, { passive: true });
    dom.addEventListener("touchmove", onTouchMove, { passive: true });
    dom.addEventListener("touchend", onTouchEnd, { passive: true });
    dom.addEventListener("touchcancel", onTouchEnd, { passive: true });
    dom.addEventListener("pointerdown", onPointerDown, { passive: true });
    dom.addEventListener("pointermove", onPointerMove, { passive: true });
    dom.addEventListener("pointerup", onPointerUp, { passive: true });
    dom.addEventListener("pointerleave", onPointerUp, { passive: true });
    return () => {
      dom.removeEventListener("wheel", onWheel);
      dom.removeEventListener("touchstart", onTouchStart);
      dom.removeEventListener("touchmove", onTouchMove);
      dom.removeEventListener("touchend", onTouchEnd);
      dom.removeEventListener("touchcancel", onTouchEnd);
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("pointerleave", onPointerUp);
    };
  }, [gl, viewMode]);

  useEffect(() => {
    const nextSignal = zoomSignal ?? 0;
    const delta = nextSignal - lastZoomSignal.current;
    if (delta !== 0) {
      zoomScale.current = THREE.MathUtils.clamp(zoomScale.current - delta * 0.18, MIN_ZOOM_SCALE, MAX_ZOOM_SCALE);
      lastZoomSignal.current = nextSignal;
    }
  }, [zoomSignal]);

  const lastZoomedRef = useRef(false);
  useFrame((_, dt) => {
    // Notify the parent only when zoom state crosses the threshold so we don't
    // re-render the chrome on every frame.
    const zoomed = isZoomedIn();
    if (zoomed !== lastZoomedRef.current) {
      lastZoomedRef.current = zoomed;
      onZoomedChange?.(zoomed);
    }
    if (!zoomed) {
      panTarget.current.lerp(new THREE.Vector2(0, 0), 0.08);
    }
    panOffset.current.lerp(panTarget.current, 0.12);
    const pan = panOffset.current;
    // Overview gets a gentle galactic rotation. Year view now uses the same
    // constellation language, just slowed down so month labels stay readable.
    baseRot.current += dt * (viewMode === "year" ? 0.025 : 0.04);
    if (finale) {
      targetPos.current.set(0, 12, 30 * distScale * zoomScale.current);
      targetLook.current.set(0, 0, 0);
    } else if (focusIndex !== null && placed[focusIndex]) {
      const p = placed[focusIndex].pos;
      const dx = p[0] * 0.35;
      const dy = p[1] * 0.35;
      const focusZ = (isPortrait ? 7.5 : 5.5) * (isNarrow ? 1.15 : 1) * zoomScale.current;
      targetPos.current.set(p[0] + dx + 1.2, p[1] + dy + 0.6, p[2] + focusZ);
      targetLook.current.set(p[0], p[1], p[2]);
    } else if (viewMode === "year") {
      const rot = baseRot.current + scrollRot.current * 0.65;
      const r = 20.5 * distScale * zoomScale.current;
      targetPos.current.set(Math.sin(rot) * r, 2.2 + Math.sin(rot * 0.6) * 0.9, Math.cos(rot) * r);
      targetLook.current.set(0, -0.2, 0);
    } else {
      const rot = baseRot.current + scrollRot.current;
      const r = 23 * distScale * zoomScale.current;
      targetPos.current.set(Math.sin(rot) * r, 2.4 + Math.sin(rot * 0.6) * 1.4, Math.cos(rot) * r);
      targetLook.current.set(0, 0, 0);
    }
    targetPos.current.x += pan.x;
    targetPos.current.y += pan.y;
    targetLook.current.x += pan.x;
    targetLook.current.y += pan.y;
    camera.position.lerp(targetPos.current, 0.05);
    camera.lookAt(targetLook.current);
  });

  return null;
}

function Backdrop() {
  return (
    <>
      <color attach="background" args={["#070504"]} />
      {/* Fog kept very far so the whole constellation always reads. */}
      <fog attach="fog" args={["#070504", 38, 110]} />
      <ambientLight intensity={0.4} />
      <Stars radius={140} depth={70} count={3500} factor={3.2} fade speed={0.3} />
      <Sparkles count={120} scale={[26, 26, 8]} size={2} speed={0.25} color="#f1ead8" opacity={0.55} />
      <directionalLight position={[10, 12, 8]} intensity={0.5} color="#fff1d6" />
      <directionalLight position={[-12, -6, -4]} intensity={0.25} color="#7d6da4" />
    </>
  );
}

export default function Universe({
  walk, media, onOpenMoment, onOpenImage, onOpenMonthPhotos, onOpenYearSummary, onOpenStorySummary, activeMomentId, finale, musicOn,
  zoomSignal,
  viewMode, selectedYear,
  onZoomedChange,
}: UniverseProps) {
  const { placed, yearLabel } = useMemo(() => {
    if (viewMode === "year" && selectedYear !== null) {
      const r = layoutYear(walk.moments, selectedYear, walk.opening.first_date, walk.opening.last_date);
      return { placed: r.placed, yearLabel: r.yearLabel };
    }
    const r = layoutMoments(walk.moments, walk.chapters);
    return { placed: r.placed, yearLabel: null as string | null };
  }, [walk.moments, walk.chapters, walk.opening.first_date, walk.opening.last_date, viewMode, selectedYear]);
  const activeIdx = useMemo(() => {
    if (!activeMomentId) return null;
    const i = placed.findIndex((p) => p.moment.id === activeMomentId);
    return i >= 0 ? i : null;
  }, [activeMomentId, placed]);

  const [pulseSet, setPulseSet] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!finale) { setPulseSet(new Set()); return; }
    const forgotten = placed
      .filter((p) => p.moment.mood === "forgotten" || p.moment.signatures.includes("care_without_ceremony"))
      .sort((a, b) => a.moment.date.localeCompare(b.moment.date));
    if (forgotten.length === 0) return;
    let cancelled = false;
    const set = new Set<string>();
    let i = 0;
    const tick = () => {
      if (cancelled) return;
      if (i >= forgotten.length) return;
      set.add(forgotten[i].moment.id);
      setPulseSet(new Set(set));
      i++;
      setTimeout(tick, 800);
    };
    tick();
    return () => { cancelled = true; };
  }, [finale, placed]);

  // Pick a DPR ceiling: small phones get 1.35 (cinematic but smooth), tablets
  // 1.5, desktop 1.6. Bloom hides aliasing at lower DPRs, so the perceptual
  // hit is small while the framerate win on touch devices is large.
  const dprCeiling =
    typeof window !== "undefined"
      ? window.innerWidth < 640
        ? 1.35
        : window.innerWidth < 1024
          ? 1.5
          : 1.6
      : 1.5;

  return (
    <Canvas
      dpr={[1, dprCeiling]}
      camera={{ position: [0, 2, 22], fov: 52, near: 0.1, far: 260 }}
      gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1, powerPreference: "high-performance" }}
      className="universe-canvas"
      style={{ position: "absolute", inset: 0, touchAction: "none" }}
    >
      <Backdrop />
      <Suspense fallback={null}>
        <EchoField messageCount={walk.opening.message_count} />
        <Threads placed={placed} />
        {placed.map((p) => (
          <MemoryStar
            key={p.moment.id}
            placed={p}
            active={activeMomentId === p.moment.id}
            pulse={pulseSet.has(p.moment.id) ? 1 : 0}
            onClick={() => { if (!p.isEmptyMonth) onOpenMoment(p.moment.id); }}
          />
        ))}
        {viewMode === "all" && placed.map((p) => <StarDateLabel key={`date-${p.moment.id}`} placed={p} />)}
        {viewMode === "year" && placed.map((p) => <MonthLabel key={`label-${p.moment.id}`} placed={p} />)}
        {viewMode === "year" && selectedYear != null && placed.map((p) => {
          const monthNum = Number(p.moment.date.slice(5, 7));
          const monthKey = `${selectedYear}-${String(monthNum).padStart(2, "0")}`;
          const monthPhotos = media.filter((m) => m.ts?.startsWith(monthKey));
          if (monthPhotos.length === 0) return null;
          return (
            <MonthDeck
              key={`deck-${p.moment.id}`}
              placed={p}
              count={monthPhotos.length}
              coverUrl={(monthPhotos.find((m) => m.has_person === true) ?? monthPhotos.find((m) => m.kind === "photo") ?? monthPhotos[0])?.url ?? null}
              onOpen={() => onOpenMonthPhotos(monthNum, monthPhotos)}
            />
          );
        })}
        {viewMode === "all" && (
          <CenterStoryMarker onOpen={onOpenStorySummary} />
        )}
        {viewMode === "year" && yearLabel && (
          <CenterYearMarker year={yearLabel} onOpen={onOpenYearSummary} />
        )}
        {/* Free polaroid drift only in "all" view — year view uses per-month decks. */}
        {viewMode === "all" && (
          <PolaroidField media={media} placed={placed} onOpenImage={onOpenImage} />
        )}
      </Suspense>
      <CameraRig placed={placed} finale={finale} focusIndex={activeIdx} viewMode={viewMode} zoomSignal={zoomSignal} onZoomedChange={onZoomedChange} />
      <EffectComposer>
        <Bloom intensity={1.35} luminanceThreshold={0.25} luminanceSmoothing={0.85} mipmapBlur radius={0.85} />
        <Vignette eskil={false} offset={0.25} darkness={0.85} />
      </EffectComposer>
    </Canvas>
  );
}
