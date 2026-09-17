// The budget, as a thing two pages can mount.
//
// /budget renders the whole board. The deck renders the same lines twice: the
// research-process steps on slide 2, and the full board on the last slide. All three
// need identical line markup, the same propose dialog and one shared live connection,
// so everything except the page-specific layout lives here.
//
// Plain script, no modules — deck.js and budget.js are loaded the same way, and the
// static artifact build inlines them.

window.Budget = (function () {
  let state = { phases: [], units: [], tasks: [], money: false, updatedAt: 0 };
  let loaded = false;
  const renderers = [];
  let onStatus = () => {};

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const money = (n) =>
    (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  // Terms for a proposal or line: a fixed sum, a quantity at a rate, or just the
  // quantity when no rate was given. A comment that named neither says nothing here —
  // "0 days" is not what its author wrote.
  const terms = (x) => {
    if (x.unit === "fixed") return x.rate || x.qty ? "fixed" : "";
    if (!Number(x.qty)) return "";
    return x.rate ? `${x.qty} ${esc(x.unit)} × ${money(x.rate)}` : `${x.qty} ${esc(x.unit)}`;
  };

  // ---------------------------------------------------------------- transport

  // Which view this page reads, where its comments go, and whether it sees both kinds.
  // The team page asks for a view the switches do not gate, and its comments stay with
  // the team.
  let source = "/api/budget";
  let commentPath = "/api/budget/comment";
  let showsBothKinds = false;

  async function load() {
    state = await (await fetch(source)).json();
    loaded = true;
    renderers.forEach((fn) => fn(state));
  }

  const send = (action, body) => post(`/api/budget/${action}`, body);

  async function post(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      onStatus("error", error || "That did not save");
      return false;
    }
    await load();
    return true;
  }

  // ---------------------------------------------------------------- line markup

  function commentHtml(t, c) {
    // Marked only where both kinds appear together — on the deck every comment is
    // public, and saying so on each would be noise.
    const badge =
      showsBothKinds && c.visibility === "public" ? '<span class="tag">public</span>' : "";
    return `<div class="comment${c.visibility === "public" ? " public" : ""}">
      <span class="who">${esc(c.name)}</span>${badge}
      <p class="ctext">${esc(c.text)}</p>
    </div>`;
  }

  function proposalHtml(t, p) {
    const isAssigned = t.assigned === p.id;
    const said = terms(p);
    return `<div class="proposal${isAssigned ? " on" : ""}${state.money ? "" : " scope-only"}">
      <span class="who">${isAssigned ? "◆ " : ""}${esc(p.name)}</span>
      <span class="terms">${said}</span>
      ${state.money && p.amount ? `<span class="amt">${money(p.amount)}</span>` : "<span></span>"}
      ${isAssigned ? '<span class="on-tag">on the project</span>' : ""}
      ${p.notes ? `<p class="pnote">${esc(p.notes)}</p>` : ""}
    </div>`;
  }

  // A line only carries a suggestion if the admin marked it. With nothing to suggest
  // the column stays empty rather than announcing an absence.
  function suggestionHtml(t) {
    if (t.suggestedQty === null || t.suggestedQty === undefined) return "";
    const scope = t.unit === "fixed" ? "fixed" : `${t.suggestedQty} ${esc(t.unit || "days")}`;
    return `${scope}<span class="scope-label">suggested</span>`;
  }

  // A divider is a marker in the list: it names a stretch of the work and how long it
  // runs. Nothing to propose for, nothing to cost — so it carries neither control.
  function dividerHtml(t) {
    const span = t.span && Number(t.span.qty) ? `${t.span.qty} ${esc(t.span.unit || "months")}` : "";
    return `<div class="line divider" data-id="${esc(t.id)}">
      <span class="divider-name">${esc(t.name)}</span>
      ${span ? `<span class="divider-span">${span}</span>` : ""}
    </div>`;
  }

  /** What the board estimates, phase by phase. Both pages read this rather than each
   *  adding the lines up their own way — that is how they came to disagree. */
  function estimateTotals(state) {
    const byPhase = state.phases.map((p) => ({
      id: p.id,
      title: p.title,
      total: state.tasks
        .filter((t) => t.phase === p.id && t.kind !== "divider")
        .reduce((a, t) => a + lineNumbers(t).subtotal, 0),
    }));
    const net = byPhase.reduce((a, p) => a + p.total, 0);
    const pct = Number(state.contingency) || 0;
    const contingency = net * (pct / 100);
    return { byPhase, net, pct, contingency, total: net + contingency };
  }

  /** The summary box's rows. Identical on both pages, because it is one function. */
  function estimateRowsHtml(state) {
    const e = estimateTotals(state);
    if (!e.net) return "";
    const row = (label, value, cls) =>
      `<div class="row${cls ? " " + cls : ""}"><span>${esc(label)}</span><span class="v">${value}</span></div>`;
    return (
      e.byPhase.map((p) => row(p.title, money(p.total))).join("") +
      (e.pct
        ? row("Subtotal", money(e.net), "sub") + row(`Contingency at ${e.pct}%`, money(e.contingency), "sub")
        : "") +
      row("Total", money(e.total), "total")
    );
  }

  /** Closes a phase: everything in it, work and expenses together. Named, because
   *  unlike a segment sum there is no heading above it saying what it adds up. */
  function phaseTotalHtml(total) {
    return `<div class="line segment-sum phase-total">
      <div class="detail"><span class="phase-total-label">Phase total</span></div>
      <div class="num time"></div>
      <div class="num rate"></div>
      <div class="num sub">${money(total)}</div>
      <div class="line-actions"></div>
    </div>`;
  }

  /** Closes a segment: the same columns, so the figure lands under the sub-totals it
   *  adds up. The separator above already says which segment this is. */
  function segmentSumHtml(total) {
    return `<div class="line segment-sum">
      <div class="detail"></div>
      <div class="num time"></div>
      <div class="num rate"></div>
      <div class="num sub">${money(total)}</div>
      <div class="line-actions"></div>
    </div>`;
  }

  /** What a line is worth, from the numbers this page was actually given. Both are
   *  withheld unless the board is showing cost, so this is often nothing. */
  function lineNumbers(t) {
    // The line's own figures when the board is showing cost; the suggestion otherwise,
    // so a scope-only board still shows the quantities it is allowed to.
    const qty = t.qty ?? t.suggestedQty;
    const rate = t.rate ?? t.suggestedRate;
    const fixed = t.unit === "fixed";
    return {
      time: fixed ? "fixed" : qty !== null && qty !== undefined ? `${qty} ${esc(t.unit || "days")}` : "",
      rate: rate ? money(rate) : "",
      subtotal: !fixed && qty && rate ? qty * rate : fixed && qty ? Number(qty) : 0,
    };
  }

  /**
   * `actions` says which buttons a page offers, and it is the page that decides:
   *   "comment"  the public process page — a name and something to say, nothing else
   *   "both"     the team page — comments and proposals side by side
   *   "propose"  the board, as before
   */
  function lineHtml(t, actions = "propose") {
    if (t.kind === "divider") return dividerHtml(t);
    const assigned = t.proposals.find((p) => p.id === t.assigned);
    const n = lineNumbers(t);
    const buttons =
      actions === "comment"
        ? `<button class="btn ghost small" data-comment="${esc(t.id)}">Add a comment</button>`
        : actions === "both"
          ? `<button class="btn ghost small" data-comment="${esc(t.id)}">Add comment</button>
             <button class="btn ghost small" data-claim="${esc(t.id)}">Add proposal</button>`
          : `<button class="btn ghost small" data-claim="${esc(t.id)}">Add proposal or comment</button>`;
    return `<div class="line" data-id="${esc(t.id)}" data-claimed="${!!assigned}">
      <div class="detail">
        <div class="name">${esc(t.name)}${t.kind === "expense" ? '<span class="tag">expense</span>' : ""}</div>
        ${t.note ? `<div class="note">${esc(t.note)}</div>` : ""}
        ${t.proposals.length ? `<div class="proposals">${t.proposals.map((p) => proposalHtml(t, p)).join("")}</div>` : ""}
        ${
          (t.comments || []).length
            ? `<div class="comments">${t.comments.map((c) => commentHtml(t, c)).join("")}</div>`
            : ""
        }
      </div>
      <div class="num time">${n.time}</div>
      <div class="num rate">${n.rate}</div>
      <div class="num sub">${n.subtotal ? money(n.subtotal) : ""}</div>
      <div class="line-actions">${buttons}</div>
    </div>`;
  }

  // ---------------------------------------------------------------- dialogs

  const MODALS = `
<div class="scrim" id="scrim" hidden></div>

<div class="modal" id="claim-modal" role="dialog" aria-modal="true" aria-labelledby="claim-title" hidden>
  <header>
    <h2 id="claim-title">Add proposal or comment</h2>
    <button class="x" id="claim-close" type="button" aria-label="Close">×</button>
  </header>
  <p class="modal-task" id="claim-task"></p>
  <div class="others" id="claim-others" hidden></div>
  <form id="claim-form">
    <label for="c-name">Your name</label>
    <input id="c-name" type="text" maxlength="60" autocomplete="name" required />
    <p class="identity" id="claim-identity" hidden></p>
    <div class="calc calc-5">
      <div><label for="c-qty">Quantity</label><input id="c-qty" type="number" step="0.5" min="0" /></div>
      <div><label for="c-unit">Unit</label><select id="c-unit"></select></div>
      <div class="times">×</div>
      <div><label for="c-rate">Rate / unit · USD</label><input id="c-rate" type="number" step="25" min="0" /></div>
      <div class="equals">=</div>
      <div class="calc-total"><label>Line total</label><output id="c-total">$0</output></div>
    </div>
    <label for="c-notes">Task details</label>
    <textarea id="c-notes" rows="4" maxlength="600"
              placeholder="What this covers, what it assumes, anything the estimate depends on…"></textarea>
    <div class="modal-actions">
      <button class="btn" type="submit" id="claim-submit">Submit proposal</button>
      <button class="btn ghost" type="button" id="claim-release" hidden>Withdraw</button>
    </div>
  </form>
</div>

<div class="modal" id="comment-modal" role="dialog" aria-modal="true" aria-labelledby="comment-title" hidden>
  <header>
    <h2 id="comment-title">Add a comment</h2>
    <button class="x" id="comment-close" type="button" aria-label="Close">×</button>
  </header>
  <p class="modal-task" id="comment-task"></p>
  <form id="comment-form">
    <label for="cm-name">Your name</label>
    <input id="cm-name" type="text" maxlength="60" autocomplete="name" required />
    <label for="cm-text">Comment</label>
    <textarea id="cm-text" rows="5" maxlength="1000" required
              placeholder="A question, a caveat, something the line should account for…"></textarea>
    <div class="modal-actions">
      <button class="btn" type="submit">Post comment</button>
    </div>
  </form>
</div>

<div class="modal" id="task-modal" role="dialog" aria-modal="true" aria-labelledby="task-title" hidden>
  <header>
    <h2 id="task-title">Add task</h2>
    <button class="x" id="task-close" type="button" aria-label="Close">×</button>
  </header>
  <p class="modal-task" id="task-phase"></p>
  <form id="task-form">
    <label for="t-name">Task</label>
    <input id="t-name" type="text" maxlength="90" required />
    <label for="t-note">Detail</label>
    <textarea id="t-note" rows="3" maxlength="300" placeholder="What it covers and why it is needed…"></textarea>
    <div class="calc">
      <div><label for="t-qty">Quantity</label><input id="t-qty" type="number" step="0.5" min="0" value="1" /></div>
      <div class="times">×</div>
      <div><label for="t-unit">Unit</label><select id="t-unit"></select></div>
    </div>
    <div class="modal-actions"><button class="btn" type="submit">Add task</button></div>
  </form>
</div>`;

  const $ = (id) => document.getElementById(id);
  let claimingId = null;
  let myProposalId = null;

  function unitOptions(sel, selected) {
    sel.innerHTML = state.units
      .map((u) => `<option value="${u}"${u === selected ? " selected" : ""}>${u}</option>`)
      .join("");
  }

  function openClaim(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    claimingId = id;

    const remembered = localStorage.getItem("budget-name") || "";
    const mine = t.proposals.find((p) => p.name.toLowerCase() === remembered.toLowerCase());
    myProposalId = mine?.id || null;

    $("claim-task").innerHTML = `<b>${esc(t.name)}</b>${t.note ? " — " + esc(t.note) : ""}`;

    // Several people can propose for the same line. Show who already has, so it is
    // clear you are adding to a list rather than overwriting someone.
    const others = t.proposals.filter((p) => p.id !== mine?.id);
    const box = $("claim-others");
    if (others.length) {
      box.hidden = false;
      box.innerHTML =
        `<span class="others-label">Already proposed</span>` +
        others
          .map(
            (p) => `<div class="other${state.money ? "" : " scope-only"}">
              <span class="who">${esc(p.name)}</span>
              <span class="terms">${terms(p)}</span>
              ${state.money ? `<span class="amt">${money(p.amount)}</span>` : ""}
            </div>`
          )
          .join("") +
        `<p class="others-note">Yours is added alongside these — it does not replace them.</p>`;
    } else {
      box.hidden = true;
    }

    // One browser remembers one name. Make that visible, so the next person to use
    // this machine does not silently submit under someone else's identity.
    const identity = $("claim-identity");
    if (remembered) {
      identity.hidden = false;
      identity.innerHTML = `Proposing as <b>${esc(remembered)}</b> · <button type="button" class="linkish inline" id="switch-person">not you?</button>`;
    } else {
      identity.hidden = true;
    }

    $("c-name").value = mine?.name || remembered;
    $("c-qty").value = mine?.qty ?? t.suggestedQty ?? "";
    unitOptions($("c-unit"), mine?.unit || t.unit || "days");
    $("c-rate").value = mine?.rate ?? t.suggestedRate ?? "";
    // With the budget hidden your own rate never reached this page. Leaving the field
    // blank would read as "you have no rate"; it means "leave it as it was".
    $("c-rate").placeholder = !state.money && mine ? "unchanged" : "";
    $("c-notes").value = mine?.notes || "";
    $("claim-submit").textContent = mine ? "Update your proposal" : "Add your proposal";
    $("claim-release").hidden = !mine;

    calcClaim();
    show($("claim-modal"));
    $("c-name").focus();
  }

  function calcClaim() {
    const qty = Number($("c-qty").value) || 0;
    const rate = Number($("c-rate").value) || 0;
    // No rate in hand on a scope-only board means the total is unknown, not zero.
    if (!state.money && !$("c-rate").value) {
      $("c-total").textContent = "—";
      return;
    }
    $("c-total").textContent = money($("c-unit").value === "fixed" ? rate : qty * rate);
  }

  let addingPhase = null;
  let addingFromProcess = false;
  let commentingId = null;

  function openComment(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    commentingId = id;
    $("comment-task").innerHTML = `<b>${esc(t.name)}</b>${t.note ? " — " + esc(t.note) : ""}`;
    $("cm-name").value = localStorage.getItem("budget-name") || "";
    $("cm-text").value = "";
    show($("comment-modal"));
    $("cm-name").focus();
  }

  /**
   * `choices` is for callers whose own idea of a phase covers several of the budget's —
   * the deck's process slide folds the budget's three Phase 2 buckets into one section,
   * and a task added there could belong to any of them. Rather than guess, ask.
   */
  function openAdd(phaseId, choices) {
    const p = state.phases.find((x) => x.id === phaseId);
    if (!p) return;
    addingPhase = phaseId;

    const options = (choices || []).filter((id) => state.phases.some((x) => x.id === id));
    if (options.length > 1) {
      $("task-phase").innerHTML =
        `Which part of the budget does it belong to?` +
        `<select id="t-phase">` +
        options
          .map((id) => {
            const ph = state.phases.find((x) => x.id === id);
            return `<option value="${esc(id)}"${id === phaseId ? " selected" : ""}>${esc(ph.title)}</option>`;
          })
          .join("") +
        `</select>`;
    } else {
      $("task-phase").innerHTML = `Adding to <b>${esc(p.title)}</b>`;
    }
    $("t-name").value = "";
    $("t-note").value = "";
    $("t-qty").value = 1;
    unitOptions($("t-unit"), "days");
    show($("task-modal"));
    $("t-name").focus();
  }

  function show(m) {
    $("scrim").hidden = false;
    m.hidden = false;
  }

  function hide(m) {
    $("scrim").hidden = true;
    m.hidden = true;
  }

  const hideAll = () => {
    hide($("claim-modal"));
    hide($("task-modal"));
    if ($("comment-modal")) hide($("comment-modal"));
  };

  function mountModals() {
    if ($("claim-modal")) return; // the page supplied its own
    const host = document.createElement("div");
    host.className = "budget-dialogs";
    host.innerHTML = MODALS;
    document.body.appendChild(host);

    ["c-qty", "c-rate"].forEach((id) => $(id).addEventListener("input", calcClaim));
    $("c-unit").addEventListener("change", calcClaim);

    $("claim-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      localStorage.setItem("budget-name", $("c-name").value.trim());
      const ok = await send("propose", {
        id: claimingId,
        name: $("c-name").value,
        qty: $("c-qty").value,
        unit: $("c-unit").value,
        rate: $("c-rate").value,
        notes: $("c-notes").value,
      });
      if (ok) hide($("claim-modal"));
    });

    $("claim-release").addEventListener("click", async () => {
      if (myProposalId && (await send("withdraw", { id: claimingId, proposalId: myProposalId }))) hide($("claim-modal"));
    });

    $("task-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const chosen = $("t-phase");
      const ok = await send("task", {
        phase: chosen ? chosen.value : addingPhase,
        fromProcess: addingFromProcess,
        name: $("t-name").value,
        note: $("t-note").value,
        qty: $("t-qty").value,
        unit: $("t-unit").value,
        role: $("t-unit").value === "fixed" ? "fixed" : "researcher",
      });
      if (ok) hide($("task-modal"));
    });

    $("comment-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      localStorage.setItem("budget-name", $("cm-name").value.trim());
      const ok = await post(commentPath, {
        id: commentingId,
        name: $("cm-name").value,
        text: $("cm-text").value,
      });
      if (ok) hide($("comment-modal"));
    });

    $("comment-close").addEventListener("click", hideAll);
    $("claim-close").addEventListener("click", hideAll);
    $("task-close").addEventListener("click", hideAll);
    $("scrim").addEventListener("click", hideAll);
  }

  // The deck also listens for Escape and for arrow keys; a dialog must swallow both
  // rather than let a keystroke page the slide behind it.
  function keyGuard(e) {
    const open = $("claim-modal") && !$("claim-modal").hidden;
    const openTask = $("task-modal") && !$("task-modal").hidden;
    const openComment = $("comment-modal") && !$("comment-modal").hidden;
    if (!open && !openTask && !openComment) return;
    if (e.key === "Escape") hideAll();
    e.stopPropagation();
  }

  document.addEventListener("click", (e) => {
    // hand the machine to someone else without clearing site data
    if (e.target.id === "switch-person") {
      localStorage.removeItem("budget-name");
      myProposalId = null;
      $("c-name").value = "";
      $("c-notes").value = "";
      $("claim-identity").hidden = true;
      $("claim-submit").textContent = "Add your proposal";
      $("claim-release").hidden = true;
      $("c-name").focus();
      return;
    }
    const commentBtn = e.target.closest("[data-comment]");
    if (commentBtn) return openComment(commentBtn.dataset.comment);
    const claimBtn = e.target.closest("[data-claim]");
    if (claimBtn) return openClaim(claimBtn.dataset.claim);
    const addBtn = e.target.closest("[data-add]");
    if (addBtn) {
      addingFromProcess = addBtn.dataset.addProcess === "1";
      return openAdd(addBtn.dataset.add, (addBtn.dataset.addChoices || "").split(/\s+/).filter(Boolean));
    }
  });

  document.addEventListener("keydown", keyGuard, true);

  // ---------------------------------------------------------------- staying current
  //
  // There is no stream to listen to: the host answers a request and forgets. So the
  // board is re-read whenever this tab comes back to the front, which is when someone
  // is about to look at it, and after every change of your own.

  function connect() {
    onStatus("live");
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) load().catch(() => onStatus("offline"));
    });
    window.addEventListener("focus", () => load().catch(() => {}));
  }

  // Mounting twice on one page must not open two streams or two sets of dialogs.
  let started = false;

  return {
    get state() {
      return state;
    },
    get loaded() {
      return loaded;
    },
    esc,
    money,
    terms,
    lineHtml,
    commentHtml,
    lineNumbers,
    segmentSumHtml,
    phaseTotalHtml,
    estimateTotals,
    estimateRowsHtml,
    proposalHtml,
    suggestionHtml,
    send,
    load,
    openClaim,
    openComment,
    openAdd,
    onRender(fn) {
      renderers.push(fn);
      if (loaded) fn(state);
    },
    start(opts) {
      if (opts && opts.onStatus) onStatus = opts.onStatus;
      if (opts && opts.source) source = opts.source;
      if (opts && opts.commentPath) commentPath = opts.commentPath;
      if (opts && opts.showsBothKinds) showsBothKinds = true;
      if (started) return;
      started = true;
      mountModals();
      load().then(connect).catch(() => onStatus("offline"));
    },
  };
})();
