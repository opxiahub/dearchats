import Link from "next/link";

export default function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/"
      aria-label="DearChats home"
      className="inline-flex items-center gap-2.5 sm:gap-3 text-parchment hover:text-parchment transition group min-w-0"
    >
      <span className={`${compact ? "h-8 w-8 sm:h-9 sm:w-9" : "h-9 w-9 sm:h-10 sm:w-10"} shrink-0 rounded-xl overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.35)]`}>
        <img src="/dearchats-logo.svg" alt="" className="h-full w-full object-cover" />
      </span>
      <span className="text-[10px] sm:text-[11px] tracking-[0.28em] sm:tracking-[0.34em] uppercase text-mist/75 group-hover:text-parchment whitespace-nowrap">
        DearChats
      </span>
    </Link>
  );
}
