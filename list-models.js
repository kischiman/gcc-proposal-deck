// `npm run models` — shows which models your key can actually use, so you can set
// GEMINI_MODEL / OPENAI_MODEL in .env to something real rather than guessing.

import "./lib/env.js";
import { provider } from "./lib/llm.js";

const which = provider();

if (!which) {
  console.error("\nNo API key found in .env — nothing to list.\n");
  process.exit(1);
}

if (which === "gemini") {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY });

  const ids = [];
  for await (const model of await ai.models.list()) {
    const id = (model.name || "").replace(/^models\//, "");
    if (id.startsWith("gemini")) ids.push(id);
  }
  ids.sort();

  console.log("\nGemini models available to this key:\n");
  for (const id of ids) console.log("  " + id);
  console.log("\nSet one in .env:  GEMINI_MODEL=" + (ids[0] || "gemini-2.5-flash") + "\n");
} else if (which === "openai") {
  const { default: OpenAI } = await import("openai");
  const { data } = await new OpenAI().models.list();

  const ids = data
    .map((m) => m.id)
    .filter((id) => id.startsWith("gpt-") && !/audio|realtime|image|transcribe|tts|search-preview/.test(id))
    .sort();

  console.log("\nChat models available to this key:\n");
  for (const id of ids) console.log("  " + id);
  console.log("\nSet one in .env:  OPENAI_MODEL=" + (ids[ids.length - 1] || "gpt-5.5") + "\n");
} else {
  console.log("\nUsing Anthropic. Model ids are listed at docs.anthropic.com/en/docs/about-claude/models\n");
}
