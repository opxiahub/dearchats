"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Photo { url: string; ts: string | null; filename: string }

interface Props {
  open: boolean;
  year: number | null;
  month: number | null; // 1-12
  photos: Photo[];
  onClose: () => void;
  onOpenImage: (url: string) => void;
}

const MONTH_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function MonthPhotosDialog({ open, year, month, photos, onClose, onOpenImage }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", onKey); };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && month != null && year != null && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="fixed inset-0 z-[58] bg-[#070504]/95 backdrop-blur-2xl flex flex-col"
          role="dialog" aria-modal="true"
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 sm:top-4 right-3 sm:right-4 z-10 h-11 w-11 rounded-full border border-parchment/20 bg-ink/60 text-mist hover:text-parchment hover:border-parchment/50 transition touch-target"
            aria-label="Close"
          >×</button>

          <div className="pt-14 sm:pt-16 pb-6 px-5 sm:px-6 text-center">
            <p className="text-[10px] tracking-[0.4em] text-mist/55 uppercase mb-3">photos from</p>
            <h2 className="serif display-lg text-parchment text-balance overflow-wrap-anywhere">{MONTH_FULL[month - 1]} {year}</h2>
            <p className="text-[10px] tracking-[0.3em] uppercase text-mist/55 mt-3">
              {photos.length} {photos.length === 1 ? "photo" : "photos"}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto memory-scroll px-4 sm:px-8 pb-12 pad-safe-bottom">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 max-w-6xl mx-auto">
              {photos.map((p, i) => (
                <motion.button
                  key={p.url}
                  type="button"
                  onClick={() => onOpenImage(p.url)}
                  initial={{ opacity: 0, y: 14, rotate: (i % 2 ? 1 : -1) * 2 }}
                  animate={{ opacity: 1, y: 0, rotate: (i % 2 ? 1 : -1) * (i % 3) }}
                  transition={{ duration: 0.5, delay: Math.min(0.35, i * 0.04) }}
                  className="group block bg-[#f3eadb] p-2 sm:p-3 rounded-md shadow-2xl shadow-black/50 hover:scale-[1.02] transition-transform"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="w-full aspect-square object-cover rounded-sm" />
                  {p.ts && (
                    <p className="mt-1.5 text-center text-[9px] tracking-widest uppercase text-[#3a2a1c]/55">
                      {p.ts}
                    </p>
                  )}
                </motion.button>
              ))}
            </div>
            {photos.length === 0 && (
              <p className="text-mist text-center serif italic mt-20">No photos from this month.</p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
