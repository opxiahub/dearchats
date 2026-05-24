import { redirect } from "next/navigation";
import UniverseBackdrop from "@/components/UniverseBackdrop";
import ProfileMenu from "@/components/ProfileMenu";
import BrandMark from "@/components/BrandMark";
import { type GenerationSummary } from "@/components/profile/GenerationList";
import ProfileArchive from "@/components/profile/ProfileArchive";
import { getCurrentUser } from "@/lib/auth/session";
import { listWalksForUser, type WalkRow } from "@/lib/db/walks";
import { RELATIONSHIP_LABELS } from "@/lib/relationshipRubrics";
import type { Walk } from "@/lib/types";

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtRange(first?: string, last?: string): string {
  if (!first || !last) return "Dates still forming";
  const a = new Date(`${first}T00:00:00Z`);
  const b = new Date(`${last}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "Dates still forming";
  const opts: Intl.DateTimeFormatOptions = { month: "short", year: "numeric", timeZone: "UTC" };
  return `${a.toLocaleDateString("en-US", opts)} - ${b.toLocaleDateString("en-US", opts)}`;
}

function toSummary(row: WalkRow): GenerationSummary {
  let walk: Walk | null = null;
  if (row.walk_json) {
    try {
      walk = JSON.parse(row.walk_json) as Walk;
    } catch {
      walk = null;
    }
  }

  const userName = walk?.opening.user_name ?? row.user_name;
  const otherName = walk?.opening.other_name ?? row.other_name;
  const relationship = RELATIONSHIP_LABELS[row.relationship] ?? "Relationship";
  const messageCount = walk?.opening.message_count ?? null;

  return {
    id: row.id,
    title: `${userName} & ${otherName}`,
    subtitle: relationship,
    dateRange: fmtRange(walk?.opening.first_date, walk?.opening.last_date),
    createdAt: fmtDate(row.created_at),
    stage: row.stage === "done" ? "ready" : row.stage.replaceAll("_", " "),
    progress: row.progress ?? 0,
    isReady: !!row.walk_json && row.partial_ready === 1,
    momentCount: walk?.moments.length ?? 0,
    messageCount,
  };
}

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const generations = listWalksForUser(user.id).map(toSummary);

  return (
    <main className="relative min-h-dvh w-full max-w-full bg-[#070504] text-parchment overflow-x-hidden overflow-y-hidden">
      <UniverseBackdrop density={0.045} warmth={0.7} />

      <div className="relative z-10 min-h-dvh w-full max-w-full overflow-x-hidden overflow-y-auto memory-scroll overscroll-x-none">
        <header className="sticky-header-blur z-30 flex items-center justify-between gap-4 px-5 sm:px-7 py-4 pad-safe-top w-full max-w-full">
          <BrandMark />
          <ProfileMenu user={user} />
        </header>

        <section className="w-full max-w-5xl mx-auto px-5 sm:px-7 pb-16 sm:pb-20 overflow-x-hidden">
          <ProfileArchive initialItems={generations} />
        </section>
      </div>
    </main>
  );
}
