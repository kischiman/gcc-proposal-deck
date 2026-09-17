// Answers a question about the deck, strictly from the passages the page sent.
//
// The client does the retrieval; this only does the reading. With no API key the call
// throws and the page falls back to showing the passages themselves.

import { complete } from "./llm.js";

const SYSTEM = `You answer questions about a client presentation, using only the excerpts supplied with the question.

Rules:
- Answer from the excerpts alone. If they do not contain the answer, say so in one sentence and name what the deck does cover on that topic.
- Two to four sentences. No preamble, no "based on the excerpts", no bullet lists.
- Concrete over general: prefer the specific number, place, phase or finding.
- Match the deck's register — plain, precise, British spelling.
- Never invent a project, figure, or date that is not in the excerpts.`;

export async function answerFromDeck(question, passages) {
  const context = passages
    .map((p, i) => `[${i + 1}] (${p.label}${p.heading ? " — " + p.heading : ""}) ${p.text}`)
    .join("\n\n");

  return complete({
    system: SYSTEM,
    prompt: `Excerpts from the deck:\n\n${context}\n\nQuestion: ${question}`,
    maxTokens: 700,
  });
}
