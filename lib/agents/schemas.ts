import type { StrictSchema } from "./client";

// OpenAI strict-mode JSON Schema rules we follow:
//   - top level must be an object (not array)
//   - every property must be listed in `required`
//   - `additionalProperties: false` everywhere
//   - nullable fields use `type: ["string", "null"]` etc.

export const SCOUT_SCHEMA: StrictSchema = {
  name: "scout_output",
  schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            keep: { type: "boolean" },
            heat: { type: "integer", enum: [0, 1, 2, 3] },
            tag: { type: "string" },
          },
          required: ["id", "keep", "heat", "tag"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
};

export const CARTOGRAPHER_SCHEMA: StrictSchema = {
  name: "cartographer_output",
  schema: {
    type: "object",
    properties: {
      chapters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              enum: ["beginnings", "becoming", "ordinary_sacred", "friction", "repair", "distance", "now"],
            },
            title: { type: "string" },
            span_start: { type: "string" },
            span_end: { type: "string" },
            mood_notes: { type: "string" },
          },
          required: ["id", "title", "span_start", "span_end", "mood_notes"],
          additionalProperties: false,
        },
      },
    },
    required: ["chapters"],
    additionalProperties: false,
  },
};

export const HISTORIAN_SCHEMA: StrictSchema = {
  name: "historian_output",
  schema: {
    type: "object",
    properties: {
      patterns: {
        type: "array",
        items: {
          type: "object",
          properties: {
            phrase: { type: "string" },
            kind: {
              type: "string",
              enum: ["nickname", "ritual", "callback_joke", "phrase", "emoji"],
            },
            started: { type: ["string", "null"] },
            stopped: { type: ["string", "null"] },
            frequency: { type: "number" },
            meaning_hint: { type: "string" },
          },
          required: ["phrase", "kind", "started", "stopped", "frequency", "meaning_hint"],
          additionalProperties: false,
        },
      },
    },
    required: ["patterns"],
    additionalProperties: false,
  },
};

// Note: CuratorOutput.diversity_check is `Record<string, number>` in the TS
// type, which strict mode can't express (no open-keyed objects). It's never
// read by the orchestrator, so we drop it from the schema. The TS type still
// allows the optional field if anything sneaks it in.
export const CURATOR_SCHEMA: StrictSchema = {
  name: "curator_output",
  schema: {
    type: "object",
    properties: {
      per_moment: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            keep: { type: "boolean" },
            score: { type: "number" },
            signatures: { type: "array", items: { type: "string" } },
            mood: {
              type: "string",
              enum: ["tender", "funny", "hard", "repair", "forgotten", "mundane_sacred"],
            },
            chapter_hint: { type: "string" },
            internal_reason: { type: "string" },
            why_not: { type: ["string", "null"] },
          },
          required: ["id", "keep", "score", "signatures", "mood", "chapter_hint", "internal_reason", "why_not"],
          additionalProperties: false,
        },
      },
      final_30: { type: "array", items: { type: "string" } },
      notes_for_narrator: { type: "string" },
    },
    required: ["per_moment", "final_30", "notes_for_narrator"],
    additionalProperties: false,
  },
};

export const SYNTHESIZER_SCHEMA: StrictSchema = {
  name: "synthesizer_output",
  schema: {
    type: "object",
    properties: {
      final_30: { type: "array", items: { type: "string" } },
      notes_for_narrator: { type: "string" },
    },
    required: ["final_30", "notes_for_narrator"],
    additionalProperties: false,
  },
};

export const FILM_DIRECTOR_SCHEMA: StrictSchema = {
  name: "film_director_output",
  schema: {
    type: "object",
    properties: {
      ordered_moment_ids: { type: "array", items: { type: "string" } },
      scene_captions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            moment_id: { type: "string" },
            caption: { type: "string" },
          },
          required: ["moment_id", "caption"],
          additionalProperties: false,
        },
      },
      opening_line: { type: "string" },
      dictionary_phrase: { type: ["string", "null"] },
      dictionary_hint: { type: ["string", "null"] },
      forgotten_moment_id: { type: ["string", "null"] },
      closing_line: { type: "string" },
    },
    required: [
      "ordered_moment_ids",
      "scene_captions",
      "opening_line",
      "dictionary_phrase",
      "dictionary_hint",
      "forgotten_moment_id",
      "closing_line",
    ],
    additionalProperties: false,
  },
};

export const NARRATOR_SCHEMA: StrictSchema = {
  name: "narrator_output",
  schema: {
    type: "object",
    properties: {
      opening_card_line: { type: "string" },
      chapter_intros: {
        type: "array",
        items: {
          type: "object",
          properties: {
            chapter_id: { type: "string" },
            line: { type: "string" },
          },
          required: ["chapter_id", "line"],
          additionalProperties: false,
        },
      },
      moment_contexts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            moment_id: { type: "string" },
            line: { type: "string" },
          },
          required: ["moment_id", "line"],
          additionalProperties: false,
        },
      },
      timeline_intro: { type: ["string", "null"] },
      private_dictionary_intro: { type: ["string", "null"] },
      forgotten_section_intro: { type: ["string", "null"] },
    },
    required: [
      "opening_card_line",
      "chapter_intros",
      "moment_contexts",
      "timeline_intro",
      "private_dictionary_intro",
      "forgotten_section_intro",
    ],
    additionalProperties: false,
  },
};
