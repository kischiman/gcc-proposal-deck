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
export async function complete({ system, prompt, webSearch = false, maxTokens = 4000 }) {
  const which = provider();
  if (!which) throw new Error("no API key — set GEMINI_API_KEY in .env");

  const args = { system, prompt, webSearch, maxTokens };
  if (which === "gemini") return completeGemini(args);
  if (which === "openai") return completeOpenAI(args);
  return completeAnthropic(args);
}

async function completeGemini({ system, prompt, webSearch, maxTokens }) {
  const GoogleGenAI = await sdk.genai();
  const ai = new GoogleGenAI({ apiKey: geminiKey() });

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      systemInstruction: system,
      maxOutputTokens: maxTokens,
      // Google Search grounding — the Gemini equivalent of a web-search tool
      ...(webSearch ? { tools: [{ googleSearch: {} }] } : {}),
    },
  });

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
