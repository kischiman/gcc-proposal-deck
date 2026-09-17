// Answers for the Questions and Answers slide.
//
// Live path: one model call with web search enabled, so anything it cites is real and
// current. Fallback path: the library in ./library.js — used when there's no API key or
// the call fails. A presentation should never show an error where an answer should be.

import { complete, provider } from "./llm.js";
import { libraryRows } from "./library.js";

const SYSTEM = `You are a consultant answering questions live, during a working session with the senior team of a construction contractor. The subject is their talent acquisition and retention system: hiring, onboarding, training, KPIs, and keeping good people. Their stated goal is revenue growth through an economic downturn.

For each question the room asked, give one answer:

- solution — what you would actually do, in one sentence. Specific and operational: name the mechanism, not the principle.
- how — one or two sentences on how it works in practice, what it costs in effort, or the caveat that matters. If the honest answer is that this needs data they have not collected, say so.
- examples — up to two real, named precedents: a company, a programme, a standard or a published study, each with a live URL. Construction and adjacent industries are more useful here than tech.

Use web search to ground every example in something real and current. No hypotheticals, no invented case studies, no examples you are not confident exist.

Speak plainly. These are builders, not an HR audience: no jargon, no frameworks with capital letters, no filler.

Respond with JSON only — no preamble, no markdown fences, no commentary after. Shape:

{"rows":[{"question":"<restate the question in <=12 words>","theme":"<2-4 word theme>","answer":{"solution":"...","how":"...","examples":[{"name":"...","note":"...","url":"https://..."}]}}]}`;

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in response");
  return JSON.parse(candidate.slice(start, end + 1));
}

// Without search, the model can only cite what it already knows — so ask for
// well-known precedents only, and the UI says the links are unverified.
const NO_SEARCH_NOTE = `
You do not have web access for this request. Only name organisations, programmes or studies you are highly confident exist and are still current, and give their canonical homepage URL. If you are not confident about an example, leave it out rather than guessing.`;

async function callModel(questions, webSearch) {
  const text = await complete({
    system: webSearch ? SYSTEM : SYSTEM + NO_SEARCH_NOTE,
    prompt:
      "Questions from the room, in priority order:\n\n" +
      questions.map((q, i) => `${i + 1}. ${q}`).join("\n") +
      "\n\nReturn one row per question, in the same order.",
    webSearch,
    maxTokens: 16000,
  });

  const parsed = extractJson(text);
  const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
  if (rows.length === 0) throw new Error("model returned no rows");
  return rows;
}

// 503 "high demand" is usually momentary — worth several tries before downgrading,
// since the alternative is a worse answer in front of a client.
const isTransient = (err) => /\b(503|overloaded|high demand)\b/i.test(err.message);

// A quota error is a property of the key, not of the moment. Once search grounding
// reports one, stop paying five seconds a time to rediscover it this session.
const isQuota = (err) => /\b(429|quota|RESOURCE_EXHAUSTED)\b/i.test(err.message);
let groundingBlocked = false;

async function withRetry(fn, attempts = 4) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts - 1 || !isTransient(err)) throw err;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
    }
  }
}

export async function generateSolutions(questions) {
  if (!provider()) {
    return { rows: libraryRows(questions), source: "library" };
  }

  // Grounded in live search is best. Search grounding has its own quota, though,
  // so fall through to an ungrounded call before giving up on the model entirely.
  if (!groundingBlocked) {
    try {
      return { rows: await callModel(questions, true), source: "live" };
    } catch (err) {
      if (isQuota(err)) {
        groundingBlocked = true;
        console.error("[generate] search grounding is out of quota on this key — skipping it from now on");
      } else {
        console.error("[generate] grounded call failed:", err.message.slice(0, 120));
      }
    }
  }

  try {
    return { rows: await withRetry(() => callModel(questions, false)), source: "live-unverified" };
  } catch (err) {
    console.error("[generate] ungrounded call failed, using library:", err.message.slice(0, 120));
    return { rows: libraryRows(questions), source: "library" };
  }
}
