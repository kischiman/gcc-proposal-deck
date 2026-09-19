// The entrypoint. Its only job is to open the port, and to keep it open.
//
// Managed hosts start this file and wait for it to listen before sending any traffic.
// If anything the application needs throws while being loaded — a package whose install
// script never ran, a missing file, a bad import — and that load happens before the
// port opens, the host sees a process that never started. What it reports is that the
// function crashed, with the reason only in logs the person debugging may not be able
// to reach. A whole afternoon can go into guessing at it.
//
// So: listen first, load second, and if the load fails, say so in the response.

import http from "node:http";

const PORT = Number(process.env.PORT) || 4400;

let app = null;
let bootError = null;

/** One request, however it arrived. */
async function serve(req, res) {
  if (app) {
    try {
      return await app.handle(req, res);
    } catch (err) {
      console.error(`[500] ${req.method} ${req.url}:`, err.stack || err.message);
      if (res.headersSent) return res.end();
      res.writeHead(500, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: err.message || "server error" }));
    }
  }

  if (!bootError) await loading;   // first request may arrive mid-load

  // Still loading, or it failed. Either way the port is open and the answer is honest.
  res.writeHead(bootError ? 500 : 503, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(
    JSON.stringify(
      bootError
        ? {
            error: "the application failed to load",
            detail: bootError.message,
            stack: String(bootError.stack || "").split("\n").slice(0, 8),
          }
        : { error: "starting up — try again in a moment" },
      null,
      2
    )
  );
}

// Two ways in, because hosts differ and guessing which one is in use cost a day.
//
//   · A default export, for a host that imports this file and calls it per request.
//     Vercel does exactly this — it names server.js as the entrypoint and looks for a
//     handler. Without one there is nothing to invoke, and every request comes back as
//     FUNCTION_INVOCATION_FAILED no matter what the file does when it runs.
//   · A listening server, for a host that starts this file as a process: Render, Fly,
//     `npm start`. Skipped where a default export is what is wanted, or the port would
//     be opened for nobody.
export default serve;

const managed = Boolean(process.env.VERCEL);

if (!managed) {
  http.createServer(serve).listen(PORT, "0.0.0.0", () => {
    console.log(`[boot] listening on ${PORT}`);
  });
}

const loading = import("./app.js")
  .then(async (mod) => {
    app = mod;
    console.log("");
    console.log("  General Construction Co. · talent acquisition & retention");
    console.log("  ─────────────────────────────────────────────");
    console.log(`  Big screen   http://localhost:${PORT}`);
    console.log("");
    const label = mod.provider();
    console.log(
      label
        ? `  Live features: ${label}  ·  offline fallbacks if a call fails`
        : "  Live features: off — no API key in .env, using offline fallbacks"
    );
    try {
      await mod.init();
    } catch (err) {
      // Not fatal: every API request re-reads the document anyway.
      console.error("[budget] initial load failed — will retry per request:", err.message);
    }
    const store = mod.storageInfo();
    console.log(
      `  Budget storage: ${store.where}` + (store.durable ? "" : "  ⚠ edits are lost on redeploy")
    );
    console.log("");
  })
  .catch((err) => {
    bootError = err;
    console.error("[boot] the application failed to load:", err);
  });

// A rejected promise anywhere must not take the process down and strand the port, which
// on a managed host is indistinguishable from the app never having started.
process.on("unhandledRejection", (err) => console.error("[unhandled]", err));
process.on("uncaughtException", (err) => console.error("[uncaught]", err));
