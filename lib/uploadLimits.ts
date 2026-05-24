// Single source of truth for upload limits — used by both the client-side
// drop zone (instant feedback) and the server route (defense against bypass).
//
// Sizing logic: /api/inspect buffers the upload through formData() →
// arrayBuffer() → JSZip, peaking at ~3-4× the file size in RAM. A 250 MB cap
// peaks around 1 GB per upload, leaving room for 3-4 concurrent uploads on a
// 4 GB VM. Most real WhatsApp exports sit well under 100 MB; this comfortably
// covers the realistic distribution while keeping us from being a memory
// liability on a small host.
//
// Bump this when you bump the VM's memory — not before.

export const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "250 MB";

export function formatMB(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Helpful message users see when they hit the cap. Tells them exactly what
// to do — re-export without media is the right answer because we only ever
// keep 80 photos anyway.
export const OVERSIZE_HINT =
  "WhatsApp exports with all media can be big. Re-export the chat without media — DearChats only uses the first 80 photos anyway.";
