// Offline fallback for the Questions and Answers slide.
//
// Used when there's no API key, or when the live call fails mid-talk. It is deliberately
// empty of content for this proposal: no themes are defined yet, so every question falls
// through to GENERIC, which says plainly that the answer has to come from the room rather
// than inventing one in front of a client.
//
// To give the fallback real substance, add entries to THEMES. Each needs an id, a label,
// the keywords that should match it, and an `answer` with a one-sentence `solution`, an
// optional `how`, and any examples worth naming.

export const THEMES = [];

const GENERIC = {
  id: "generic",
  label: "Unanswered",
  answer: {
    solution: "No answer is on file for this one yet.",
    how: "Captured so it is not lost. Answer it in the room, or add it to the library before the next session.",
    examples: [],
  },
};

export function matchTheme(text) {
  const lower = text.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const theme of THEMES) {
    const score = theme.keys.reduce((n, key) => (lower.includes(key) ? n + key.length : n), 0);
    if (score > bestScore) {
      bestScore = score;
      best = theme;
    }
  }
  return best || GENERIC;
}

export function libraryRows(questions) {
  return questions.map((text) => {
    const theme = matchTheme(text);
    return { question: text, theme: theme.label, answer: theme.answer };
  });
}
