import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { parseWhatsAppText } from "@/lib/parser/whatsapp";
import { getCurrentUser } from "@/lib/auth/session";
import { createWalk, getWalkRow, newWalkId } from "@/lib/db/walks";
import { runPhaseA } from "@/lib/pipeline/orchestrator";
import { isImageName, saveMediaFile, setWalkHasMedia } from "@/lib/db/media";
import { classifyWalkImages } from "@/lib/imageClassifier";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, OVERSIZE_HINT, formatMB } from "@/lib/uploadLimits";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 300;

function fireAfterResponse(task: () => Promise<void>) {
  setTimeout(() => {
    task().catch((err) => console.error("[inspect/bg]", err));
  }, 0);
}

// WhatsApp group exports carry system lines that one-on-one chats never do.
// Two or more of these markers (or 3+ people each carrying a real share of the
// messages) means this is a group — which DearChats does not support. We detect
// it explicitly instead of silently building a walk from the two loudest
// participants, which is what the old top-2 pick would have done.
const GROUP_MARKERS =
  /(created (this |the )?group|added you|\badded\b|\bremoved\b|\bleft\b|changed the subject|changed this group's|changed the group|group description|you're now an admin|became an admin|joined using|via invite link|changed to a community|added via)/i;

function looksLikeGroup(parsed: { messages: { sender: string; text: string; isSystem?: boolean }[] }): boolean {
  const counts = new Map<string, number>();
  let groupSystemHits = 0;
  for (const m of parsed.messages) {
    if (m.isSystem) {
      if (GROUP_MARKERS.test(m.text)) groupSystemHits++;
    } else {
      counts.set(m.sender, (counts.get(m.sender) ?? 0) + 1);
    }
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  // A "real" participant carries at least 2% of the traffic or 10 messages —
  // this filters out one-off senders from a forwarded contact or a name change.
  const threshold = Math.max(10, total * 0.02);
  const realParticipants = [...counts.values()].filter((c) => c >= threshold).length;
  return groupSystemHits >= 2 || realParticipants >= 3;
}

/**
 * /api/inspect — uploads the file, parses the chat text, returns immediately.
 *
 * The previous version did ALL the work in the response path: zip parse +
 * image decompression + 80 disk writes + DB inserts. That added 30–60s on
 * media-rich exports, which blew past Coolify's default Traefik 60s
 * responding-timeout and surfaced as a 502 with no app log.
 *
 * The fix: we still need to load the zip into memory (JSZip requires the
 * full archive to read any entry), but we only synchronously parse the .txt,
 * count image entries, and persist the walk row. Actually extracting and
 * writing the 80 image files — by far the slowest step — happens AFTER the
 * response is sent, on the same in-memory zip handle. Phase A also fires off
 * in the background as before. The user sees the configure screen in a few
 * seconds even on a 100 MB export, and polaroids stream in as they're
 * extracted and classified.
 */

async function backgroundExtractMedia(
  walkId: string,
  imageEntries: JSZip.JSZipObject[],
): Promise<void> {
  const saved: string[] = [];
  for (const entry of imageEntries) {
    if (!getWalkRow(walkId)) return;
    try {
      const data = await entry.async("nodebuffer");
      if (!getWalkRow(walkId)) return;
      if (data.length > 8 * 1024 * 1024) continue;
      saveMediaFile(walkId, entry.name, data);
      saved.push(path.basename(entry.name));
    } catch (e) {
      console.error("[inspect/bg] media save failed", e);
    }
  }
  if (saved.length > 0 && getWalkRow(walkId)) {
    setWalkHasMedia(walkId, true);
    try {
      await classifyWalkImages(walkId, saved);
    } catch (e) {
      console.error("[inspect/bg] classify failed", e);
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    // Reject oversize uploads BEFORE buffering the body. Saves memory on the
    // server and gives the client a clean 413 instead of a 502 from OOM.
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File is ${formatMB(declared)}. The limit is ${MAX_UPLOAD_LABEL}. ${OVERSIZE_HINT}` },
        { status: 413 },
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    // Second check after we have the parsed File — the Content-Length header
    // can be missing/lying on some clients; file.size is authoritative.
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File is ${formatMB(file.size)}. The limit is ${MAX_UPLOAD_LABEL}. ${OVERSIZE_HINT}` },
        { status: 413 },
      );
    }
    if (file.size === 0) {
      return NextResponse.json(
        { error: "That file is empty. In WhatsApp, open your chat → Export Chat, then upload the file you get." },
        { status: 400 },
      );
    }
    // Guard the file type server-side too — the client picker filters by
    // extension, but drag-and-drop and direct API calls can bypass that.
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".zip") && !lowerName.endsWith(".txt")) {
      return NextResponse.json(
        { error: "That doesn't look like a WhatsApp export. Upload the .zip or .txt file you get from Export Chat in WhatsApp." },
        { status: 400 },
      );
    }
    const buf = Buffer.from(await file.arrayBuffer());

    // Read just the bits we need to return the response: the chat text and
    // a count of image entries. Image bytes stay compressed in the JSZip
    // handle and get decompressed later, in the background extractor.
    let raw: string;
    let imageEntries: JSZip.JSZipObject[] = [];
    let totalImageCount = 0;
    if (lowerName.endsWith(".zip")) {
      let zip: JSZip;
      try {
        zip = await JSZip.loadAsync(buf);
      } catch {
        return NextResponse.json(
          { error: "We couldn't open this .zip — it may be incomplete or corrupted. Try downloading the export from WhatsApp again." },
          { status: 400 },
        );
      }
      const txtEntry = Object.values(zip.files).find(
        (f) => !f.dir && f.name.toLowerCase().endsWith(".txt"),
      );
      if (!txtEntry) {
        return NextResponse.json(
          { error: "This .zip has no chat .txt inside, so it isn't a WhatsApp export. In WhatsApp, open a chat → Export Chat, and upload the file you get." },
          { status: 400 },
        );
      }
      raw = await txtEntry.async("string");
      const allImages = Object.values(zip.files).filter((f) => !f.dir && isImageName(f.name));
      totalImageCount = allImages.length;
      // 80-cap kept from the original — keeps disk usage bounded.
      imageEntries = allImages.slice(0, 80);
    } else {
      raw = buf.toString("utf-8");
    }

    const parsed = parseWhatsAppText(raw);

    // Nothing parsed at all → this isn't a WhatsApp export (wrong file, or an
    // unsupported date format), not merely a short chat.
    if (parsed.messages.length === 0) {
      return NextResponse.json(
        { error: "We couldn't read any messages from this file, so it doesn't look like a WhatsApp export. In WhatsApp, open a chat → Export Chat, and upload that file." },
        { status: 400 },
      );
    }
    if (looksLikeGroup(parsed)) {
      return NextResponse.json(
        { error: "This looks like a group chat. DearChats is built for one-on-one chats — open a chat with a single person, export that, and upload it." },
        { status: 400 },
      );
    }
    if (parsed.participants.length < 2) {
      return NextResponse.json(
        { error: "We could only find one person in this chat. DearChats needs a two-person conversation to build a walk." },
        { status: 400 },
      );
    }
    if (parsed.messages.length < 50) {
      return NextResponse.json(
        { error: `This chat has only ${parsed.messages.length} message${parsed.messages.length === 1 ? "" : "s"} — too few to build a memory walk. Try a chat with more history.` },
        { status: 400 },
      );
    }

    const walkId = newWalkId();
    createWalk({
      id: walkId,
      user_id: user.id,
      relationship: "romantic",
      user_name: parsed.participants[0],
      other_name: parsed.participants[1],
      user_raw_name: parsed.participants[0],
      other_raw_name: parsed.participants[1],
      raw_chat: raw,
    });

    // Both async tasks are detached. They keep running after we return
    // because Node won't GC promises with a live handle on the zip / DB.
    fireAfterResponse(() => runPhaseA(walkId));
    if (imageEntries.length > 0) {
      fireAfterResponse(() => backgroundExtractMedia(walkId, imageEntries));
    }

    return NextResponse.json({
      walkId,
      participants: parsed.participants,
      messageCount: parsed.messages.length,
      mediaCount: totalImageCount,
      // mediaSavedCount is no longer known at response time — media saves
      // happen in the background. The /api/media manifest is the source of
      // truth for what actually landed on disk.
    });
  } catch (err) {
    // Log the real error for us; show the user something they can act on
    // instead of a raw stack/internal message.
    console.error("[inspect] failed", err);
    return NextResponse.json(
      { error: "Something went wrong reading your file. Please try again — and if it keeps happening, re-export the chat from WhatsApp." },
      { status: 500 },
    );
  }
}
