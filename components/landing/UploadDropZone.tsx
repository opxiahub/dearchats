"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, OVERSIZE_HINT, formatMB } from "@/lib/uploadLimits";

interface InspectResult {
  walkId: string;
  participants: string[];
  messageCount: number;
  mediaCount: number;
}

export default function UploadDropZone({ signedIn, wide = false }: { signedIn: boolean; wide?: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [progressMode, setProgressMode] = useState<"uploading" | "processing">("uploading");
  const [error, setError] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [askSignIn, setAskSignIn] = useState(false);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Warn before the user navigates away mid-upload — losing the tab here means
  // the upload is abandoned and they start over. Only armed while reading.
  useEffect(() => {
    if (!reading) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [reading]);

  function startReadingState() {
    setReading(true);
    setElapsed(0);
    setUploadProgress(0);
    setProgressMode("uploading");
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
  }

  function stopReadingState() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setReading(false);
  }

  function inspectFile(fd: FormData): Promise<Response> {
    if (typeof XMLHttpRequest === "undefined") {
      return fetch("/api/inspect", { method: "POST", body: fd });
    }

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let lastPct = 0;
      xhr.open("POST", "/api/inspect");
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const pct = Math.min(95, Math.round((event.loaded / Math.max(1, event.total)) * 100));
        if (pct !== lastPct) {
          lastPct = pct;
          setUploadProgress(pct);
        }
      };
      xhr.upload.onload = () => {
        setUploadProgress(100);
        setProgressMode("processing");
      };
      xhr.onload = () => {
        setUploadProgress(100);
        setProgressMode("processing");
        resolve(new Response(xhr.responseText, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: { "Content-Type": xhr.getResponseHeader("Content-Type") || "application/json" },
        }));
      };
      xhr.onerror = () => reject(new Error("Upload failed — check your connection and try again. Keep this tab open while it uploads."));
      xhr.onabort = () => reject(new Error("Upload was interrupted. Try again and keep this tab open until it finishes."));
      xhr.send(fd);
    });
  }

  async function handleFile(file: File) {
    setError("");
    // Catch obvious problems locally before a single byte hits the network.
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".zip") && !lower.endsWith(".txt")) {
      setError(
        "That doesn't look like a WhatsApp export. Upload the .zip or .txt you get from Export Chat in WhatsApp.",
      );
      return;
    }
    if (file.size === 0) {
      setError("That file is empty. Try exporting your chat from WhatsApp again.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        `That file is ${formatMB(file.size)}. The limit is ${MAX_UPLOAD_LABEL}. ${OVERSIZE_HINT}`,
      );
      return;
    }
    startReadingState();
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await inspectFile(fd);
      if (res.status === 401) {
        window.location.href = "/api/auth/google";
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Failed to read file");
      }
      const data: InspectResult = await res.json();
      // Carry context forward via query so the configure screen has it.
      const q = new URLSearchParams({
        walkId: data.walkId,
        p: data.participants.slice(0, 2).join("|"),
        m: String(data.messageCount),
        ph: String(data.mediaCount ?? 0),
      });
      router.push(`/upload?${q.toString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      stopReadingState();
    }
  }

  function openPicker() {
    if (!signedIn) {
      window.location.href = "/api/auth/google";
      return;
    }
    inputRef.current?.click();
  }

  return (
    <div className={`w-full ${wide ? "max-w-none" : "max-w-xl"} mx-auto overflow-x-hidden`}>
      {askSignIn && !signedIn ? (
        <SignInPanel onBack={() => setAskSignIn(false)} />
      ) : (
        <label
          onDragOver={(e) => { e.preventDefault(); if (signedIn) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!signedIn) { setAskSignIn(true); return; }
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          onClick={(e) => {
            if (!signedIn) { e.preventDefault(); setAskSignIn(true); }
          }}
          className={`relative block w-full max-w-full overflow-hidden rounded-3xl border-2 border-dashed cursor-pointer transition-all text-center ${
            wide ? "px-6 sm:px-10 py-14 sm:py-20 lg:py-24" : "px-5 sm:px-7 py-10 sm:py-12"
          } ${
            dragging
              ? "border-gold/70 bg-gold/10"
              : reading
                ? "border-parchment/40 bg-parchment/[0.04]"
                : "border-mist/30 hover:border-parchment/60 hover:bg-parchment/[0.025]"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".zip,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          {reading ? (
            <div className="flex flex-col items-center gap-3">
              <PulseDot />
              <p className="serif italic text-xl text-parchment">opening the file…</p>
              <p className="text-mist/55 text-xs tracking-[0.2em] sm:tracking-[0.25em] uppercase overflow-wrap-anywhere">
                {progressMode === "uploading" ? "uploading securely" : "finding the people"}
              </p>
              <div className="w-full max-w-sm mt-2">
                <div className="flex items-center justify-between gap-3 text-[10px] tracking-[0.18em] sm:tracking-[0.22em] uppercase text-mist/55 mb-2">
                  <span>{progressMode === "uploading" ? `${uploadProgress}%` : "processing"}</span>
                  <span>{elapsed}s</span>
                </div>
                <div className="h-1.5 rounded-full bg-parchment/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full bg-gold/80 transition-all duration-500 ${progressMode === "processing" ? "animate-pulse" : ""}`}
                    style={{ width: `${progressMode === "uploading" ? Math.max(4, uploadProgress) : 100}%` }}
                  />
                </div>
                <p className="text-mist/45 text-xs leading-relaxed mt-3 text-balance">
                  Keep this tab open. Media-heavy exports can take a little longer.
                </p>
              </div>
            </div>
          ) : (
            <>
              <motion.div
                animate={{ scale: dragging ? 1.12 : 1, opacity: dragging ? 1 : 0.85 }}
                transition={{ duration: 0.5 }}
                className="mx-auto mb-5"
              >
                <DropIcon />
              </motion.div>
              <p className="serif text-lg sm:text-xl text-parchment mb-1 text-balance">
                {dragging ? "let go" : "Drop your WhatsApp export here"}
              </p>
              <p className="text-mist/55 text-[10px] sm:text-xs tracking-[0.18em] sm:tracking-[0.2em] uppercase">.zip or .txt · up to {MAX_UPLOAD_LABEL} · or tap to choose</p>
            </>
          )}
        </label>
      )}

      {error && <p className="text-rose mt-4 text-sm text-center">{error}</p>}

      {!askSignIn && (
        <div className="mt-5 text-center">
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="text-mist/65 hover:text-parchment text-sm underline underline-offset-4 decoration-mist/30 hover:decoration-parchment/60 transition"
          >
            Need help exporting your chat?
          </button>
        </div>
      )}

      <AnimatePresence>
        {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}

function SignInPanel({ onBack }: { onBack: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="relative rounded-3xl border border-parchment/15 bg-parchment/[0.03] px-7 py-10 text-center"
    >
      <p className="text-[10px] tracking-[0.4em] text-mist/65 uppercase mb-3">one quick step</p>
      <h3 className="serif text-2xl sm:text-3xl text-parchment mb-3 text-balance">
        Sign in to save your walk.
      </h3>
      <p className="text-mist/75 text-sm leading-relaxed max-w-sm mx-auto mb-7">
        Your memories live in your own private space. No spam, no newsletters — just a way to find your walk again.
      </p>
      <a
        href="/api/auth/google"
        className="inline-flex items-center gap-3 serif text-base px-7 py-3 border border-parchment/45 rounded-full hover:bg-parchment hover:text-ink transition-colors duration-500 touch-target"
      >
        <GoogleMark />
        <span>Continue with Google</span>
      </a>
      <div className="mt-5">
        <button
          type="button"
          onClick={onBack}
          className="text-[11px] tracking-[0.25em] uppercase text-mist hover:text-parchment transition"
        >
          ← back
        </button>
      </div>
    </motion.div>
  );
}

function HelpModal({ onClose }: { onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const steps = [
    { n: "01", title: "Open the chat", body: "On your phone, open the WhatsApp chat you want to remember." },
    { n: "02", title: "Export it", body: "Tap the name at the top, then Export Chat." },
    { n: "03", title: "Include media", body: "Choose Include Media to bring your photos with you. Without Media still works." },
    { n: "04", title: "Save the file", body: "Save the .zip (or .txt) to this device, then drop it here." },
  ];

  if (!mounted) return null;

  const node = (
    <motion.div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center px-5 py-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 w-full h-full bg-[#070504]/80 backdrop-blur-xl"
      />
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.97 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-xl max-h-[88dvh] overflow-y-auto memory-scroll rounded-3xl border border-parchment/15 bg-[#110d0c] shadow-2xl shadow-black/70 p-7 sm:p-8 text-parchment text-left"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 h-9 w-9 rounded-full border border-parchment/15 text-mist hover:text-parchment hover:border-parchment/50 transition"
        >×</button>
        <p className="text-[10px] tracking-[0.4em] text-mist/65 uppercase mb-2">how to export</p>
        <h3 className="serif text-3xl mb-6 text-balance">Get the file from WhatsApp.</h3>
        <ol className="space-y-3">
          {steps.map((s) => (
            <li key={s.n} className="flex gap-4 rounded-2xl border border-parchment/10 bg-parchment/[0.025] p-4">
              <span className="serif text-xl text-gold/70 shrink-0">{s.n}</span>
              <div>
                <p className="serif text-base text-parchment/95 mb-0.5">{s.title}</p>
                <p className="text-mist text-sm leading-relaxed">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </motion.div>
    </motion.div>
  );

  return createPortal(node, document.body);
}

function PulseDot() {
  return (
    <span className="relative inline-block">
      <span className="block h-3 w-3 rounded-full bg-parchment shadow-[0_0_18px_rgba(241,234,216,0.7)]" />
      <span className="absolute inset-[-6px] rounded-full bg-parchment/40 animate-ping" />
    </span>
  );
}

function DropIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden>
      <circle cx="20" cy="20" r="18" stroke="rgba(241,234,216,0.45)" />
      <path d="M20 11v14m0 0l-5-5m5 5l5-5" stroke="rgba(241,234,216,0.7)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="#EA4335" d="M12 11v3.05h7.05c-.3 1.55-1.95 4.55-7.05 4.55-4.25 0-7.7-3.5-7.7-7.8s3.45-7.8 7.7-7.8c2.4 0 4 1.05 4.95 1.95l3.4-3.3C18.1 1.45 15.3.3 12 .3 5.6.3.55 5.35.55 11.8S5.6 23.3 12 23.3c6.9 0 11.45-4.85 11.45-11.65 0-.8-.1-1.4-.2-2H12z"/>
    </svg>
  );
}
