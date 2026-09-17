// Big-screen deck: navigation, the overview flowchart, and the live Q&A slide.

const slides = [...document.querySelectorAll(".slide")];
const navItems = document.getElementById("nav-items");
const bottleneckList = document.getElementById("bottlenecks");
const emptyState = document.getElementById("bottlenecks-empty");
const generateBtn = document.getElementById("generate");
const resetBtn = document.getElementById("reset");
const genStatus = document.getElementById("gen-status");
const results = document.getElementById("results");
const rowsEl = document.getElementById("rows");
const sourceNote = document.getElementById("source-note");

let current = 0;
let currentSub = 0;
let lastRenderedIds = "";
let lastGenStamp = "";

const panelsFor = (i) => [...slides[i].querySelectorAll(".panel")];
const tabsFor = (i) => [...slides[i].querySelectorAll(".subnav button")];

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? String(u) : null);

// ---------------------------------------------------------------- navigation

slides.forEach((slide, i) => {
  const btn = document.createElement("button");
  btn.className = "nav-item";
  btn.innerHTML = `<b>0${i + 1}</b>${esc(slide.dataset.title)}`;
  btn.addEventListener("click", () => go(i, 0));
  navItems.appendChild(btn);
});

const navToggle = document.getElementById("nav-toggle");
const navCurrent = document.getElementById("nav-current");

function setMenu(open) {
  navItems.dataset.open = String(open);
  navToggle.setAttribute("aria-expanded", String(open));
}

navToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  setMenu(navItems.dataset.open !== "true");
});

document.addEventListener("click", (e) => {
  if (navItems.dataset.open === "true" && !navItems.contains(e.target)) setMenu(false);
});

// ---------------------------------------------------------------- deep links
//
// Every slide — and every sub-panel that has its own tab — has an address, so a link
// can be sent to one place in the deck: #/overview, #/process, #/capabilities.
// The address bar follows whatever is on screen, including moves the presenter makes.

const slug = (s) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function addressFor(index, sub) {
  const base = slug(slides[index].dataset.title);
  const tabs = tabsFor(index);
  const tab = tabs.length > 1 && tabs[sub] ? slug(tabs[sub].textContent) : "";
  // a tab named after its own slide adds nothing — "#/process", not "#/process/process"
  return tab && tab !== base ? `#/${base}/${tab}` : `#/${base}`;
}

/** Read the address bar. Returns false when it names nothing this deck has. */
function applyAddress() {
  const parts = (location.hash || "").replace(/^#\/?/, "").split("/").filter(Boolean);
  if (!parts.length) return false;
  const index = slides.findIndex((s) => slug(s.dataset.title) === parts[0]);
  if (index < 0) return false;

  let sub = 0;
  if (parts[1]) {
    const k = tabsFor(index).findIndex((t) => slug(t.textContent) === parts[1]);
    if (k >= 0) sub = k;
  }
  go(index, sub);
  return true;
}

function go(index, sub) {
  current = Math.max(0, Math.min(slides.length - 1, index));
  const panels = panelsFor(current);
  currentSub = Math.max(0, Math.min(Math.max(panels.length - 1, 0), sub || 0));

  slides.forEach((s, i) => s.setAttribute("data-active", String(i === current)));
  [...navItems.children].forEach((b, i) => b.setAttribute("aria-current", String(i === current)));
  panels.forEach((p, i) => p.setAttribute("data-active", String(i === currentSub)));

  const tabs = tabsFor(current);
  tabs.forEach((t, i) => t.setAttribute("aria-selected", String(i === currentSub)));

  const label = tabs.length
    ? `${slides[current].dataset.title} · ${tabs[currentSub]?.textContent ?? ""}`
    : slides[current].dataset.title;
  navCurrent.textContent = `0${current + 1} · ${label}`;

  setMenu(false);
  window.scrollTo({ top: 0 });

  const address = addressFor(current, currentSub);
  if (location.hash !== address) history.replaceState(null, "", address);

}

// One flat sequence across slides and panels, so ← → and the phone never skip a panel.
function step(dir) {
  let slide = current;
  let sub = currentSub + dir;
  if (sub < 0) {
    slide -= 1;
    sub = slide >= 0 ? Math.max(panelsFor(slide).length - 1, 0) : 0;
  } else if (sub > Math.max(panelsFor(slide).length - 1, 0)) {
    slide += 1;
    sub = 0;
  }
  if (slide < 0 || slide >= slides.length) return;
  go(slide, sub);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") return setMenu(false);
  if (e.target.matches("input, textarea")) return;
  if (e.key === "ArrowRight" || e.key === "PageDown") step(1);
  else if (e.key === "ArrowLeft" || e.key === "PageUp") step(-1);
  else if (/^[1-5]$/.test(e.key)) go(Number(e.key) - 1, 0);
});

// Sub-slide tabs. Keyed on position rather than data-sub, so a panel can be
// removed at build time without renumbering everything that follows it.
document.querySelectorAll(".subnav").forEach((nav) => {
  nav.addEventListener("click", (e) => {
    const tab = e.target.closest("button");
    if (!tab) return;
    go(current, tabsFor(current).indexOf(tab));
  });
});

// collapsible phases
document.querySelectorAll(".phase-head").forEach((head) => {
  head.addEventListener("click", () => {
    const phase = head.closest(".phase");
    const open = phase.dataset.open !== "true";
    phase.dataset.open = String(open);
    head.setAttribute("aria-expanded", String(open));
  });
});

// let the ask-the-document box jump to a slide
window.deckGo = (slide, sub) => go(slide, sub);

// Open where the address points, or at the beginning when it points nowhere.
if (!applyAddress()) go(0, 0);
window.addEventListener("hashchange", applyAddress);

// ---------------------------------------------------------------- flowchart

// Clicking a step in the flowchart, or its entry in the legend below, lights both.
// Clicking the lit one again clears it, so nothing stays highlighted by accident.
const fnodes = [...document.querySelectorAll(".fnode")];
const flowLegend = [...document.querySelectorAll(".flow-legend button")];

function selectNode(name) {
  const already = fnodes.find((n) => n.dataset.node === name)?.dataset.selected === "true";
  const on = (el) => !already && el.dataset.node === name;
  fnodes.forEach((n) => {
    n.setAttribute("data-selected", String(on(n)));
    n.setAttribute("aria-pressed", String(on(n)));
  });
  flowLegend.forEach((b) => b.setAttribute("aria-pressed", String(on(b))));
}

fnodes.forEach((n) => {
  n.addEventListener("click", () => selectNode(n.dataset.node));
  n.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectNode(n.dataset.node);
    }
  });
});
flowLegend.forEach((b) => b.addEventListener("click", () => selectNode(b.dataset.node)));

// ---------------------------------------------------------------- transport

async function post(path, body) {
  try {
    await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    });
  } catch (err) {
    console.error("post failed", path, err);
  }
}

fetch("/api/info")
  .then((r) => r.json())
  .then(({ companionUrl }) => {
    document.getElementById("companion-url").textContent = companionUrl;
  })
  .catch(() => {});

// No stream: the host answers a request and forgets. Read the shared content now,
// again whenever this tab comes back to the front, and after anything you do to it.
const refresh = () =>
  fetch("/api/state")
    .then((r) => r.json())
    .then(render)
    .catch(() => {});

refresh();
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});

// ---------------------------------------------------------------- render

// The stream carries shared content, not a shared screen: what other people add
// arrives here, and where this viewer happens to be is their own business.
function render(state) {
  renderBottlenecks(state.bottlenecks);
  renderGeneration(state.generation);
}

function renderBottlenecks(items) {
  emptyState.hidden = items.length > 0;
  generateBtn.disabled = items.length === 0;

  // don't rebuild mid-drag or when nothing changed — it would fight the pointer
  const signature = items.map((b) => `${b.id}:${b.text}`).join("|");
  if (signature === lastRenderedIds) return;
  lastRenderedIds = signature;

  bottleneckList.innerHTML = "";
  items.forEach((item, i) => {
    const li = document.createElement("li");
    li.className = "bottleneck";
    li.draggable = true;
    li.dataset.id = String(item.id);
    li.innerHTML = `<span class="rank">${i + 1}</span><span class="text">${esc(item.text)}</span><span class="grip">···</span>`;
    bottleneckList.appendChild(li);
  });
}

function renderGeneration(gen) {
  if (gen.status === "running") {
    genStatus.innerHTML = '<span class="spinner"></span>searching and drafting — this takes a moment';
    generateBtn.disabled = true;
    return;
  }

  generateBtn.disabled = bottleneckList.children.length === 0;

  if (gen.status === "idle") {
    genStatus.textContent = "";
    results.hidden = true;
    lastGenStamp = "";
    return;
  }

  if (gen.status === "error") {
    genStatus.textContent = `couldn't generate — ${gen.error}`;
    return;
  }

  const stamp = String(gen.finishedAt);
  if (stamp === lastGenStamp) return;
  lastGenStamp = stamp;

  const seconds = Math.round((gen.finishedAt - gen.startedAt) / 1000);
  genStatus.textContent = `${gen.rows.length} answered · ${seconds}s`;
  results.hidden = false;
  rowsEl.innerHTML = gen.rows.map(rowHtml).join("");
  sourceNote.textContent =
    gen.source === "live"
      ? "Generated live, grounded in web search. Verify links before circulating."
      : gen.source === "live-unverified"
      ? "Generated live, but without web search — examples come from the model's own knowledge. Check the links before relying on them."

      : "From the offline library — no live model call was made.";
}

// Example marks: a locally cached favicon where we have one, the site's own as a
// last resort when online, and nothing at all rather than a broken frame.
function markHtml(url) {
  let host;
  try {
    host = new URL(url).host;
  } catch {
    return "";
  }
  const slug = host.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const chain = [`/img/ex/${slug}.png`, `/img/ex/${slug}.svg`, `https://${host}/favicon.ico`];
  const onerror = `this.dataset.step=(+this.dataset.step||0)+1;const c=${JSON.stringify(chain)};if(c[this.dataset.step]){this.src=c[this.dataset.step]}else{this.remove()}`;
  return `<img class="ex-mark" src="${esc(chain[0])}" alt="" data-step="0" loading="lazy" onerror="${esc(onerror)}" />`;
}

function cellHtml(cell, kind) {
  const examples = (cell?.examples || [])
    .map((ex) => {
      const url = safeUrl(ex.url);
      const name = url ? `<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(ex.name)}</a>` : esc(ex.name);
      return `<li>${url ? markHtml(url) : ""}<span>${name} — <em>${esc(ex.note)}</em></span></li>`;
    })
    .join("");
  return `<div class="cell ${kind}">
    <p class="solution">${esc(cell?.solution)}</p>
    <p class="how">${esc(cell?.how || "")}</p>
    <ul class="examples">${examples}</ul>
  </div>`;
}

function rowHtml(row) {
  return `<div class="row">
    <p class="row-title">${esc(row.question ?? row.bottleneck)}</p>
    <p class="row-theme">${esc(row.theme || "")}</p>
    <div class="cells">${cellHtml(row.answer, "answer")}</div>
  </div>`;
}

// ---------------------------------------------------------------- drag to prioritise

let dragged = null;

bottleneckList.addEventListener("dragstart", (e) => {
  dragged = e.target.closest(".bottleneck");
  if (!dragged) return;
  dragged.dataset.dragging = "true";
  e.dataTransfer.effectAllowed = "move";
});

bottleneckList.addEventListener("dragover", (e) => {
  e.preventDefault();
  const over = e.target.closest(".bottleneck");
  if (!over || !dragged || over === dragged) return;
  const { top, height } = over.getBoundingClientRect();
  const after = e.clientY > top + height / 2;
  bottleneckList.insertBefore(dragged, after ? over.nextSibling : over);
});

bottleneckList.addEventListener("dragend", () => {
  if (!dragged) return;
  delete dragged.dataset.dragging;
  dragged = null;
  [...bottleneckList.children].forEach((li, i) => (li.querySelector(".rank").textContent = i + 1));
  const ids = [...bottleneckList.children].map((li) => Number(li.dataset.id));
  lastRenderedIds = ""; // let the next broadcast re-sync ranks
  post("/api/bottlenecks/reorder", { ids }).then(refresh);
});

// ---------------------------------------------------------------- actions

const captureForm = document.getElementById("capture");
const entry = document.getElementById("entry");

captureForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = entry.value.trim();
  if (!text) return;
  entry.value = "";
  post("/api/bottlenecks", { text }).then(refresh);
});

generateBtn.addEventListener("click", () => {
  renderGeneration({ status: "running", rows: [], source: null, error: null });
  post("/api/generate", {}).then(refresh);
});
// Two-tap clear — no modal dialog to block the room, no accidental wipe mid-talk.
let clearArmed = null;
resetBtn.addEventListener("click", () => {
  if (clearArmed) {
    clearTimeout(clearArmed);
    clearArmed = null;
    resetBtn.textContent = "Clear";
    post("/api/reset", {}).then(refresh);
    return;
  }
  resetBtn.textContent = "Tap again to clear";
  clearArmed = setTimeout(() => {
    clearArmed = null;
    resetBtn.textContent = "Clear";
  }, 3000);
});
