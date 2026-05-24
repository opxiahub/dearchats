"use client";

import { useEffect, useRef } from "react";

interface Props {
  density?: number;     // stars per 1000px²
  showOrbits?: boolean; // gentle drifting orbit rings
  warmth?: number;      // 0..1, how much warm/gold tint mixes in
}

/**
 * Lightweight always-on backdrop for the onboarding screens. Pure 2D canvas,
 * no R3F dep — so it costs almost nothing and shows up instantly even on the
 * landing page before the user is signed in.
 */
export default function UniverseBackdrop({ density = 0.06, showOrbits = true, warmth = 0.6 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    let raf = 0;
    let t = 0;
    const stars: Array<{ x: number; y: number; r: number; a: number; sp: number; warm: boolean }> = [];

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c!.width = window.innerWidth * dpr;
      c!.height = window.innerHeight * dpr;
      c!.style.width = window.innerWidth + "px";
      c!.style.height = window.innerHeight + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars.length = 0;
      const n = Math.floor((window.innerWidth * window.innerHeight) / 1000 * density);
      for (let i = 0; i < n; i++) {
        stars.push({
          x: Math.random() * window.innerWidth,
          y: Math.random() * window.innerHeight,
          r: Math.random() * 1.4 + 0.2,
          a: Math.random() * 0.55 + 0.18,
          sp: 0.3 + Math.random() * 1.1,
          warm: Math.random() < warmth * 0.35,
        });
      }
    }

    function draw() {
      t += 0.016;
      ctx!.clearRect(0, 0, window.innerWidth, window.innerHeight);

      if (showOrbits) {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight * 0.55;
        const maxR = Math.min(window.innerWidth, window.innerHeight) * 0.42;
        for (let i = 0; i < 3; i++) {
          const r = maxR * (0.45 + i * 0.22) + Math.sin(t * 0.3 + i) * 4;
          ctx!.beginPath();
          ctx!.ellipse(cx, cy, r, r * 0.62, t * 0.04, 0, Math.PI * 2);
          ctx!.strokeStyle = i % 2 === 0
            ? `rgba(201, 169, 97, ${0.05 + Math.sin(t * 0.5 + i) * 0.02})`
            : `rgba(199, 123, 106, ${0.045 + Math.sin(t * 0.4 + i) * 0.02})`;
          ctx!.lineWidth = 1;
          ctx!.stroke();
        }
      }

      for (const s of stars) {
        const tw = 0.55 + 0.45 * Math.sin(t * s.sp + s.x * 0.01);
        ctx!.globalAlpha = s.a * tw;
        ctx!.fillStyle = s.warm ? "#e0c56b" : "#f1ead8";
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx!.fill();
        if (s.r > 1.0) {
          ctx!.globalAlpha = s.a * tw * 0.35;
          ctx!.beginPath();
          ctx!.arc(s.x, s.y, s.r * 3.5, 0, Math.PI * 2);
          ctx!.fill();
        }
      }
      ctx!.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    }

    resize();
    draw();
    window.addEventListener("resize", resize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [density, showOrbits, warmth]);

  return (
    <>
      <div className="absolute inset-0 pointer-events-none memory-sky" />
      <canvas ref={ref} className="absolute inset-0 pointer-events-none" />
    </>
  );
}
