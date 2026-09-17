// Phone companion: capture questions, reorder them and trigger the answers.
// Everyone browses the deck on their own device, so there is no screen to step.

const form = document.getElementById("capture");
const entry = document.getElementById("entry");
const list = document.getElementById("list");
const empty = document.getElementById("empty");
const generateBtn = document.getElementById("generate");
const statusEl = document.getElementById("status");
const conn = document.getElementById("conn");

let items = [];
let sub = 0;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function post(path, body) {
  try {
    await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    });
  } catch (err) {
    conn.textContent = "offline — retrying";
    conn.removeAttribute("data-live");
  }
}

// ---------------------------------------------------------------- capture

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = entry.value.trim();
  if (!text) return;
  entry.value = "";
  entry.focus(); // keep the keyboard up — you're typing what the room says
  post("/api/bottlenecks", { text }).then(refresh);
});

// ---------------------------------------------------------------- render

function render(state) {
  items = state.bottlenecks;
  sub = state.sub || 0;

  empty.hidden = items.length > 0;
  generateBtn.disabled = items.length === 0 || state.generation.status === "running";

  list.innerHTML = items
    .map(
      (item, i) => `<li data-id="${item.id}">
        <span class="rank">${i + 1}</span>
        <span class="text">${esc(item.text)}</span>
        <span class="controls">
          <button class="up" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
          <button class="down" ${i === items.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
          <button class="del" aria-label="Delete">×</button>
        </span>
      </li>`
    )
    .join("");

  const gen = state.generation;
  if (gen.status === "running") statusEl.textContent = "answering — this takes a moment";
  else if (gen.status === "done")
    statusEl.textContent =
      `${gen.rows.length} on screen · ` +
      { live: "live, searched", "live-unverified": "live, unsearched", library: "offline library" }[gen.source];
  else if (gen.status === "error") statusEl.textContent = `failed — ${gen.error}`;
  else statusEl.textContent = "";
}

list.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const id = Number(btn.closest("li").dataset.id);

  if (btn.classList.contains("del")) return post("/api/bottlenecks/delete", { id });

  const order = items.map((b) => b.id);
  const at = order.indexOf(id);
  const to = btn.classList.contains("up") ? at - 1 : at + 1;
  if (to < 0 || to >= order.length) return;
  [order[at], order[to]] = [order[to], order[at]];
  post("/api/bottlenecks/reorder", { ids: order }).then(refresh);
});

generateBtn.addEventListener("click", () => post("/api/generate", {}).then(refresh));

// ---------------------------------------------------------------- remote

// ---------------------------------------------------------------- staying current

const refresh = () =>
  fetch("/api/state")
    .then((r) => r.json())
    .then((state) => {
      conn.textContent = "connected";
      conn.setAttribute("data-live", "true");
      render(state);
    })
    .catch(() => {
      conn.textContent = "offline";
      conn.removeAttribute("data-live");
    });

refresh();
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
