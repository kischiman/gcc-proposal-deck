// Model provider for the deck's two live features.
//
// Whichever key is in .env is the one used — Gemini, OpenAI or Anthropic, in that order.
// No key at all: both features fall back to their offline paths and the deck still works.

// Loaded when one is actually called, not when this file is read.
//
// These are heavy packages, and one of them pulls in protobufjs, whose postinstall does
// not always get to run on a managed host. Imported at the top, a package that throws on
// load takes the whole server down before it can listen — and the deck, which does not
// need a model at all, goes with it. Behind a function they can only break the feature
// that asked for them.
const sdk = {
  openai: () => import("openai").then((m) => m.default),
  anthropic: () => import("@anthropic-ai/sdk").then((m) => m.default),
  genai: () => import("@google/genai").then((m) => m.GoogleGenAI),
};

// Override any of these in .env. `npm run models` lists what your key can actually use.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.7-flash";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.5";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

const geminiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

export function provider() {
  if (geminiKey()) return "gemini";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

export function providerLabel() {
  const p = provider();
  if (p === "gemini") return `Gemini · ${GEMINI_MODEL}`;
  if (p === "openai") return `OpenAI · ${OPENAI_MODEL}`;
  if (p === "anthropic") return `Anthropic · ${ANTHROPIC_MODEL}`;
  return null;
}

/**
 * One text completion.
 *
 * @param {object}  opts
 * @param {string}  opts.system      instructions for the model
 * @param {string}  opts.prompt      the user turn
 * @param {boolean} [opts.webSearch] let the model search the web before answering
 * @param {number}  [opts.maxTokens]
 * @returns {Promise<string>} the model's text
 */
export async function complete({ system, prompt, webSearch = false, maxTokens = 4000, quick = false }) {
  const which = provider();
  if (!which) throw new Error("no API key — set GEMINI_API_KEY in .env");

  const args = { system, prompt, webSearch, maxTokens, quick };
  if (which === "gemini") return completeGemini(args);
  if (which === "openai") return completeOpenAI(args);
  return completeAnthropic(args);
}

// When a model is overloaded or unavailable, the next one answers instead.
const GEMINI_FALLBACKS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite"];
const retryable = (err) =>
  /\b(429|500|503|404)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand|not found|abort|timed? ?out/i.test(String(err?.message || err));

async function completeGemini(args) {
  const models = [GEMINI_MODEL, ...GEMINI_FALLBACKS.filter((m) => m !== GEMINI_MODEL)];
  let last;
  for (const model of models) {
    try {
      return await completeGeminiWith(model, args);
    } catch (err) {
      last = err;
      if (!retryable(err)) throw err;
      console.warn(`[llm] ${model} unavailable (${String(err?.message || err).slice(0, 80)}), trying the next model`);
    }
  }
  throw last;
}

async function completeGeminiWith(model, { system, prompt, webSearch, maxTokens, quick }, think = true) {
  const GoogleGenAI = await sdk.genai();
  const ai = new GoogleGenAI({ apiKey: geminiKey() });

  let response;
  try {
    response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction: system,
      maxOutputTokens: maxTokens,
      // a slow model gives way to the next one rather than holding the page
      abortSignal: AbortSignal.timeout(webSearch ? 90_000 : (quick ? 5_000 : 9_000)),
      // a short answer from given excerpts needs little reasoning, and hidden reasoning
      // counts against maxOutputTokens, which cut answers off mid-sentence
      ...(quick && think ? { thinkingConfig: { thinkingLevel: "MINIMAL" } } : {}),
      // Google Search grounding — the Gemini equivalent of a web-search tool
      ...(webSearch ? { tools: [{ googleSearch: {} }] } : {}),
    },
  });
  } catch (err) {
    if (quick && think && /thinking/i.test(String(err?.message))) {
      return completeGeminiWith(model, { system, prompt, webSearch, maxTokens, quick }, false);
    }
    throw err;
  }

  const text = response.text?.trim();
  if (!text) throw new Error("empty response");
  return text;
}

async function completeOpenAI({ system, prompt, webSearch, maxTokens }) {
  const OpenAI = await sdk.openai();
  const client = new OpenAI();

  const response = await client.responses.create({
    model: OPENAI_MODEL,
    instructions: system,
    input: prompt,
    max_output_tokens: maxTokens,
    ...(webSearch ? { tools: [{ type: "web_search" }] } : {}),
  });

  const text = response.output_text?.trim();
  if (!text) throw new Error("empty response");
  return text;
}

async function completeAnthropic({ system, prompt, webSearch, maxTokens }) {
  const Anthropic = await sdk.anthropic();
  const client = new Anthropic();

  const message = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
    ...(webSearch
      ? { tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 12 }] }
      : {}),
  });

  if (message.stop_reason === "refusal") throw new Error("model declined the request");

  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  if (!text) throw new Error("empty response");
  return text;
}
