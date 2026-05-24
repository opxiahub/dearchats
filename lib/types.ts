// Core data model for DearChats v2.
// Read CLAUDE.md before changing these shapes.

export type RelationshipType = "romantic" | "best_friend" | "sibling";

export type Gender = "male" | "female" | "nonbinary";

export interface Message {
  ts: string;              // ISO 8601
  sender: string;          // raw display name from WA export
  text: string;
  isSystem?: boolean;
}

export interface MomentCandidate {
  id: string;
  startTs: string;
  endTs: string;
  messages: Message[];
  contextBefore?: Message[];
  contextAfter?: Message[];
}

export type MomentSignature =
  | "ordinary_turned_precious"
  | "first_or_last"
  | "almost_didnt_say"
  | "care_without_ceremony"
  | "conflict_and_repair"
  | "rituals_in_motion"
  | "the_shift";

export type Mood = "tender" | "funny" | "hard" | "repair" | "forgotten" | "mundane_sacred";

export type ChapterId =
  | "beginnings"
  | "becoming"
  | "ordinary_sacred"
  | "friction"
  | "repair"
  | "distance"
  | "now";

export interface ScoutTag {
  id: string;
  keep: boolean;
  heat: 0 | 1 | 2 | 3;
  tag: string;
}

export interface CuratedMoment {
  id: string;
  score: number;
  signatures: MomentSignature[];
  mood: Mood;
  chapter_hint: ChapterId;
  internal_reason: string;
}

export interface CuratorOutput {
  per_moment: Array<CuratedMoment & { keep: boolean; why_not?: string }>;
  final_30: string[];
  diversity_check: Record<string, number>;
  notes_for_narrator: string;
}

export interface Pattern {
  phrase: string;
  kind: "nickname" | "ritual" | "callback_joke" | "phrase" | "emoji";
  started?: string;
  stopped?: string | null;
  frequency: number;
  meaning_hint: string;
}

export interface Chapter {
  id: ChapterId;
  title: string;
  span_start: string;
  span_end: string;
  mood_notes: string;
}

export type MilestoneKind =
  | "first_message"
  | "first_nickname"
  | "first_vulnerability"
  | "first_fight"
  | "biggest_repair"
  | "most_active_month"
  | "quietest_phase"
  | "longest_silence"
  | "funniest_moment"
  | "tender_peak"
  | "last_memorable";

export interface Milestone {
  id: string;
  kind: MilestoneKind;
  date: string;             // ISO date (YYYY-MM-DD)
  label: string;            // short human label, e.g. "The first message"
  ai_summary?: string;      // optional one-line context from Narrator voice
  messages?: Message[];     // optional chat snippet to reveal
}

export interface OpeningStats {
  message_count: number;
  duration_human: string;
  first_date: string;
  last_date: string;
  user_name: string;
  other_name: string;
  user_raw_name?: string;
  other_raw_name?: string;
  user_gender?: Gender;
  other_gender?: Gender;
}

export interface NarratorOutput {
  opening_card_line: string;
  chapter_intros: Array<{ chapter_id: ChapterId; line: string }>;
  moment_contexts: Array<{ moment_id: string; line: string }>;
  // New for v2:
  forgotten_section_intro?: string;       // intro line for the Forgotten Moments section
  private_dictionary_intro?: string;
  timeline_intro?: string;
}

export interface MomentOut {
  id: string;
  chapter_id: ChapterId;
  date: string;             // ISO date
  mood: Mood;
  ai_summary: string;       // front of flip card (Narrator voice)
  signatures: MomentSignature[];
  messages: Message[];      // back of flip card (real chat)
}

export interface YearSignature {
  year: number;
  is_empty: boolean;
  line: string;
  moment_count: number;
  message_count: number;
}

export interface Walk {
  session_id: string;       // walk_id
  relationship_type: RelationshipType;
  opening: OpeningStats & { line: string };
  timeline: Milestone[];
  chapters: Chapter[];
  moments: MomentOut[];
  year_signatures?: YearSignature[];   // one entry per year in the chat's range
  private_dictionary: {
    intro_line: string;
    patterns: Pattern[];
  };
  forgotten: {
    intro_line: string;
    moment_ids: string[];   // refs into moments[] where mood === 'forgotten' or relevant signatures
  };
  is_final?: boolean;
}

export type ProcessingStage =
  | "parsing"
  | "segmenting"
  | "scouting"
  | "patterns"
  | "arc"
  | "awaiting_relationship"
  | "curating"
  | "narrating"
  | "done"
  | "error";

export interface ProcessingStatus {
  session_id: string;
  stage: ProcessingStage;
  progress: number;
  vignettes: string[];
  error?: string;
  partial_ready?: boolean;
  done?: boolean;
}
