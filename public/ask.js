// "Ask this document" — a question box in the nav bar.
//
// The index is built from the rendered deck, so it is never out of date with the slides.
// The client always ranks passages locally; where a server is present and has credentials,
// it also asks Claude to answer from those passages. Shared with the standalone build,
// which has no server and so shows the passages themselves.

(function () {
  const wrap = document.getElementById("nav-ask");
  const form = document.getElementById("ask-form");
  const input = document.getElementById("ask-input");
  const panel = document.getElementById("ask-panel");
  const toggle = document.getElementById("ask-toggle");

  const STOP = new Set(["the", "and", "for", "with", "that", "this", "what", "how", "does", "did", "are", "was", "were", "from", "you", "your", "our", "who", "why", "when", "where", "which", "into", "about", "there", "their", "have", "has", "can", "will", "would"]);

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------------------------------------------------------------- index

  const index = [];

  function nearestHeading(el) {
    let node = el;
    while (node && node !== document.body) {
      let sib = node.previousElementSibling;
      while (sib) {
        if (/^H[1-3]$/.test(sib.tagName)) return sib.textContent.trim();
        const inner = sib.querySelector && sib.querySelector("h1, h2, h3");
        if (inner) return inner.textContent.trim();
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    return "";
  }

  function buildIndex() {
    document.querySelectorAll(".slide").forEach((slide) => {
      const slideIndex = Number(slide.dataset.slide);
      const title = slide.dataset.title;
      const panels = [...slide.querySelectorAll(".panel")];
      const scopes = panels.length ? panels : [slide];

      scopes.forEach((scope, sub) => {
        const tab = slide.querySelectorAll(".subnav button")[sub];
        const label = tab ? `${title} · ${tab.textContent.trim()}` : title;

        scope.querySelectorAll("p, li, dd, figcaption, .chip").forEach((el) => {
          if (el.closest(".ask-panel")) return;
          const text = el.textContent.replace(/\s+/g, " ").trim();
          if (text.length < 30) return;
          index.push({
            slide: slideIndex,
            sub,
            label,
            heading: nearestHeading(el),
            text,
          });
        });
      });
    });
  }

  // ---------------------------------------------------------------- ranking

  function terms(q) {
    return [...new Set((q.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((t) => !STOP.has(t)))];
  }

  function rank(q, limit) {
    const ts = terms(q);
    if (!ts.length) return [];
    return index
      .map((entry) => {
        const body = entry.text.toLowerCase();
        const head = (entry.heading + " " + entry.label).toLowerCase();
        let score = 0;
        for (const t of ts) {
          if (body.includes(t)) score += 1;
          if (head.includes(t)) score += 1.5;
        }
        // a passage matching more of the question beats one repeating a single word
        const covered = ts.filter((t) => body.includes(t) || head.includes(t)).length;
        return { entry, score: score * (1 + covered / ts.length) };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => r.entry);
  }

  // ---------------------------------------------------------------- rendering

  function open(html) {
    panel.hidden = false;
    panel.innerHTML = html;
    input.setAttribute("aria-expanded", "true");
  }

  function close() {
    panel.hidden = true;
    panel.innerHTML = "";
    input.setAttribute("aria-expanded", "false");
    wrap.removeAttribute("data-open");
  }

  function sourcesHtml(hits) {
    const seen = new Set();
    return hits
      .filter((h) => {
        const key = h.slide + ":" + h.sub;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(
        (h) =>
          `<button class="ask-chip" data-slide="${h.slide}" data-sub="${h.sub}">${esc(h.label)}</button>`
      )
      .join("");
  }

  function passagesHtml(hits) {
    return hits
      .slice(0, 5)
      .map(
        (h) =>
          `<button class="ask-hit" data-slide="${h.slide}" data-sub="${h.sub}">
             <span class="ask-hit-where">${esc(h.label)}${h.heading ? " · " + esc(h.heading) : ""}</span>
             <span class="ask-hit-text">${esc(h.text.slice(0, 220))}${h.text.length > 220 ? "…" : ""}</span>
           </button>`
      )
      .join("");
  }

  // ---------------------------------------------------------------- asking

  let pending = 0;

  async function ask(question) {
    const hits = rank(question, 8);

    if (!hits.length) {
      open(`<p class="ask-empty">Nothing in the deck matches that. Try a word from the slides — a phase, a goal, a capability.</p>`);
      return;
    }

    const token = ++pending;
    open(`<p class="ask-status"><span class="spinner"></span>Reading the deck…</p>`);

    let answer = null;
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: question, passages: hits }),
      });
      if (res.ok) answer = (await res.json()).answer;
    } catch {
      // no server (the shared copy) — fall through to the passages
    }

    if (token !== pending) return; // a newer question overtook this one

    if (answer) {
      open(
        `<div class="ask-answer">${esc(answer).replace(/\n+/g, "</p><p>").replace(/^/, "<p>") + "</p>"}</div>
         <div class="ask-sources"><span class="ask-label">In the deck</span>${sourcesHtml(hits)}</div>`
      );
    } else {
      open(
        `<div class="ask-sources"><span class="ask-label">From the deck</span></div>${passagesHtml(hits)}`
      );
    }
  }

  // ---------------------------------------------------------------- wiring

  buildIndex();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q) ask(q);
  });

  input.addEventListener("input", () => {
    if (!input.value.trim()) close();
  });

  panel.addEventListener("click", (e) => {
    const target = e.target.closest("[data-slide]");
    if (!target) return;
    if (typeof window.deckGo === "function") {
      window.deckGo(Number(target.dataset.slide), Number(target.dataset.sub));
    }
    close();
  });

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = wrap.dataset.open !== "true";
    wrap.dataset.open = String(willOpen);
    if (willOpen) input.focus();
    else close();
  });

  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      close();
      input.blur();
    }
  });
})();
