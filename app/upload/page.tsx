"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Gender, RelationshipType } from "@/lib/types";
import { RELATIONSHIP_LABELS, RELATIONSHIP_BLURBS } from "@/lib/relationshipRubrics";
import UniverseBackdrop from "@/components/UniverseBackdrop";
import BrandMark from "@/components/BrandMark";
import { getMusic } from "@/lib/music";

export default function UploadPage() {
  return (
    <Suspense fallback={<main className="fixed inset-0 bg-[#070504]" />}>
      <ConfigureView />
    </Suspense>
  );
}

function ConfigureView() {
  const router = useRouter();
  const params = useSearchParams();
  const walkId = params.get("walkId") ?? "";
  const rawParticipants = useMemo(() => {
    const p = params.get("p") ?? "";
    return p.split("|").filter(Boolean).slice(0, 2);
  }, [params]);
  const messageCount = Number(params.get("m") ?? "0");
  const mediaCount = Number(params.get("ph") ?? "0");

  // If someone lands here without an active walkId, bounce them home.
  useEffect(() => {
    if (!walkId || rawParticipants.length < 2) router.replace("/");
  }, [walkId, rawParticipants.length, router]);

  // The raw participant the user identifies as — used downstream to label
  // "me" vs "them" against message.sender (which is the raw WhatsApp name).
  const [userRawName, setUserRawName] = useState<string>(rawParticipants[0] ?? "");
  // Display names: default to raw, but the user types whatever they actually
  // want shown. These become the "actual" names everywhere downstream.
  const [userName, setUserName] = useState<string>(rawParticipants[0] ?? "");
  const [otherName, setOtherName] = useState<string>(rawParticipants[1] ?? "");
  const [userGender, setUserGender] = useState<Gender | null>(null);
  const [otherGender, setOtherGender] = useState<Gender | null>(null);
  const [relationship, setRelationship] = useState<RelationshipType | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function pickAsMe(name: string) {
    if (name === userRawName) return;
    // The user flipped which participant is "you". Swap the two name
    // inputs and the two gender selections so what they typed under
    // "your name / their name" follows the swap.
    setUserRawName(name);
    setUserName(otherName);
    setOtherName(userName);
    setUserGender(otherGender);
    setOtherGender(userGender);
  }

  const ready =
    !!relationship &&
    !!userName.trim() &&
    !!otherName.trim() &&
    userName.trim() !== otherName.trim() &&
    !!userGender &&
    !!otherGender &&
    !!userRawName;

  async function submit() {
    if (!ready) return;
    sessionStorage.setItem("dc_music_on", "1");
    getMusic().setMuted(false, 200);
    getMusic().crossfadeTo("loading", 1800);
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walkId,
          relationship,
          userName: userName.trim(),
          otherName: otherName.trim(),
          userGender,
          otherGender,
          userRawName,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      setTimeout(() => router.push(`/processing/${walkId}`), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  const moodForType: Record<RelationshipType, string> = {
    romantic: "rgba(216,160,144,0.32)",
    best_friend: "rgba(224,197,107,0.28)",
    sibling: "rgba(166,185,142,0.28)",
  };
  const types: RelationshipType[] = ["romantic", "best_friend", "sibling"];

  return (
    <main className="fixed inset-0 bg-[#070504] text-parchment overflow-hidden">
      <UniverseBackdrop showOrbits />

      <div className="header-fade" aria-hidden />
      <div className="absolute left-5 top-5 z-30 pad-safe-top">
        <BrandMark compact />
      </div>

      <div className="relative z-10 h-full w-full overflow-y-auto memory-scroll">
        <div className="min-h-full w-full flex items-start sm:items-center justify-center px-4 sm:px-5 below-header pb-12 sm:pb-16 pad-safe-bottom">
          <div className="w-full max-w-2xl space-y-8 sm:space-y-10">
            <div className="text-center">
              <p className="text-[10px] tracking-[0.35em] sm:tracking-[0.45em] text-mist/65 uppercase mb-4 overflow-wrap-anywhere">
                we found {messageCount.toLocaleString()} messages{mediaCount ? ` · ${mediaCount.toLocaleString()} photos` : ""}
              </p>
              <h1 className="serif display-lg text-balance mb-3">
                Tell us who&apos;s in this chat.
              </h1>
              <p className="text-mist body-clamp leading-relaxed text-balance max-w-md mx-auto">
                The names and pronouns you set here are what we&apos;ll use everywhere — not the ones in the export.
              </p>
            </div>

            {/* Who is "me" */}
            <section className="space-y-4">
              <p className="text-[10px] tracking-[0.28em] sm:tracking-[0.32em] text-mist/55 uppercase text-center">which one is you in this chat?</p>
              <div className="flex flex-col sm:flex-row gap-3">
                {rawParticipants.map((p) => {
                  const isMe = userRawName === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => pickAsMe(p)}
                      className={`flex-1 py-3.5 px-4 rounded-2xl border text-left transition min-w-0 ${
                        isMe ? "border-parchment bg-parchment/10 text-parchment" : "border-mist/25 text-mist hover:border-parchment/50 hover:text-parchment"
                      }`}
                    >
                      <p className={`text-[10px] tracking-[0.25em] uppercase mb-1 ${isMe ? "text-parchment/65" : "text-mist/45"}`}>
                        {isMe ? "you" : "them"}
                      </p>
                      <p className="serif text-base sm:text-lg truncate">{p}</p>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Names + genders */}
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
              <NameGenderField
                label="your name"
                name={userName}
                onName={setUserName}
                gender={userGender}
                onGender={setUserGender}
              />
              <NameGenderField
                label="their name"
                name={otherName}
                onName={setOtherName}
                gender={otherGender}
                onGender={setOtherGender}
              />
              {userName.trim() && userName.trim() === otherName.trim() && (
                <p className="text-rose text-sm sm:col-span-2">Both names are the same — please change one.</p>
              )}
            </section>

            {/* Relationship */}
            <section>
              <p className="text-[10px] tracking-[0.28em] sm:tracking-[0.32em] text-mist/55 uppercase mb-4 text-center">what is this chat to you?</p>
              <div className="grid gap-3">
                {types.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setRelationship(t)}
                    className={`relative overflow-hidden w-full text-left p-4 sm:p-5 rounded-2xl border transition ${
                      relationship === t ? "border-parchment bg-parchment/10" : "border-mist/25 hover:border-parchment/55"
                    }`}
                  >
                    <span
                      className="absolute inset-0 pointer-events-none"
                      style={{ background: `radial-gradient(circle at 12% 50%, ${moodForType[t]}, transparent 55%)`, opacity: relationship === t ? 1 : 0.55 }}
                    />
                    <div className="relative">
                      <div className="serif italic text-lg sm:text-xl mb-1">{RELATIONSHIP_LABELS[t]}</div>
                      <div className="text-mist text-sm leading-relaxed">{RELATIONSHIP_BLURBS[t]}</div>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            {error && <p className="text-rose text-sm text-center">{error}</p>}

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={submit}
                disabled={!ready || submitting}
                className={`serif italic text-lg sm:text-xl px-8 sm:px-10 py-3.5 sm:py-4 rounded-full border transition-colors duration-500 touch-target ${
                  ready && !submitting ? "border-parchment text-parchment hover:bg-parchment hover:text-ink" : "border-mist/25 text-mist/35 cursor-not-allowed"
                }`}
              >
                Open the door →
              </button>
            </div>
          </div>
        </div>
      </div>

      {submitting && <PortalDepart />}
    </main>
  );
}

function NameGenderField({
  label,
  name,
  onName,
  gender,
  onGender,
}: {
  label: string;
  name: string;
  onName: (s: string) => void;
  gender: Gender | null;
  onGender: (g: Gender) => void;
}) {
  const opts: { value: Gender; label: string }[] = [
    { value: "male", label: "He" },
    { value: "female", label: "She" },
    { value: "nonbinary", label: "They" },
  ];
  return (
    <div>
      <label className="text-[10px] tracking-[0.28em] text-mist/55 uppercase block mb-1.5">{label}</label>
      <input
        type="text"
        value={name}
        onChange={(e) => onName(e.target.value)}
        maxLength={60}
        className="w-full bg-parchment/[0.04] border border-mist/25 rounded-lg px-3.5 py-2.5 serif text-lg text-parchment placeholder:text-mist/30 focus:outline-none focus:border-parchment/80"
      />
      <div className="mt-2 flex gap-2">
        {opts.map((o) => {
          const on = gender === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onGender(o.value)}
              className={`flex-1 text-xs tracking-[0.18em] uppercase py-2 rounded-lg border transition ${
                on ? "border-parchment bg-parchment/10 text-parchment" : "border-mist/20 text-mist hover:border-parchment/45 hover:text-parchment"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PortalDepart() {
  return (
    <AnimatePresence>
      <motion.div
        key="portal"
        className="fixed inset-0 z-50 flex items-center justify-center bg-[#070504] overflow-hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {Array.from({ length: 64 }).map((_, i) => {
          const angle = (i / 64) * Math.PI * 2;
          const r = 280 + (i % 5) * 40;
          const x = Math.cos(angle) * r;
          const y = Math.sin(angle) * r;
          return (
            <motion.span
              key={i}
              className="absolute h-1 w-1 rounded-full bg-parchment"
              initial={{ x, y, opacity: 0 }}
              animate={{ x: 0, y: 0, opacity: [0, 1, 0] }}
              transition={{ duration: 1.4, delay: (i % 12) * 0.04, ease: "easeIn" }}
              style={{ boxShadow: "0 0 12px rgba(241,234,216,0.85)" }}
            />
          );
        })}
        <motion.div
          className="absolute rounded-full"
          initial={{ width: 4, height: 4, opacity: 0 }}
          animate={{ width: 1800, height: 1800, opacity: [0, 1, 0.4] }}
          transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1], delay: 0.5 }}
          style={{
            background: "radial-gradient(circle at center, #f3eadb 0%, #c9a961 14%, #c77b6a 30%, #3b1f38 50%, transparent 70%)",
            filter: "blur(2px)",
          }}
        />
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0] }}
          transition={{ duration: 1.6, delay: 0.2 }}
          className="relative z-10 serif italic text-2xl text-parchment/90 tracking-wide"
        >
          opening the door
        </motion.p>
      </motion.div>
    </AnimatePresence>
  );
}
