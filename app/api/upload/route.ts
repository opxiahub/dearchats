import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getWalkRowForUser } from "@/lib/db/walks";
import { getDB } from "@/lib/db";
import { runPhaseB } from "@/lib/pipeline/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 300;

type GenderIn = "male" | "female" | "nonbinary";

interface Body {
  walkId: string;
  relationship: "romantic" | "best_friend" | "sibling";
  userName: string;
  otherName: string;
  userGender: GenderIn;
  otherGender: GenderIn;
  // The raw participant name (from the WhatsApp file) the user identified as.
  // Used downstream to match `message.sender` to "me" vs "them" in the UI.
  userRawName: string;
}

const GENDERS: GenderIn[] = ["male", "female", "nonbinary"];

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const body: Body = await req.json();
    if (
      !body.walkId ||
      !body.relationship ||
      !body.userName?.trim() ||
      !body.otherName?.trim() ||
      !GENDERS.includes(body.userGender) ||
      !GENDERS.includes(body.otherGender) ||
      !body.userRawName?.trim()
    ) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const walk = getWalkRowForUser(body.walkId, user.id);
    if (!walk) return NextResponse.json({ error: "Walk not found" }, { status: 404 });

    const userRaw = body.userRawName.trim();
    // The other raw name is whichever original participant is NOT the user.
    const rawA = walk.user_raw_name ?? walk.user_name;
    const rawB = walk.other_raw_name ?? walk.other_name;
    const otherRaw = userRaw === rawA ? rawB : rawA;

    getDB().prepare(
      `UPDATE walks SET relationship = ?, user_name = ?, other_name = ?,
        user_raw_name = ?, other_raw_name = ?, user_gender = ?, other_gender = ?,
        updated_at = ? WHERE id = ?`,
    ).run(
      body.relationship,
      body.userName.trim(),
      body.otherName.trim(),
      userRaw,
      otherRaw,
      body.userGender,
      body.otherGender,
      Date.now(),
      body.walkId,
    );

    // Kick off Phase B. Phase A may still be running — runPhaseB handles
    // the case where eager artifacts aren't ready yet (re-runs phase A).
    runPhaseB(body.walkId).catch((err) => console.error("[phaseB fired]", err));

    return NextResponse.json({ walkId: body.walkId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
