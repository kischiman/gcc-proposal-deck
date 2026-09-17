// Admin panel. The only place the base rate card exists, and the only place a proposal
// becomes a staffing decision. It is deliberately open: anyone who can reach this page
// can change anything on the board, including resetting it.

const $ = (id) => document.getElementById(id);

let state = null;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const money = (n) =>
  (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const RATE_LABELS = {
  principal: "Principal / lead",
  researcher: "Researcher",
  designer: "Designer",
  engineer: "Engineer",
  pm: "Project manager",
  apartment: "Apartment · month",
  perdiem: "Per diem · day",
  contingency: "Contingency · %",
};

// ---------------------------------------------------------------- auth

/** fetch that gives up rather than hanging forever — a hang is invisible otherwise. */
async function timedFetch(path, options = {}, ms = 15000) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), ms);
  try {
    return await fetch(path, { ...options, signal: stop.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`The server did not answer ${path} within ${ms / 1000}s.`);
    }
    throw new Error(`Could not reach ${path} — check your connection.`);
  } finally {
    clearTimeout(timer);
  }
}

async function api(path, body) {
  const res = await timedFetch(path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  // Anything else non-OK must throw too. Returning the error body as if it were
  // data poisons the caller's state and the failure surfaces somewhere unrelated.
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server returned ${res.status}`);
  }

  try {
    return await res.json();
  } catch {
    throw new Error("The server sent something unreadable.");
  }
}

// Draw before revealing, so a failure halfway through does not leave an empty panel.
async function enter() {
  state = await api("/api/admin/state");
  render();
  $("panel").hidden = false;
  connect();
}

$("export").addEventListener("click", async () => {
  const res = await fetch("/api/budget/export");
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `budget-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------------------------------------------------------------- rendering

function renderStorage() {
  const s = state.storage;
  const el = $("storage-warn");
  if (!s || s.durable) return (el.hidden = true);
  el.hidden = false;
  el.innerHTML = `<b>Edits here are not durable.</b> State is kept in
    <code>${esc(s.where)}</code>, which this host wipes on every redeploy. Set
    <code>GIST_ID</code> and <code>GITHUB_TOKEN</code> in the environment to keep it
    permanently — until then, use <b>Export</b> before any deploy.`;
}

function renderRates() {
  // Roles no longer drive any figure — each line carries its own rate — so the only
  // project-wide number left is contingency.
  $("rate-grid").innerHTML = `<div class="rate">
      <label for="r-contingency">Contingency · %</label>
      <input id="r-contingency" data-rate="contingency" type="number" min="0" step="1"
             value="${state.rates.contingency}" />
    </div>`;

  const on = state.tasks.filter((t) => t.prefill).length;
  $("prefill-count").textContent = `${on} of ${state.tasks.length} lines suggest a rate`;

  // The public board is scope-only unless this is on. Say which state it is in
  // rather than leaving the admin to infer it from a highlight.
  const money = state.settings?.publicMoney === true;
  const toggle = $("public-money");
  toggle.classList.toggle("on", money);
  toggle.setAttribute("aria-pressed", String(money));
  toggle.textContent = money ? "public" : "hidden";
  $("money-state").textContent = money
    ? "rates, amounts and totals are public"
    : "the board shows scope only";

  // Absent means visible, so a board saved before this switch existed stays as it was.
  const shown = state.settings?.publicProposals !== false;
  const pt = $("public-proposals");
  pt.classList.toggle("on", shown);
  pt.setAttribute("aria-pressed", String(shown));
  pt.textContent = shown ? "visible" : "hidden";
  const total = state.tasks.reduce((a, t) => a + t.proposals.length, 0);
  $("proposals-state").textContent = shown
    ? `${total} proposal${total === 1 ? "" : "s"} shown to everyone`
    : `${total} proposal${total === 1 ? "" : "s"}, visible here and on the team page`;

  const cShown = state.settings?.publicComments !== false;
  const ct = $("public-comments");
  ct.classList.toggle("on", cShown);
  ct.setAttribute("aria-pressed", String(cShown));
  ct.textContent = cShown ? "visible" : "hidden";
  const all = state.tasks.flatMap((t) => t.comments || []);
  const pub = all.filter((c) => c.visibility === "public").length;
  const team = all.length - pub;
  $("comments-state").textContent =
    `${pub} public${cShown ? " (on the deck)" : " (hidden)"} · ${team} team-only`;
}

function renderPeople() {
  if (!state.people.length) {
    $("people").innerHTML = `<p class="empty-note">No proposals yet. Share the public link and they will appear here.</p>`;
    return;
  }
  $("people").innerHTML = state.people
    .map(
      (p) => `<div class="person${p.assigned ? " on" : ""}">
        <div>
          <div class="pname">${p.assigned ? "◆ " : ""}${esc(p.name)}</div>
          <div class="plines">${p.lines.filter((l) => l.assigned).length} of ${p.lines.length} proposals accepted</div>
        </div>
        <div class="pnums">
          <span class="v">${money(p.assigned)}</span>
          <span class="sub">of ${money(p.proposed)} proposed</span>
        </div>
      </div>`
    )
    .join("");
}

// Terms for a proposal or line: a fixed sum, a quantity at a rate, or — when no
// rate was given — just the quantity, rather than "× $0".
const terms = (x) =>
  x.unit === "fixed" ? "fixed" : x.rate ? `${x.qty} ${esc(x.unit)} × ${money(x.rate)}` : `${x.qty} ${esc(x.unit)}`;

function proposalRow(t, p) {
  const on = t.assigned === p.id;
  return `<div class="proposal admin${on ? " on" : ""}">
    <span class="who">${esc(p.name)}</span>
    <span class="terms">${terms(p)}</span>
    <span class="amt">${money(p.amount)}</span>
    <span class="prow-actions">
      <button class="btn ${on ? "" : "ghost "}small" data-assign="${esc(t.id)}" data-pid="${esc(p.id)}">
        ${on ? "On the project" : "Put on project"}
      </button>
      <button class="btn ghost small" data-pedit="${esc(t.id)}" data-pid="${esc(p.id)}">Edit</button>
      <button class="remove" data-premove="${esc(t.id)}" data-pid="${esc(p.id)}" title="Remove proposal" aria-label="Remove proposal">×</button>
    </span>
    ${p.notes ? `<p class="pnote">${esc(p.notes)}</p>` : ""}
  </div>`;
}

function lineHtml(t) {
  if (t.kind === "divider") {
    const span = Number(t.qty) ? `${t.qty} ${esc(t.unit || "months")}` : "";
    return `<div class="line divider admin" data-id="${esc(t.id)}" draggable="true">
      <span class="divider-name">${esc(t.name)}</span>
      ${span ? `<span class="divider-span">${span}</span>` : ""}
      <span class="line-actions">
        <button class="btn ghost small" data-edit="${esc(t.id)}">Edit</button>
        <button class="remove" data-remove="${esc(t.id)}" title="Remove divider" aria-label="Remove divider">&times;</button>
      </span>
    </div>`;
  }
  const on = t.proposals.find((p) => p.id === t.assigned);
  return `<div class="line admin" data-claimed="${!!on}" data-id="${esc(t.id)}" draggable="true">
    <div class="detail">
      <div class="name">${esc(t.name)}
        <button class="kind-toggle${t.kind === "expense" ? " on" : ""}" data-expense="${esc(t.id)}"
                title="${
                  t.kind === "expense"
                    ? "An expense — money out, shown on the budget sheet only"
                    : "Work someone can take on — shown on the process page too"
                }">${t.kind === "expense" ? "expense" : "work"}</button>
      </div>
      ${t.note ? `<div class="note">${esc(t.note)}</div>` : ""}
      ${t.memo ? `<div class="memo"><span class="only-here">admin only</span>${esc(t.memo)}</div>` : ""}
      ${
        t.proposals.length
          ? `<div class="proposals">${t.proposals.map((p) => proposalRow(t, p)).join("")}</div>`
          : `<p class="empty-note">No proposals yet</p>`
      }
      ${
        (t.comments || []).length
          ? `<div class="comments">${t.comments
              .map(
                (c) => `<div class="comment${c.visibility === "public" ? " public" : ""}">
                  <span class="who">${esc(c.name)}</span>${
                    c.visibility === "public" ? '<span class="tag">public</span>' : ""
                  }
                  <button class="remove" data-cremove="${esc(t.id)}" data-cid="${esc(c.id)}"
                          title="Remove comment" aria-label="Remove comment">&times;</button>
                  <p class="ctext">${esc(c.text)}</p></div>`
              )
              .join("")}</div>`
          : ""
      }
    </div>
    <div class="num base">
      <span class="terms">${terms(t)}</span>
      ${money(t.base)}
      <button class="prefill-toggle${t.prefill ? " on" : ""}" data-prefill="${esc(t.id)}"
              title="${t.prefill ? "Public board suggests this rate" : "Public board shows no rate for this line"}">
        ${t.prefill ? "suggested" : "hidden"}
      </button>
    </div>
    <div class="num amount">${money(t.effective)}</div>
    <div class="line-actions">
      <button class="btn ghost small" data-edit="${esc(t.id)}">Edit</button>
      <button class="remove" data-remove="${esc(t.id)}" title="Remove line" aria-label="Remove line">×</button>
    </div>
  </div>`;
}

function render() {
  renderStorage();
  renderRates();
  renderPeople();

  $("phases").innerHTML = state.phases
    .map((p) => {
      const tasks = state.tasks.filter((t) => t.phase === p.id);
      return `<section class="phase" data-phase="${esc(p.id)}">
        <header>
          <div>
            <h2>${esc(p.title)}</h2>
            <p class="note">${esc(p.note)}</p>
            <label class="owner">
              <span>Owner</span>
              <input type="text" maxlength="60" data-owner="${esc(p.id)}"
                     value="${esc(p.owner || "")}" placeholder="Nobody yet" />
            </label>
          </div>
          <span class="amount">${money(state.totals.effective.byPhase[p.id])}</span>
        </header>
        ${tasks.map(lineHtml).join("")}
        <div class="phase-foot">
          <button class="btn ghost small" data-newline="${esc(p.id)}">+ Add task</button>
          <button class="btn ghost small" data-newdivider="${esc(p.id)}">+ Add divider</button>
        </div>
      </section>`;
    })
    .join("");

  const eff = state.totals.effective;
  const base = state.totals.base;
  $("summary").innerHTML =
    state.phases
      .map(
        (p) =>
          `<div class="row"><span>${esc(p.title)}</span><span class="v">${money(eff.byPhase[p.id])}</span></div>`
      )
      .join("") +
    `<div class="row sub"><span>Subtotal</span><span class="v">${money(eff.net)}</span></div>
     <div class="row sub"><span>Contingency at ${state.rates.contingency}%</span><span class="v">${money(eff.contingency)}</span></div>
     <div class="row total"><span>Committed total</span><span class="v">${money(eff.total)}</span></div>
     <div class="row sub"><span>Against base rate card</span><span class="v">${money(base.total)}</span></div>`;
}

// ---------------------------------------------------------------- actions

/** Report a failed call. Nothing here may throw: these run from click handlers, and
 *  a rejected handler is a button that does nothing at all. */
function reportFailure(err) {
  const message = (err && err.message) || "That did not save.";

  alert(message);

  // A refusal usually means this page is describing something the server no longer
  // has. Re-read, so the stale line goes rather than sitting there to be clicked again.
  api("/api/admin/state")
    .then((fresh) => {
      state = fresh;
      render();
    })
    .catch(() => {});
}

/** True when the change went through; callers close their dialog on that, not before. */
async function mutate(action, body) {
  try {
    await api(`/api/admin/${action}`, body);
    state = await api("/api/admin/state");
    render();
    return true;
  } catch (err) {
    console.error(`[admin] ${action} failed:`, err);
    reportFailure(err);
    return false;
  }
}

// ---------------------------------------------------------------- edit a line

let editingId = null;
// Set when the dialog is adding rather than editing; the fields are the same either way.
let newLinePhase = null;
let newLineKind = null;

function openNewLine(phaseId, kind) {
  const p = state.phases.find((x) => x.id === phaseId);
  if (!p) return;
  editingId = null;
  newLinePhase = phaseId;
  newLineKind = kind || null;

  // A divider has no price; calcEdit keeps the rate field out of the way.
  $("edit-title").textContent =
    kind === "divider" ? `Add a divider to ${p.title}` : `Add a line to ${p.title}`;
  $("e-name").value = "";
  $("e-note").value = "";
  $("e-qty").value = "";
  $("e-unit").innerHTML = state.units
    .map((u) => `<option value="${u}"${u === "days" ? " selected" : ""}>${u}</option>`)
    .join("");
  $("e-rate").value = "";
  $("e-memo").value = "";

  calcEdit();
  $("scrim").hidden = false;
  $("edit-modal").hidden = false;
  $("e-name").focus();
}

function openEdit(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  editingId = id;
  newLinePhase = null;
  newLineKind = null;
  $("edit-title").textContent = t.kind === "divider" ? "Edit divider" : "Edit line";

  $("e-name").value = t.name;
  $("e-note").value = t.note || "";
  $("e-qty").value = t.qty;
  $("e-unit").innerHTML = state.units
    .map((u) => `<option value="${u}"${u === t.unit ? " selected" : ""}>${u}</option>`)
    .join("");
  $("e-rate").value = t.rate ?? "";
  $("e-memo").value = t.memo || "";

  calcEdit();
  $("scrim").hidden = false;
  $("edit-modal").hidden = false;
  $("e-name").focus();
}

/** True while the dialog is on a divider, whether adding one or editing one. */
function editingDivider() {
  if (newLineKind === "divider") return true;
  return !!editingId && state.tasks.find((t) => t.id === editingId)?.kind === "divider";
}

function calcEdit() {
  const divider = editingDivider();
  const fixed = !divider && $("e-unit").value === "fixed";
  // Runs on every keystroke, so it has to re-assert the divider case or the rate
  // field would come back the moment anything was typed.
  $("e-rate").disabled = fixed || divider;
  $("e-qty").previousElementSibling.textContent = divider
    ? "How long"
    : fixed
      ? "Amount · USD"
      : "Quantity";
  const qty = Number($("e-qty").value) || 0;
  $("e-total").textContent = divider ? "—" : money(fixed ? qty : qty * (Number($("e-rate").value) || 0));
}

["e-qty", "e-rate"].forEach((id) => $(id).addEventListener("input", calcEdit));
$("e-unit").addEventListener("change", calcEdit);

function closeEdit() {
  $("scrim").hidden = true;
  $("edit-modal").hidden = true;
  // Leaving the mode set would send the next Edit through the add path.
  newLinePhase = null;
  newLineKind = null;
}

$("edit-close").addEventListener("click", closeEdit);
$("edit-cancel").addEventListener("click", closeEdit);
$("scrim").addEventListener("click", () => { closeEdit(); closeProp(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeEdit(); closeProp(); }
});

$("edit-save").addEventListener("click", async () => {
  const saved = await mutate(newLinePhase ? "task" : "update", {
    phase: newLinePhase,
    kind: newLineKind,
    id: editingId,
    name: $("e-name").value,
    note: $("e-note").value,
    qty: $("e-qty").value,
    unit: $("e-unit").value,
    rate: $("e-rate").disabled ? undefined : $("e-rate").value,
    memo: $("e-memo").value,
  });
  if (saved) closeEdit();
});

// ---------------------------------------------------------------- edit a proposal

let propTask = null;
let propId = null;

function openProposal(taskId, proposalId) {
  const t = state.tasks.find((x) => x.id === taskId);
  const p = t?.proposals.find((x) => x.id === proposalId);
  if (!p) return;
  propTask = taskId;
  propId = proposalId;

  $("prop-task").innerHTML = `<b>${esc(p.name)}</b> on ${esc(t.name)}`;
  $("pr-name").value = p.name;
  $("pr-qty").value = p.qty;
  $("pr-unit").innerHTML = state.units
    .map((u) => `<option value="${u}"${u === p.unit ? " selected" : ""}>${u}</option>`)
    .join("");
  $("pr-rate").value = p.rate ?? "";
  $("pr-notes").value = p.notes || "";

  calcProp();
  $("scrim").hidden = false;
  $("prop-modal").hidden = false;
  $("pr-name").focus();
}

function calcProp() {
  const fixed = $("pr-unit").value === "fixed";
  $("pr-rate").disabled = fixed;
  const qty = Number($("pr-qty").value) || 0;
  $("pr-total").textContent = money(fixed ? qty : qty * (Number($("pr-rate").value) || 0));
}

["pr-qty", "pr-rate"].forEach((id) => $(id).addEventListener("input", calcProp));
$("pr-unit").addEventListener("change", calcProp);

function closeProp() {
  $("scrim").hidden = true;
  $("prop-modal").hidden = true;
}

$("prop-close").addEventListener("click", closeProp);
$("prop-cancel").addEventListener("click", closeProp);

$("prop-save").addEventListener("click", async () => {
  const saved = await mutate("proposal-update", {
    id: propTask,
    proposalId: propId,
    name: $("pr-name").value,
    qty: $("pr-qty").value,
    unit: $("pr-unit").value,
    rate: $("pr-rate").disabled ? undefined : $("pr-rate").value,
    notes: $("pr-notes").value,
  });
  if (saved) closeProp();
});

$("prop-remove").addEventListener("click", async () => {
  const t = state.tasks.find((x) => x.id === propTask);
  const p = t?.proposals.find((x) => x.id === propId);
  if (p && confirm(`Remove ${p.name}'s proposal?`)) {
    if (await mutate("proposal-remove", { id: propTask, proposalId: propId })) closeProp();
  }
});

document.addEventListener("click", (e) => {
  const pe = e.target.closest("[data-pedit]");
  if (pe) return openProposal(pe.dataset.pedit, pe.dataset.pid);

  const pr = e.target.closest("[data-premove]");
  if (pr) {
    const t = state.tasks.find((x) => x.id === pr.dataset.premove);
    const p = t?.proposals.find((x) => x.id === pr.dataset.pid);
    if (p && confirm(`Remove ${p.name}'s proposal?`)) {
      return mutate("proposal-remove", { id: pr.dataset.premove, proposalId: pr.dataset.pid });
    }
    return;
  }

  const nd = e.target.closest("[data-newdivider]");
  if (nd) return openNewLine(nd.dataset.newdivider, "divider");
  const nl = e.target.closest("[data-newline]");
  if (nl) return openNewLine(nl.dataset.newline);
  const ed = e.target.closest("[data-edit]");
  if (ed) return openEdit(ed.dataset.edit);

  const a = e.target.closest("[data-assign]");
  if (a) {
    const t = state.tasks.find((x) => x.id === a.dataset.assign);
    const already = t.assigned === a.dataset.pid;
    return mutate("assign", { id: a.dataset.assign, proposalId: already ? null : a.dataset.pid });
  }

  const ow = e.target.closest("[data-owner]");
  if (ow) return; // typing in the owner field, not a click to act on
  const ex = e.target.closest("[data-expense]");
  if (ex) {
    const t = state.tasks.find((x) => x.id === ex.dataset.expense);
    return mutate("expense", { id: ex.dataset.expense, value: t?.kind !== "expense" });
  }
  const pf = e.target.closest("[data-prefill]");
  if (pf) {
    const t = state.tasks.find((x) => x.id === pf.dataset.prefill);
    return mutate("prefill", { id: pf.dataset.prefill, value: !t.prefill });
  }

  const all = e.target.closest("[data-prefill-all]");
  if (all) return mutate("prefill-all", { value: all.dataset.prefillAll === "1" });

  if (e.target.closest("#public-money")) {
    return mutate("public-money", { value: !(state.settings?.publicMoney === true) });
  }

  if (e.target.closest("#public-proposals")) {
    return mutate("public-proposals", { value: state.settings?.publicProposals !== true });
  }

  if (e.target.closest("#public-comments")) {
    return mutate("public-comments", { value: state.settings?.publicComments === false });
  }

  const cx = e.target.closest("[data-cremove]");
  if (cx) {
    const t = state.tasks.find((x) => x.id === cx.dataset.cremove);
    const c = t?.comments?.find((x) => x.id === cx.dataset.cid);
    if (c && confirm(`Remove ${c.name}'s comment?`)) {
      return mutate("comment-remove", { id: cx.dataset.cremove, commentId: cx.dataset.cid });
    }
    return;
  }

  const rm = e.target.closest("[data-remove]");
  if (rm) {
    const t = state.tasks.find((x) => x.id === rm.dataset.remove);
    if (t && confirm(`Remove "${t.name}" and any proposals on it?`)) mutate("remove", { id: rm.dataset.remove });
  }
});

document.addEventListener("change", (e) => {
  const rate = e.target.closest("[data-rate]");
  if (rate) return mutate("rate", { key: rate.dataset.rate, value: rate.value });
});

// ---------------------------------------------------------------- re-arrange
//
// The order set here is the order the process page shows, so this is arranging the
// plan, not just tidying a table. A line only moves within its own phase — dropping
// Phase 1 work into Phase 3 would change what it means, not merely where it sits.

let dragged = null;

$("phases").addEventListener("change", (e) => {
  const field = e.target.closest("[data-owner]");
  if (field) mutate("phase-owner", { phase: field.dataset.owner, name: field.value });
});

$("phases").addEventListener("dragstart", (e) => {
  dragged = e.target.closest(".line");
  if (!dragged) return;
  dragged.dataset.dragging = "true";
  e.dataTransfer.effectAllowed = "move";
});

$("phases").addEventListener("dragover", (e) => {
  const over = e.target.closest(".line");
  if (!over || !dragged || over === dragged) return;
  if (over.closest("section.phase") !== dragged.closest("section.phase")) return;
  e.preventDefault();
  const { top, height } = over.getBoundingClientRect();
  const after = e.clientY > top + height / 2;
  over.parentNode.insertBefore(dragged, after ? over.nextSibling : over);
});

$("phases").addEventListener("dragend", async () => {
  if (!dragged) return;
  const section = dragged.closest("section.phase");
  delete dragged.dataset.dragging;
  dragged = null;
  if (!section) return;
  const ids = [...section.querySelectorAll(".line")].map((el) => el.dataset.id);
  // A refused reorder would otherwise leave the screen showing an order the server
  // never accepted; mutate() re-reads on failure, which puts it back.
  await mutate("reorder", { phase: section.dataset.phase, ids });
});

// ---------------------------------------------------------------- staying current
//
// No stream to subscribe to on a serverless host. Re-read when this tab comes back to
// the front — and mutate() already re-reads after anything you do here.

function connect() {
  $("live").textContent = "live";
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) return;
    try {
      state = await api("/api/admin/state");
      render();
    } catch (err) {
      reportFailure(err);
    }
  });
}

// ---------------------------------------------------------------- start

(async () => {
  try {
    await enter();
  } catch (err) {
    console.error("[admin] could not load:", err);
    alert(err.message || "Could not load the panel.");
  }
})();
