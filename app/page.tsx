import { getCurrentUser } from "@/lib/auth/session";
import UniverseBackdrop from "@/components/UniverseBackdrop";
import UploadDropZone from "@/components/landing/UploadDropZone";
import ProfileMenu from "@/components/ProfileMenu";
import BrandMark from "@/components/BrandMark";

export default async function Landing({ searchParams }: { searchParams: Promise<{ auth_error?: string }> }) {
  const user = await getCurrentUser();
  const { auth_error } = await searchParams;

  return (
    <main className="min-h-dvh relative bg-[#070504] text-parchment overflow-hidden">
      <UniverseBackdrop />

      <div className="header-fade" aria-hidden />
      {/* Three equal-weight tracks (1fr · auto · 1fr) keep the GitHub pill dead
          center on every screen while guaranteeing the brand and profile can
          never overlap it — each lives in its own grid column. */}
      <div className="absolute inset-x-0 top-5 z-30 pad-safe-top px-4 sm:px-5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-3">
          <div className="justify-self-start min-w-0">
            <BrandMark hideLabelOnMobile />
          </div>

          <a
            href="https://github.com/opxiahub/dearchats"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Star DearChats on GitHub"
            title="Star DearChats on GitHub"
            className="justify-self-center inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-parchment/15 bg-parchment/5 text-mist/80 hover:text-parchment hover:border-parchment/30 hover:bg-parchment/10 transition-colors touch-target"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden className="shrink-0">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden className="shrink-0 text-gold/90">
              <path
                fill="currentColor"
                d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"
              />
            </svg>
          </a>

          <div className="justify-self-end min-w-0">
            {user && <ProfileMenu user={user} />}
          </div>
        </div>
      </div>

      <div className="relative z-10 min-h-dvh flex flex-col items-center justify-center px-5 sm:px-6 below-header pb-12 sm:pb-16 pad-safe-bottom text-center">
        <div className="w-full max-w-2xl mx-auto fade-up">
          <h1 className="serif display-xl text-balance mb-6 sm:mb-7">
            A private museum<br />of a relationship.
          </h1>
          <p className="text-mist body-clamp leading-relaxed mb-10 sm:mb-12 text-balance max-w-md mx-auto">
            Upload a WhatsApp chat. Walk through the moments
            you forgot you remember.
          </p>

          <div className="mt-2">
            <UploadDropZone signedIn={!!user} />

            {auth_error && (
              <p className="text-rose/80 text-sm mt-6">Sign in failed: {auth_error}</p>
            )}
          </div>

          <p className="text-mist/45 text-xs mt-12 sm:mt-14 max-w-sm mx-auto leading-relaxed">
            Private to your account. Delete any time.
          </p>
        </div>
      </div>
    </main>
  );
}
