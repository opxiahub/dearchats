"use client";

import { Howl, Howler } from "howler";
import type { RelationshipType } from "./types";

export type MusicPurpose = "loading" | "explore" | "film";
export type MusicKey =
  | "loading"
  | "explore"
  | "film_romantic"
  | "film_best_friend"
  | "film_sibling";

const STEMS: Record<MusicKey, string> = {
  loading: "/audio/loading.mp3",
  explore: "/audio/explore.mp3",
  film_romantic: "/audio/film-romantic.mp3",
  film_best_friend: "/audio/film-best-friend.mp3",
  film_sibling: "/audio/film-sibling.mp3",
};

interface Loaded {
  howl: Howl;
  loaded: boolean;
  failed: boolean;
}

class MusicEngine {
  private howls = new Map<MusicKey, Loaded>();
  private current: MusicKey | null = null;
  private muted = true;
  private synthCtx: AudioContext | null = null;
  private synthNodes: Array<AudioNode & { stop?: () => void }> = [];
  private synthMaster: GainNode | null = null;
  private masterGain = 0.45;
  private muteTimer: ReturnType<typeof setTimeout> | null = null;

  setMuted(muted: boolean, durationMs = 900) {
    if (this.muteTimer) {
      clearTimeout(this.muteTimer);
      this.muteTimer = null;
    }
    this.muted = muted;
    const current = this.current ? this.howls.get(this.current) : null;

    if (muted) {
      if (current && !current.failed) {
        current.howl.fade(current.howl.volume(), 0, durationMs);
        this.muteTimer = setTimeout(() => Howler.mute(true), durationMs + 60);
      } else {
        Howler.mute(true);
      }
      this.fadeSynth(0.0001, durationMs, true);
      return;
    }

    Howler.mute(false);
    if (!this.current) return;
    if (current?.failed) {
      this.startSynth(this.current);
    } else if (current) {
      if (!current.howl.playing()) current.howl.play();
      current.howl.fade(current.howl.volume(), this.masterGain, durationMs);
    }
  }

  isMuted() { return this.muted; }

  crossfadeTo(key: MusicKey, durationMs = 2400) {
    if (this.current === key) return;
    const prev = this.current;
    this.current = key;
    if (this.muted) return;

    const loaded = this.ensureLoaded(key);
    if (loaded.failed) {
      this.stopSynth();
      this.startSynth(key);
    } else {
      const target = this.masterGain;
      if (!loaded.howl.playing()) {
        loaded.howl.volume(0);
        loaded.howl.play();
      }
      loaded.howl.fade(0, target, durationMs);
    }

    if (prev) {
      const prevLoaded = this.howls.get(prev);
      if (prevLoaded && !prevLoaded.failed) {
        prevLoaded.howl.fade(prevLoaded.howl.volume(), 0, durationMs);
        setTimeout(() => prevLoaded.howl.stop(), durationMs + 100);
      }
    }
  }

  stopAll() {
    if (this.muteTimer) {
      clearTimeout(this.muteTimer);
      this.muteTimer = null;
    }
    this.current = null;
    this.howls.forEach((l) => l.howl.stop());
    this.stopSynth();
  }

  private ensureLoaded(key: MusicKey): Loaded {
    let entry = this.howls.get(key);
    if (entry) return entry;
    const src = STEMS[key];
    const howl = new Howl({
      src: [src],
      loop: true,
      volume: 0,
      html5: false,
      onloaderror: () => {
        const e = this.howls.get(key);
        if (e) e.failed = true;
        if (this.current === key && !this.muted) {
          this.startSynth(key);
        }
      },
      onload: () => {
        const e = this.howls.get(key);
        if (e) e.loaded = true;
      },
    });
    entry = { howl, loaded: false, failed: false };
    this.howls.set(key, entry);
    return entry;
  }

  // Soft generative fallback — a couple of detuned sine pads, very low volume.
  private startSynth(key: MusicKey) {
    this.stopSynth();
    const W = typeof window !== "undefined" ? window : null;
    if (!W) return;
    const Ctx = W.AudioContext || (W as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    this.synthCtx = ctx;
    const master = ctx.createGain();
    this.synthMaster = master;
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(0.03, ctx.currentTime + 2.4);
    master.connect(ctx.destination);

    const palette: Record<MusicKey, number[]> = {
      loading: [196, 246.94, 329.63],
      explore: [174.61, 220, 277.18],
      film_romantic: [164.81, 220, 277.18],
      film_best_friend: [196, 261.63, 329.63],
      film_sibling: [174.61, 220, 293.66],
    };
    const freqs = palette[key];
    const nodes = freqs.map((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = i === 0 ? "sine" : "triangle";
      o.frequency.setValueAtTime(f, ctx.currentTime);
      g.gain.setValueAtTime(i === 0 ? 0.55 : 0.22, ctx.currentTime);
      o.connect(g);
      g.connect(master);
      o.start();
      return o;
    });
    this.synthNodes = [master, ...nodes];
  }

  private fadeSynth(target: number, durationMs: number, stopAfter = false) {
    if (!this.synthCtx || !this.synthMaster) return;
    const now = this.synthCtx.currentTime;
    const gain = this.synthMaster.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(Math.max(0.0001, gain.value), now);
    gain.exponentialRampToValueAtTime(Math.max(0.0001, target), now + durationMs / 1000);
    if (stopAfter) {
      this.muteTimer = setTimeout(() => this.stopSynth(), durationMs + 80);
    }
  }

  private stopSynth() {
    this.synthNodes.forEach((n) => n.stop?.());
    this.synthNodes = [];
    this.synthMaster = null;
    void this.synthCtx?.close();
    this.synthCtx = null;
  }
}

let _engine: MusicEngine | null = null;
export function getMusic(): MusicEngine {
  if (!_engine) _engine = new MusicEngine();
  return _engine;
}

export function musicKeyFor(purpose: MusicPurpose, relationship: RelationshipType): MusicKey {
  if (purpose === "loading" || purpose === "explore") return purpose;
  return `${purpose}_${relationship}` as MusicKey;
}

export function musicUrlFor(purpose: MusicPurpose, relationship: RelationshipType): string {
  return STEMS[musicKeyFor(purpose, relationship)];
}
