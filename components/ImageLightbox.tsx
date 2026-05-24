"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Props {
  url: string | null;
  onClose: () => void;
}

export default function ImageLightbox({ url, onClose }: Props) {
  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", onKey); };
  }, [url, onClose]);
  return (
    <AnimatePresence>
      {url && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center px-3 sm:px-4 py-3"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          role="dialog" aria-modal="true"
        >
          <button
            type="button"
            className="absolute inset-0 bg-[#070504]/92 backdrop-blur-2xl"
            aria-label="Close image"
            onClick={onClose}
          />
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="relative max-w-[94vw] sm:max-w-[88vw] max-h-[88dvh] sm:max-h-[86dvh]"
          >
            <div className="rounded-lg bg-[#f3eadb] p-2.5 sm:p-4 shadow-2xl shadow-black/80">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="block max-w-full max-h-[78dvh] rounded-sm object-contain" />
            </div>
            <button
              type="button"
              onClick={onClose}
              className="absolute -top-2 -right-2 sm:-top-3 sm:-right-3 h-11 w-11 rounded-full border border-parchment/30 bg-ink text-mist hover:text-parchment transition shadow-lg touch-target"
              aria-label="Close"
            >×</button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
