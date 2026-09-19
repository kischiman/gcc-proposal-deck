// The application: routing, state and the pages it serves.
//
// It does not listen. server.js opens the port first and loads this afterwards, so a
// fault in here cannot stop the host seeing a live port — it reports the fault instead.
// Serves the big-screen deck (/) and the phone companion (/m), and keeps the two
// in sync over Server-Sent Events. No database, no build step — state lives in memory
// for the duration of the talk.

import "./lib/env.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { generateSolutions } from "./lib/generate.js";
import { answerFromDeck } from "./lib/ask.js";
import { providerLabel } from "./lib/llm.js";
import * as budget from "./lib/budget-store.js";
import { PAGES } from "./private/pages.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "public");
const PORT = Number(process.env.PORT) || 4400;

// ---------------------------------------------------------------- state

// Shared content, not a shared screen: everyone browses on their own and sees the
// same material as each other's changes land. It lives in the persisted document
// rather than in this process, because on a serverless host there is no process to
// come back to.
const IDLE = { status: "idle", source: null, rows: [], error: null, startedAt: null, finishedAt: null };

const workshop = () => budget.getWorkshop();
const deckState = () => ({
  bottlenecks: workshop().bottlenecks,
  generation: workshop().generation || IDLE,
});

/** Everything mutating goes through here: write the document out and wait for it. */
const persistAll = () => budget.commit();

// ---------------------------------------------------------------- helpers

function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) reject(new Error("body too large"));
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function serveStatic(res, relPath) {
  const filePath = path.join(PUBLIC, relPath);
  if (!filePath.startsWith(PUBLIC)) return json(res, 403, { error: "forbidden" });
  fs.readFile(filePath, (err, data) => {
    if (err) return json(res, 404, { error: "not found" });
    res.writeHead(200, {
      "content-type": MIME[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(data);
  });
}

function lanAddress() {
  for (const iface of Object.values(os.networkInterfaces()).flat()) {
    if (iface && iface.family === "IPv4" && !iface.internal) return iface.address;
  }
  return "localhost";
}

// The address to put on the big screen for the phone to open.
// Deployed, that is whatever host the browser used; locally it is the LAN IP,
// since a phone cannot reach "localhost".
function companionUrl(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const proto = req.headers["x-forwarded-proto"] || "http";
  const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i.test(host);
  if (host && !local) return `${proto}://${host}/m`;
  return `http://${lanAddress()}:${PORT}/m`;
}

// ---------------------------------------------------------------- admin access
//
// The admin panel and the team view change shared state, so they cannot stand open on a
// public URL. ADMIN_PASSWORD gates them.
//
// Unset behaves differently by where this runs: locally it stays open, because a laptop
// with no password set is a laptop, not an exposure; on a managed host it is treated as
// "not configured" and the routes answer 404. Forgetting to set the variable therefore
// hides the panel rather than publishing it.

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const hosted = () => Boolean(process.env.VERCEL);
const adminConfigured = () => ADMIN_PASSWORD.length > 0;

/** Is there an admin surface at all on this deployment? */
const adminAvailable = () => adminConfigured() || !hosted();

/** The cookie carries a digest of the password, so the password itself is never stored
 *  in the browser and never travels on anything but the sign-in request. */
const adminToken = () =>
  crypto.createHash("sha256").update(`gcc-deck:${ADMIN_PASSWORD}`).digest("hex").slice(0, 32);

/** Compare without leaking length or content through timing. */
function sameSecret(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function signedIn(req) {
  if (!adminConfigured()) return false;
  const jar = String(req.headers.cookie || "");
  const hit = jar.split(";").map((c) => c.trim()).find((c) => c.startsWith("deck_admin="));
  return Boolean(hit) && sameSecret(hit.slice("deck_admin=".length), adminToken());
}

/** Open locally with nothing configured; otherwise the cookie decides. */
const adminAllowed = (req) => (!adminConfigured() && !hosted()) || signedIn(req);

const SIGN_IN_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sign in</title>
<style>
  :root { --paper:#fbfaf7; --ink:#17150f; --muted:#6e675a; --rule:#e3ded2; --accent:#b03a1a; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100dvh; display:grid; place-items:center; background:var(--paper);
         color:var(--ink); font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif; padding:24px; }
  form { width:100%; max-width:340px; background:#fff; border:1px solid var(--rule); border-radius:10px; padding:26px 24px; }
  h1 { font-size:17px; margin:0 0 4px; }
  p { margin:0 0 18px; font-size:13.5px; color:var(--muted); }
  label { display:block; font-size:12px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); margin-bottom:7px; }
  input { width:100%; font:inherit; padding:11px 13px; border:1px solid var(--rule); border-radius:8px; background:var(--paper); color:var(--ink); }
  input:focus { outline:none; border-color:var(--accent); }
  button { width:100%; margin-top:14px; font:inherit; padding:11px; border:1px solid var(--ink);
           background:var(--ink); color:var(--paper); border-radius:8px; cursor:pointer; }
  button:hover { opacity:.88; }
  .err { margin:12px 0 0; font-size:13px; color:var(--accent); min-height:18px; }
</style>
</head>
<body>
<form id="f">
  <h1>General Construction Co.</h1>
  <p>This page changes shared state, so it asks first.</p>
  <label for="password">Password</label>
  <input id="password" type="password" autocomplete="current-password" autofocus />
  <button type="submit">Sign in</button>
  <p class="err" id="err" role="alert"></p>
</form>
<script>
  const f = document.getElementById("f");
  const err = document.getElementById("err");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: document.getElementById("password").value }),
    }).catch(() => null);
    if (res && res.ok) return location.reload();
    err.textContent = res && res.status === 401 ? "That password does not match." : "Could not sign in — try again.";
  });
</script>
</body>
</html>`;

function serveSignIn(res) {
  res.writeHead(401, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(SIGN_IN_PAGE);
}

/** The gated pages come from a generated module rather than public/.
 *
 *  A managed host serves everything in public/ from its CDN before a request reaches
 *  this code, so a page kept there cannot be gated at all — /admin.html was answering
 *  200 to anyone who asked. These arrive as imported strings, which also survives
 *  serverless bundling, where an untraced fs read of a loose file may find nothing. */
function servePage(res, name) {
  const body = PAGES[name];
  if (!body) return json(res, 500, { error: `page missing from the bundle: ${name}` });
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

// ---------------------------------------------------------------- routes


export async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  // Another machine may have served the last request. Re-read before answering, so
  // nobody is shown a copy from a previous invocation — and so a write is applied to
  // the board as it stands rather than as this instance last remembered it.
  //
  // If that read fails, say so and stop. What is in memory is the seed, and answering
  // from it would show an empty board — worse, a write would then save that seed over
  // the real one. Refusing is the only safe thing to do.
  if (pathname.startsWith("/api/") && pathname !== "/api/info") {
    try {
      await budget.reload();
    } catch (err) {
      console.error("[budget] could not read the store:", err.message);
      return json(res, 503, {
        error: "Could not reach the budget store. Nothing has been changed.",
        detail: err.message,
      });
    }
  }

  // --- pages
  if (pathname === "/") return serveStatic(res, "index.html");
  if (pathname === "/m" || pathname === "/mobile") return serveStatic(res, "mobile.html");
  if (pathname === "/budget") return serveStatic(res, "budget.html");
  // The budget panel and the team view are gated — they write to the shared board.
  if (pathname === "/admin" || pathname === "/budgets" || pathname === "/budget-admin") {
    if (!adminAvailable()) return json(res, 404, { error: "not found" });
    if (!adminAllowed(req)) return serveSignIn(res);
    return servePage(res, "admin.html");
  }
  // The team's view of the process: proposals and comments together.
  if (pathname === "/team") {
    if (!adminAvailable()) return json(res, 404, { error: "not found" });
    if (!adminAllowed(req)) return serveSignIn(res);
    return servePage(res, "team.html");
  }

  // --- budget: shared state, so everyone with the link sees the same numbers.
  // The base rate card is not in this payload unless the admin has opted in.
  if (pathname === "/api/budget") return json(res, 200, budget.publicView());

  // The team page reads everything; the switches govern the public deck, not this.
  if (pathname === "/api/team") {
    if (!adminAllowed(req)) return json(res, 401, { error: "sign in at /admin" });
    return json(res, 200, budget.teamView());
  }

  if (pathname === "/api/admin/state") {
    if (!adminAllowed(req)) return json(res, 401, { error: "sign in at /admin" });
    return json(res, 200, { ...budget.adminView(), storage: budget.storageInfo() });
  }


  if (pathname === "/api/budget/export") {
    if (!adminAllowed(req)) return json(res, 401, { error: "sign in at /admin" });
    res.writeHead(200, {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="budget-${new Date().toISOString().slice(0, 10)}.json"`,
    });
    return res.end(JSON.stringify(budget.getState(), null, 2));
  }

  // --- live state stream

  if (pathname === "/api/state") return json(res, 200, deckState());

  if (pathname === "/api/info") {
    return json(res, 200, {
      companionUrl: companionUrl(req),
      provider: providerLabel(),
    });
  }

  // --- mutations
  if (req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }

    // --- admin sign-in: trades the password for a cookie carrying only a digest of it
    if (pathname === "/api/auth") {
      if (!adminConfigured()) return json(res, 404, { error: "not found" });
      if (!sameSecret(body.password || "", ADMIN_PASSWORD)) {
        return json(res, 401, { error: "wrong password" });
      }
      const secure = hosted() ? " Secure;" : "";
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "set-cookie": `deck_admin=${adminToken()}; Path=/; HttpOnly; SameSite=Lax;${secure} Max-Age=43200`,
      });
      return res.end(JSON.stringify({ ok: true }));
    }

    // --- admin-only mutations: the rate card, assignment, and the prefill switch
    if (pathname.startsWith("/api/admin/")) {
      if (!adminAllowed(req)) return json(res, 401, { error: "sign in at /admin" });
      const action = pathname.slice("/api/admin/".length);

      // Removing a phase can be refused for a reason worth reading — "3 lines are still
      // on it" — so it answers on its own rather than through the yes/no map below.
      if (action === "phase-remove") {
        const outcome = budget.removePhase(body.id);
        if (!outcome.ok) return json(res, 409, { error: outcome.error });
        await persistAll();
        return json(res, 200, { ok: true, totals: budget.totals() });
      }
      const ok =
        action === "rate" ? budget.setRate(body.key, body.value)
        : action === "phase-owner" ? budget.setPhaseOwner(body.phase, body.name)
        : action === "phase-add" ? budget.addPhase(body)
        : action === "phase-update" ? budget.updatePhase(body.id, body)
        : action === "phase-reorder" ? budget.reorderPhases(body.ids)
        : action === "expense" ? budget.setExpense(body.id, body.value)
        : action === "prefill" ? budget.setPrefill(body.id, body.value)
        : action === "hidden" ? budget.setHidden(body.id, body.value)
        : action === "prefill-all" ? budget.setPrefillAll(body.value)
        : action === "public-money" ? budget.setPublicMoney(body.value)
        : action === "public-proposals" ? budget.setPublicProposals(body.value)
        : action === "public-comments" ? budget.setPublicComments(body.value)
        : action === "comment-remove" ? budget.removeComment(body.id, body.commentId)
        : action === "assign" ? budget.assign(body.id, body.proposalId)
        : action === "update" ? budget.updateTask(body.id, body)
        : action === "proposal-update" ? budget.updateProposal(body.id, body.proposalId, body)
        : action === "proposal-remove" ? budget.withdraw(body.id, body.proposalId)
        : action === "task" ? budget.addTask(body)
        : action === "remove" ? budget.removeTask(body.id)
        : action === "reorder" ? budget.reorderTasks(body.phase, body.ids)
        : action === "import" ? budget.replaceState(body.state)
        : action === "reset" ? (budget.reset(), true)
        : null;

      if (ok === null) return json(res, 404, { error: "unknown admin action" });
      if (!ok) return json(res, 400, { error: "could not apply" });

      await persistAll();
      return json(res, 200, { ok: true, totals: budget.totals() });
    }

    // --- public: anyone with the link can propose themselves and add tasks
    if (pathname.startsWith("/api/budget/")) {
      const action = pathname.slice("/api/budget/".length);
      const ok =
        action === "propose" ? budget.propose(body.id, body)
        : action === "comment" ? budget.addComment(body.id, body, "public")
        : action === "withdraw" ? budget.withdraw(body.id, body.proposalId)
        : action === "task" ? budget.addTask(body)
        : null;

      if (ok === null) return json(res, 404, { error: "unknown budget action" });
      if (!ok) return json(res, 400, { error: "could not apply" });

      await persistAll();
      return json(res, 200, { ok: true });
    }

    // The team's own comments. A separate route rather than a flag, so which page a
    // comment came from is a fact about how it arrived, not something a caller asserts.
    if (pathname === "/api/team/comment") {
      if (!adminAllowed(req)) return json(res, 401, { error: "sign in at /admin" });
      if (!budget.addComment(body.id, body, "team")) return json(res, 400, { error: "could not apply" });
      await persistAll();
      return json(res, 200, { ok: true });
    }

    // Ask-this-document. Retrieval happens in the page; this only reads the passages.
    // Deliberately not part of `state` — one person's question is not the room's.
    if (pathname === "/api/ask") {
      const q = String(body.q || "").trim().slice(0, 300);
      const passages = Array.isArray(body.passages) ? body.passages.slice(0, 8) : [];
      if (!q || passages.length === 0) return json(res, 400, { error: "nothing to answer from" });
      try {
        return json(res, 200, { answer: await answerFromDeck(q, passages) });
      } catch (err) {
        console.error("[ask] falling back to passages:", err.message);
        return json(res, 200, { answer: null });
      }
    }

    if (pathname === "/api/bottlenecks") {
      const text = String(body.text || "").trim().slice(0, 240);
      if (!text) return json(res, 400, { error: "empty" });
      const w = workshop();
      w.bottlenecks.push({ id: w.nextId++, text });
      await persistAll();
      return json(res, 200, { ok: true });
    }

    if (pathname === "/api/bottlenecks/update") {
      const item = workshop().bottlenecks.find((b) => b.id === Number(body.id));
      const text = String(body.text || "").trim().slice(0, 240);
      if (item && text) {
        item.text = text;
        await persistAll();
      }
      return json(res, 200, { ok: true });
    }

    if (pathname === "/api/bottlenecks/delete") {
      const w = workshop();
      w.bottlenecks = w.bottlenecks.filter((b) => b.id !== Number(body.id));
      await persistAll();
      return json(res, 200, { ok: true });
    }

    if (pathname === "/api/bottlenecks/reorder") {
      const order = Array.isArray(body.ids) ? body.ids.map(Number) : [];
      const w = workshop();
      const byId = new Map(w.bottlenecks.map((b) => [b.id, b]));
      const reordered = order.map((id) => byId.get(id)).filter(Boolean);
      // anything the client didn't know about stays at the end
      for (const b of w.bottlenecks) if (!order.includes(b.id)) reordered.push(b);
      w.bottlenecks = reordered;
      await persistAll();
      return json(res, 200, { ok: true });
    }

    if (pathname === "/api/generate") {
      const w = workshop();
      if (w.bottlenecks.length === 0) {
        return json(res, 400, { error: "no bottlenecks captured yet" });
      }
      // Awaited rather than fired off: a serverless function is frozen the moment it
      // answers, so a promise settling afterwards would never be seen by anyone.
      const startedAt = Date.now();
      try {
        const { rows, source } = await generateSolutions(w.bottlenecks.map((b) => b.text));
        w.generation = { status: "done", source, rows, error: null, startedAt, finishedAt: Date.now() };
      } catch (err) {
        w.generation = { status: "error", source: null, rows: [], error: err.message, startedAt, finishedAt: Date.now() };
      }
      await persistAll();
      return json(res, 200, { ok: true, generation: w.generation });
    }

    if (pathname === "/api/reset") {
      const w = workshop();
      w.bottlenecks = [];
      w.nextId = 1;
      w.generation = null;
      await persistAll();
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: "unknown endpoint" });
  }

  // --- static assets
  return serveStatic(res, pathname.replace(/^\//, ""));
}



// No top-level await anywhere in this file. A serverless builder may emit CommonJS,
// where it is a syntax error, and the whole function then fails to start.

// Coalesced writes could otherwise be dropped by a shutdown mid-deploy.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, async () => {
    await budget.flush().catch(() => {});
    process.exit(0);
  });
}

// State must be loaded before the first request, or a visitor could be served the
// seed and then overwrite the real thing — so listen only once it is in.
//
// Wrapped rather than awaited at the top level: a serverless builder may emit
// CommonJS, where top-level await is a syntax error and the function never starts.

/** A request, for a host that imports this file and calls it.
 *
 *  Which file a host decides is "the entrypoint" is not something to be clever about:
 *  it picked server.js, then picked app.js the moment the two were split, and a handler
 *  on the wrong one is no handler at all. Both files export one now, so whichever it
 *  reaches for, there is something to call. `handle` reloads the document per request,
 *  so this path needs no start-up of its own.
 */
export default async function serve(req, res) {
  try {
    await handle(req, res);
  } catch (err) {
    console.error(`[500] ${req.method} ${req.url}:`, err.stack || err.message);
    if (res.headersSent) return res.end();
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: err.message || "server error" }));
  }
}

/** Load the document. The port is already open; this only fills it in. */
export const init = () => budget.init();

export const storageInfo = () => budget.storageInfo();
export const provider = () => providerLabel();
export const lan = () => lanAddress();
