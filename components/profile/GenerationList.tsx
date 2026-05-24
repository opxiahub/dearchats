"use client";

import Link from "next/link";
import { useState } from "react";

export interface GenerationSummary {
  id: string;
  title: string;
  subtitle: string;
  dateRange: string;
  createdAt: string;
  stage: string;
  progress: number;
  isReady: boolean;
  momentCount: number;
  messageCount: number | null;
}

export default function GenerationList({
  initialItems,
  items: controlledItems,
  onItemsChange,
}: {
  initialItems: GenerationSummary[];
  items?: GenerationSummary[];
  onItemsChange?: (items: GenerationSummary[]) => void;
}) {
  const [localItems, setLocalItems] = useState(initialItems);
  const items = controlledItems ?? localItems;
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<GenerationSummary | null>(null);
  const [error, setError] = useState("");

  function updateItems(next: GenerationSummary[]) {
    if (onItemsChange) onItemsChange(next);
    else setLocalItems(next);
  }

  async function deleteGeneration(id: string) {
    setDeleting(id);
    setError("");
    try {
      const res = await fetch(`/api/profile/walks/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not delete generation");
      }
      updateItems(items.filter((g) => g.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(null);
      setPendingDelete(null);
    }
  }

  if (items.length === 0) {
    return (
      <>
        <div className="w-full max-w-full rounded-2xl border border-parchment/12 bg-parchment/[0.035] px-6 py-12 text-center overflow-hidden">
          <p className="serif italic text-2xl text-parchment mb-3">No generations yet.</p>
          <p className="text-sm text-mist max-w-sm mx-auto leading-relaxed">
            Upload a WhatsApp export and your finished walks will appear here.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="space-y-4 w-full max-w-full overflow-x-hidden">
        {error && <p className="text-sm text-rose text-center">{error}</p>}
        {items.map((item) => (
          <article
            key={item.id}
            className="group w-full max-w-full rounded-2xl border border-parchment/12 bg-parchment/[0.035] hover:bg-parchment/[0.055] transition overflow-hidden"
          >
            <div className="p-5 sm:p-6 flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0 max-w-full">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-[10px] tracking-[0.22em] sm:tracking-[0.28em] uppercase text-gold/75 overflow-wrap-anywhere">{item.createdAt}</span>
                  <span className="text-[10px] tracking-[0.18em] sm:tracking-[0.22em] uppercase text-mist/45 overflow-wrap-anywhere">{item.stage}</span>
                </div>
                <h2 className="serif display-sm text-parchment text-balance overflow-wrap-anywhere">{item.title}</h2>
                <p className="text-sm text-mist/80 mt-1 overflow-wrap-anywhere">{item.subtitle}</p>
                <p className="text-xs text-mist/50 mt-3 overflow-wrap-anywhere">
                  {item.dateRange}
                  {item.messageCount != null && <> · {item.messageCount.toLocaleString()} messages</>}
                  {item.momentCount > 0 && <> · {item.momentCount.toLocaleString()} memories</>}
                </p>
                {!item.isReady && (
                  <div className="mt-4 h-1.5 w-full max-w-sm rounded-full bg-parchment/10 overflow-hidden">
                    <div className="h-full rounded-full bg-gold/70" style={{ width: `${Math.max(4, Math.round(item.progress * 100))}%` }} />
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2 shrink-0 max-w-full">
                {item.isReady ? (
                  <Link
                    href={`/walk/${item.id}`}
                    className="rounded-full border border-parchment/35 px-4 py-2 text-sm text-parchment hover:bg-parchment hover:text-ink transition touch-target"
                  >
                    Open walk
                  </Link>
                ) : (
                  <Link
                    href={`/processing/${item.id}`}
                    className="rounded-full border border-parchment/25 px-4 py-2 text-sm text-mist hover:text-parchment hover:border-parchment/55 transition touch-target"
                  >
                    View progress
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => setPendingDelete(item)}
                  disabled={deleting === item.id}
                  className="rounded-full border border-rose/35 px-4 py-2 text-sm text-rose/85 hover:bg-rose/15 disabled:opacity-45 transition touch-target"
                >
                  {deleting === item.id ? "Deleting" : "Delete"}
                </button>
              </div>
            </div>
          </article>
        ))}

        {pendingDelete && (
          <DeleteDialog
            item={pendingDelete}
            busy={deleting === pendingDelete.id}
            onCancel={() => setPendingDelete(null)}
            onConfirm={() => deleteGeneration(pendingDelete.id)}
          />
        )}
      </div>
    </>
  );
}

function DeleteDialog({
  item,
  busy,
  onCancel,
  onConfirm,
}: {
  item: GenerationSummary;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-5 py-6">
      <button
        type="button"
        aria-label="Cancel delete"
        onClick={busy ? undefined : onCancel}
        className="absolute inset-0 h-full w-full bg-[#070504]/80 backdrop-blur-xl"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-generation-title"
        className="relative w-full max-w-md rounded-2xl border border-rose/20 bg-[#110d0c] shadow-2xl shadow-black/70 p-6 sm:p-7 text-left"
      >
        <p className="text-[10px] tracking-[0.35em] uppercase text-rose/70 mb-3">delete generation</p>
        <h3 id="delete-generation-title" className="serif display-md text-parchment leading-tight text-balance">
          Delete this walk?
        </h3>
        <p className="text-mist/80 text-sm leading-relaxed mt-4">
          This will permanently remove <span className="text-parchment">{item.title}</span>, including the uploaded chat text and saved media for this generation.
        </p>
        <p className="text-mist/45 text-xs mt-3">
          {item.dateRange}
          {item.messageCount != null && <> · {item.messageCount.toLocaleString()} messages</>}
        </p>

        <div className="mt-7 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-full border border-mist/25 px-5 py-3 text-sm text-mist hover:border-parchment/55 hover:text-parchment disabled:opacity-45 transition touch-target"
          >
            Keep it
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-full border border-rose/45 bg-rose/10 px-5 py-3 text-sm text-rose hover:bg-rose/20 disabled:opacity-45 transition touch-target"
          >
            {busy ? "Deleting" : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}
