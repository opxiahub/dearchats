import type { Mood } from "@/lib/types";

export interface MoodTone {
  label: string;
  color: string;       // hex
  glow: string;        // rgba string
}

export const MOOD_TONE: Record<Mood, MoodTone> = {
  tender: { label: "tender", color: "#D8A090", glow: "rgba(216,160,144,0.55)" },
  funny: { label: "funny", color: "#E0C56B", glow: "rgba(224,197,107,0.55)" },
  hard: { label: "hard", color: "#8A9BB8", glow: "rgba(138,155,184,0.5)" },
  repair: { label: "repair", color: "#A6B98E", glow: "rgba(166,185,142,0.5)" },
  forgotten: { label: "small care", color: "#F1EAD8", glow: "rgba(241,234,216,0.6)" },
  mundane_sacred: { label: "ordinary", color: "#C9A961", glow: "rgba(201,169,97,0.5)" },
};
