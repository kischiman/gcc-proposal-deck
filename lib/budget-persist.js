// Where the budget actually lives.
//
// A file works locally, but free hosting rebuilds the container on every deploy and
// the file goes with it. So if GIST_ID and GITHUB_TOKEN are set, state is mirrored to
// a secret GitHub gist instead: durable across deploys, versioned for free, and
// costing nothing. The file remains the fallback.

import fs from "node:fs";

const GIST_ID = process.env.GIST_ID;
const TOKEN = process.env.GITHUB_TOKEN;
const FILENAME = "budget-state.json";

/**
 * BUDGET_LOCAL=1 keeps everything on disk, whatever credentials are lying around.
 *
 * Without it, running the server anywhere near a .env means the real board is the
 * board: env.js loads those credentials, the gist becomes the source, and BUDGET_FILE
 * only redirects the local copy. Testing against a throwaway file is then an illusion —
 * every write lands on the live document. That is how two test comments ended up on a
 * shared board, one of them under a real collaborator's name.
 */
const localOnly = () => process.env.BUDGET_LOCAL === "1";

export const usingGist = () => Boolean(GIST_ID && TOKEN) && !localOnly();
export const describe = () => (usingGist() ? `gist ${GIST_ID.slice(0, 8)}…` : "local file (lost on redeploy)");

const headers = () => ({
  authorization: `Bearer ${TOKEN}`,
  accept: "application/vnd.github+json",
  "content-type": "application/json",
});

async function readGist() {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, { headers: headers() });
  if (!res.ok) throw new Error(`gist read failed: ${res.status}`);
  const gist = await res.json();
  const file = gist.files?.[FILENAME];
  if (!file) return null;
  // GitHub truncates large files inline and gives a raw_url instead
  const body = file.truncated ? await (await fetch(file.raw_url)).text() : file.content;
  return JSON.parse(body);
}

async function writeGist(state) {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ files: { [FILENAME]: { content: JSON.stringify(state, null, 2) } } }),
  });
  if (!res.ok) throw new Error(`gist write failed: ${res.status} ${await res.text()}`);
}

// ---------------------------------------------------------------- interface

export async function loadInitial(file) {
  if (usingGist()) {
    try {
      const state = await readGist();
      if (state) return { state, source: "gist" };
      console.warn("[budget] gist is empty — starting from the seed");
    } catch (err) {
      // Never lose the local copy because the network blipped.
      console.error("[budget] could not read the gist:", err.message);
      throw err;
    }
  }

  try {
    return { state: JSON.parse(fs.readFileSync(file, "utf8")), source: "file" };
  } catch {
    return { state: null, source: "seed" };
  }
}

// Writes are coalesced: a burst of edits produces one round-trip, not twenty.
let pending = null;
let timer = null;
let inFlight = Promise.resolve();

/** Nothing outside /tmp is writable on a serverless host, and there is no next request
 *  on the same disk anyway — the gist is the only copy that matters there. */
const ephemeralHost = () => Boolean(process.env.VERCEL);

export function save(state, file) {
  // the local file is cheap and immediate — always keep it current
  if (!ephemeralHost()) {
    try {
      fs.writeFileSync(file, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error("[budget] could not write the local file:", err.message);
    }
  }

  if (!usingGist()) return;

  pending = state;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const snapshot = pending;
    pending = null;
    inFlight = inFlight
      .then(() => writeGist(snapshot))
      .catch((err) => console.error("[budget] gist write failed:", err.message));
  }, 1200);
}

/** Force any coalesced write out — used before the process exits. */
export async function flush() {
  clearTimeout(timer);
  if (pending) {
    const snapshot = pending;
    pending = null;
    inFlight = inFlight.then(() => writeGist(snapshot)).catch(() => {});
  }
  await inFlight;
}

/** Write now and wait for it. A serverless function is frozen the moment it answers,
 *  so a coalesced write scheduled for 1.2s later would simply never happen. */
export async function saveNow(state, file) {
  clearTimeout(timer);
  pending = null;
  if (!ephemeralHost()) {
    try {
      fs.writeFileSync(file, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error("[budget] could not write the local file:", err.message);
    }
  }
  if (!usingGist()) return;
  await writeGist(state);
}
