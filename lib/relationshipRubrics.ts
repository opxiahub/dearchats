import type { RelationshipType } from "./types";

export const RUBRICS: Record<RelationshipType, string> = {
  romantic: `This is a romantic chat. Weight these higher:

- The arc of intimacy: first flirt, first vulnerability, first fight,
  first repair, first "I love you", first long silence, first goodbye-
  and-return.
- Soft rituals: nightly check-ins, pet names being born, recurring
  "good morning" / "thinking of you" patterns. Pay special attention
  to when these START and when they STOP.
- Longing during physical or emotional distance. A "I wish you were
  here" hits differently when you can see they were apart for months.
- Repairs after conflict. The apology that landed. The one that didn't.
- The unspoken made spoken: a confession that took weeks of buildup.
- The mundane that aged into precious: errands, groceries, the
  "remember to take your meds" that ran for years.

Avoid:
- Picking only the dramatic peaks (fights, breakups, reconciliations).
  The walk should also surface the calm — the years where nothing
  happened and everything happened.
- Sexual or explicit content unless it is emotionally load-bearing
  AND tasteful in context. Default: skip.`,

  best_friend: `This is a best-friend chat. Weight these higher:

- Loyalty in low moments: showing up at 2am, the rant the other person
  let them have, the time one of them was breaking and the other knew.
- Roasts and callback jokes: a punchline that recurs across years is
  more valuable than a single witty exchange. Find the running bits.
- Chaos and consequence: stupid plans, near-disasters, "I cannot
  BELIEVE we did that" — the friendship's mythology.
- The check-ins that don't announce themselves: "you good?" after
  one of them went quiet for a few days.
- Shared struggle: career anxiety, family stuff, dating disasters
  workshopped over weeks.
- The accidentally sincere: a moment of honesty smuggled inside a joke.

Avoid:
- Mistaking volume for closeness. Best friend chats have a lot of
  noise; the signal is often the rare slowdown into seriousness.
- Selecting moments that need an outside reference to land (a meme,
  a celebrity, a news event the user won't remember in 5 years).`,

  sibling: `This is a sibling chat. Weight these higher:

- Teasing that is love in disguise. The nicknames, the digs, the
  "shut up"s that mean "I see you."
- Family-coded references: parents, grandparents, family events,
  childhood callbacks. These are sacred in sibling chats and almost
  absent in other relationship types.
- Casual care: "did you eat", "send the doc", "tell mom I called" —
  the logistics that ARE the love language.
- Protective moments: defending each other, warning each other,
  the one time one of them was unusually serious.
- The rare direct expression of love or pride. In sibling chats it is
  often disguised, indirect, or appears once a year. When it appears
  undisguised, that moment is gold.
- Errands, planning family events, splitting responsibilities — the
  scaffolding of adult sibling life.

Avoid:
- Picking moments that feel like a friendship — sibling chats have a
  texture friendships don't. The product should honor that difference.
- Romanticizing or sanitizing conflict. Sibling fights are often
  short, sharp, and forgotten by the next message. That is part of
  what makes the bond what it is.`,
};

export const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  romantic: "Romantic Partner",
  best_friend: "Best Friend",
  sibling: "Sibling",
};

export const RELATIONSHIP_BLURBS: Record<RelationshipType, string> = {
  romantic: "Affection, distance, repair, and everything that lived in between.",
  best_friend: "The chaos, the loyalty, and the nonsense that held it together.",
  sibling: "The teasing, the casual care, and the childhood that never quite leaves.",
};
