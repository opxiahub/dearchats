import fs from "fs";
import { getClient } from "./agents/client";
import { updateMediaClassification, mediaPath, mimeFor } from "./db/media";

/**
 * Cheapest path to "does this image contain a person?":
 *   - gpt-4o-mini vision at "low" detail (~85 tokens/image, fixed)
 *   - 10 images per request
 *   - all batches fire in parallel
 *   - Strict JSON schema response, so we can rely on shape
 *
 * Cost: ~$0.0003 per image × 80 images ≈ $0.02 per walk. Hidden inside
 * Phase A wall-clock since it runs in parallel with the other LLM stages.
 */

// Vision classifier model. Defaults to the mini model env var (which is
// usually multimodal-capable for gpt-4o-mini / gpt-5.x-mini), but a dedicated
// OPENAI_VISION_MODEL overrides it when you want a separate vision endpoint.
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MINI_MODEL || "gpt-4o-mini";
const BATCH_SIZE = 10;

const CLASSIFY_SCHEMA = {
  name: "image_classifications",
  schema: {
    type: "object",
    properties: {
      classifications: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            has_person: { type: "boolean" },
            kind: { type: "string", enum: ["photo", "screenshot", "wallpaper", "other"] },
          },
          required: ["index", "has_person", "kind"],
          additionalProperties: false,
        },
      },
    },
    required: ["classifications"],
    additionalProperties: false,
  },
} as const;

const SYSTEM = `You classify images for a private digital scrapbook.
For each image return:
  has_person: true if there is at least one real human visible (face, body, silhouette, group). False for landscapes, food alone, screenshots, app UI, wallpapers, memes, forwarded graphics with no real human, drawings/cartoons.
  kind: one of "photo" (a real photograph of people/places/things from the user's life), "screenshot" (UI screenshot, app screenshot), "wallpaper" (decorative wallpaper, festival greeting, downloaded background, meme, forwarded graphic), "other" (anything else).
Respond ONLY in the JSON schema given. Order MUST match input order — set "index" to the integer position 0..N-1.`;

interface Item {
  filename: string;
  data: Buffer;
  mime: string;
}

async function classifyBatch(walkId: string, items: Item[]): Promise<void> {
  if (items.length === 0) return;
  const client = getClient();
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [
    {
      type: "text",
      text: `Classify the following ${items.length} image(s). Output one entry per image, ordered the same way (index 0..${items.length - 1}).`,
    },
  ];
  for (const it of items) {
    const b64 = it.data.toString("base64");
    content.push({
      type: "image_url",
      image_url: { url: `data:${it.mime};base64,${b64}`, detail: "low" },
    });
  }

  try {
    const resp = await client.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        // The SDK's content union covers mixed text+image arrays for vision models.
        // Cast is needed only because the generic message type is wider than the
        // image-capable subset we're using here.
        { role: "user", content: content as unknown as string },
      ],
      response_format: { type: "json_schema", json_schema: { ...CLASSIFY_SCHEMA, strict: true } },
    });
    const text = resp.choices[0]?.message?.content ?? "";
    if (!text.trim()) {
      console.warn(`[imageClassifier] empty response for batch (walk=${walkId})`);
      return;
    }
    const parsed = JSON.parse(text) as {
      classifications: Array<{ index: number; has_person: boolean; kind: string }>;
    };
    for (const c of parsed.classifications) {
      const it = items[c.index];
      if (!it) continue;
      updateMediaClassification(walkId, it.filename, c.has_person, c.kind);
    }
  } catch (err) {
    console.error("[imageClassifier] batch failed:", err);
  }
}

/**
 * Classify all images for a walk. Reads them from disk, batches them, fires
 * every batch in parallel. Fire-and-forget; safe to await or not.
 */
export async function classifyWalkImages(
  walkId: string,
  filenames: string[],
): Promise<void> {
  if (filenames.length === 0) return;
  const items: Item[] = [];
  for (const filename of filenames) {
    try {
      const fp = mediaPath(walkId, filename);
      if (!fs.existsSync(fp)) continue;
      const data = fs.readFileSync(fp);
      items.push({ filename, data, mime: mimeFor(filename) });
    } catch (e) {
      console.warn(`[imageClassifier] could not read ${filename}:`, e);
    }
  }
  if (items.length === 0) return;

  const batches: Item[][] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    batches.push(items.slice(i, i + BATCH_SIZE));
  }
  await Promise.all(batches.map((b) => classifyBatch(walkId, b)));
}
