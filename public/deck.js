// Big-screen deck: navigation, the overview flowchart, and the live Q&A slide.

const slides = [...document.querySelectorAll(".slide")];
const navItems = document.getElementById("nav-items");

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
  // data-alias keeps an old address working after a slide is renamed
  const index = slides.findIndex((s) => slug(s.dataset.title) === parts[0] || s.dataset.alias === parts[0]);
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
  else if (/^[1-9]$/.test(e.key)) go(Number(e.key) - 1, 0);
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
