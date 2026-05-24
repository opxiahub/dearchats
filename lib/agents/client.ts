import OpenAI from "openai";

let _client: OpenAI | null = null;

export function getClient(): OpenAI {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set. Add it to .env.local.");
    }
    _client = new OpenAI();
  }
  return _client;
}

// Model selection is driven by env vars so the same code works against
// gpt-5.x, gpt-4o, o-series, local OpenAI-compatible endpoints, etc.
// `OPENAI_MAIN_MODEL` powers the taste-heavy roles (curator, narrator,
// synthesizer); `OPENAI_MINI_MODEL` powers the bulk/utility roles.
const MAIN_MODEL = process.env.OPENAI_MAIN_MODEL || "gpt-5.4";
const MINI_MODEL = process.env.OPENAI_MINI_MODEL || "gpt-5.4-mini";

export const MODELS = {
  scout: MINI_MODEL,
  curator: MAIN_MODEL,
  historian: MINI_MODEL,
  cartographer: MINI_MODEL,
  openingScribe: MINI_MODEL,
  narrator: MAIN_MODEL,
  letter: MAIN_MODEL,
} as const;

type ModelName = string;

export interface StrictSchema {
  name: string;
  schema: Record<string, unknown>;
}

export async function runTextModel(input: {
  model: ModelName;
  system: string;
  user: string;
  maxTokens: number;
  json?: boolean;
  schema?: StrictSchema;
}): Promise<string> {
  const client = getClient();

  // Pick the strongest available response_format:
  //   - schema present → json_schema strict (guaranteed valid JSON matching shape)
  //   - json: true     → json_object (guaranteed valid JSON, no shape constraint)
  //   - neither        → free-form text
  const responseFormat = input.schema
    ? {
        type: "json_schema" as const,
        json_schema: { name: input.schema.name, strict: true, schema: input.schema.schema },
      }
    : input.json
      ? { type: "json_object" as const }
      : undefined;

  async function call() {
    // No max_completion_tokens, no reasoning_effort — keeps the call
    // compatible across model families (gpt-5.x, gpt-4o, o-series, local
    // OpenAI-compatible endpoints). Each model uses its own defaults.
    const resp = await client.chat.completions.create({
      model: input.model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      ...(responseFormat ? { response_format: responseFormat } : {}),
    });
    const choice = resp.choices[0];
    return {
      text: choice?.message?.content ?? "",
      finishReason: choice?.finish_reason ?? "",
      usage: resp.usage,
    };
  }

  const first = await call();
  if (first.text && first.text.trim().length > 0) return first.text;

  // Empty output — retry once.
  console.warn(
    `[runTextModel] empty output from ${input.model} (finish=${first.finishReason}, usage=${JSON.stringify(first.usage)}). Retrying.`,
  );
  const retry = await call();
  if (!retry.text || retry.text.trim().length === 0) {
    console.warn(
      `[runTextModel] retry also empty from ${input.model} (finish=${retry.finishReason}, usage=${JSON.stringify(retry.usage)}).`,
    );
  }
  return retry.text;
}

/**
 * Run a model that should return JSON. Combines:
 *   1. JSON-mode on the API call (guarantees the output is parseable JSON)
 *   2. A repair retry — if parsing OR caller-supplied validation fails, send
 *      the broken text back to the same model with "fix this" instructions
 *      and parse the second response.
 *
 * Pass a `validate` predicate to assert the parsed object has the shape the
 * caller expects (required keys present, arrays are arrays, etc). If
 * validation fails, the repair pass also receives a `shapeHint` describing
 * what the model should produce.
 */
/**
 * Run a model that should return JSON. Layers (each is a safety net for the next):
 *   1. PRIMARY: `schema` → json_schema strict mode. API itself refuses to emit
 *      anything off-spec, so the typical path is zero retries.
 *   2. POST-PARSE check via the caller's `validate` predicate (catches the
 *      rare edge case where the API still returns something unexpected, e.g.
 *      empty string after token-budget exhaustion).
 *   3. REPAIR: if parse OR validate fails, send the broken output back to the
 *      same model with the `shapeHint` and ask it to fix it. The repair pass
 *      uses json_object (not json_schema) so an off-spec response can at
 *      least round-trip through the editor.
 */
export async function runJSONModel<T>(input: {
  model: ModelName;
  system: string;
  user: string;
  maxTokens: number;
  schema?: StrictSchema;
  validate?: (parsed: unknown) => parsed is T;
  shapeHint?: string;
}): Promise<T> {
  const firstText = await runTextModel({
    model: input.model,
    system: input.system,
    user: input.user,
    maxTokens: input.maxTokens,
    schema: input.schema,
    json: input.schema ? false : true,
  });

  let firstError: unknown = null;
  try {
    const parsed = extractJSON<unknown>(firstText);
    if (!input.validate || input.validate(parsed)) return parsed as T;
    firstError = new Error("validation failed");
  } catch (e) {
    firstError = e;
  }

  console.warn(
    `[runJSONModel] ${input.model} returned unusable JSON (${firstError instanceof Error ? firstError.message : String(firstError)}). Asking model to repair.`,
  );

  const repairSystem = "You repair malformed or off-spec JSON. Return ONLY the corrected JSON object, no commentary, no markdown fences.";
  const repairUser = [
    "The following was supposed to be valid JSON" + (input.shapeHint ? ` matching this shape:\n${input.shapeHint}` : "") + ".",
    "It was either malformed or did not match the required shape.",
    "Return ONLY the corrected JSON (no prose).",
    "",
    "ORIGINAL OUTPUT:",
    firstText.slice(0, 12000),
  ].join("\n");

  const repaired = await runTextModel({
    model: input.model,
    system: repairSystem,
    user: repairUser,
    maxTokens: input.maxTokens,
    json: true,
  });

  const parsed = extractJSON<unknown>(repaired);
  if (input.validate && !input.validate(parsed)) {
    throw new Error("Repaired JSON still did not match required shape");
  }
  return parsed as T;
}

/**
 * Try to extract a JSON object/array from a model response. Handles
 * markdown code fences and stray prose around the JSON.
 */
function extractJSON<T = unknown>(text: string): T {
  // Strip markdown fences
  let s = text.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();
  // Find first { or [ and balance to its match
  const first = s.search(/[{\[]/);
  if (first === -1) {
    throw new Error(`No JSON found in response: ${text.slice(0, 200)}`);
  }
  const open = s[first];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = first; i < s.length; i++) {
    const c = s[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === "\\") {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error("Unterminated JSON in response");
  return JSON.parse(s.slice(first, end + 1));
}
