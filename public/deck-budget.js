// The budget, mounted into the deck in two places.
//
//  · slide 2 — each phase's lines: the work in the order the admin panel sets, then
//    what the phase costs to run underneath it, each with its scope, the comments
//    people have left, and one button to leave another. Proposals are the team's
//    working material and live on /team and the board, not here.
//  · slide 4 — the whole board
//
// Both come from budget-core.js, so a proposal made on either slide, on the phone, or
// on /budget shows up everywhere at once over the same live connection.
//
// Without a server there is no budget: the static artifact keeps the plain step list
// that is already in the markup, and this file never replaces it.

(function () {
  if (!window.Budget) return;

  const board = document.getElementById("deck-budget-board");
  const summary = document.getElementById("deck-budget-summary");
  const liveEl = document.getElementById("deck-budget-live");
  // The process slide is written from the phases the admin panel holds. The markup
  // ships hand-written blocks as the no-server fallback; this replaces them the moment
  // real phases arrive, so adding a phase in the panel adds a section to the proposal.
  const phasesHost = document.getElementById("deck-phases");

  if (!board && !phasesHost) return;

  const { esc, money, lineHtml, lineNumbers, segmentSumHtml, phaseTotalHtml, estimateRowsHtml } = Budget;

  // ------------------------------------------------ slide 2 · the process steps

  /** The phases added up, contingency included, in the board's own summary box. */
  function renderProcessSummary(state) {
    const el = document.getElementById("process-summary");
    // Nothing priced yet — an empty box says less than no box.
    if (el) el.innerHTML = estimateRowsHtml(state);
  }

  /** One phase, exactly as the panel describes it.
   *
   *  The header has three slots and they are not interchangeable: .phase-num is a small
   *  mono label, .phase-title is the serif headline that takes the width, .phase-dur is
   *  the mono figure on the right. A title like "Phase 2 · Design" carries both the
   *  label and the headline, so it is split — "Phase 2" to the label, "Design" to the
   *  headline — and the description drops to a lede, where a sentence can breathe
   *  instead of being set at 20px serif as though it were a title. */
  function phaseArticle(p, index) {
    const items = (list) => (list || []).map((s) => `<li>${esc(s)}</li>`).join("");
    const parts = String(p.title || "").split("·");
    const label = parts.length > 1 ? parts[0].trim() : `Phase ${index + 1}`;
    const headline = parts.length > 1 ? parts.slice(1).join("·").trim() : String(p.title || "").trim();

    // Only the first phase opens. Six expanded phases is a wall of text to scroll past
    // before the slide says anything; the rest open when someone asks for them.
    const open = index === 0;

    return `<article class="phase" data-open="${open}">
      <button class="phase-head" type="button" aria-expanded="${open}">
        <span class="phase-num">${esc(label)}</span>
        <span class="phase-title">${esc(headline)}</span>
        <span class="phase-dur">${esc([p.duration, p.fee].filter(Boolean).join(" · "))}</span>
        <span class="phase-owner">${esc(p.owner || "")}</span>
        <span class="chev" aria-hidden="true"></span>
      </button>
      <div class="phase-body">
        ${p.note ? `<p class="phase-lede">${esc(p.note)}</p>` : ""}
        <div class="phase-top">
          <div><h3>Objectives</h3><ul>${items(p.objectives)}</ul></div>
          <div><h3>Outcomes</h3><ul>${items(p.outcomes)}</ul></div>
        </div>
        <div class="phase-process">
          <h3>Process</h3>
          <div class="plines" data-budget-phases="${esc(p.id)}"></div>
        </div>
      </div>
    </article>`;
  }

  // These blocks are drawn after deck.js wired its collapse handlers, so the toggle is
  // delegated from the container rather than bound to buttons that did not exist yet.
  if (phasesHost) {
    phasesHost.addEventListener("click", (e) => {
      const head = e.target.closest(".phase-head");
      if (!head) return;
      const phase = head.closest(".phase");
      const open = phase.dataset.open !== "true";
      phase.dataset.open = String(open);
      head.setAttribute("aria-expanded", String(open));
    });
  }

  function renderSteps(state) {
    // Replace the fallback with what the panel actually holds.
    if (phasesHost && Array.isArray(state.phases) && state.phases.length) {
      phasesHost.innerHTML = state.phases.map((p, i) => phaseArticle(p, i)).join("");
    }

    for (const host of [...document.querySelectorAll("[data-budget-phases]")]) {
      const phases = host.dataset.budgetPhases.split(/\s+/);
      const lines = state.tasks.filter((t) => phases.includes(t.phase));

      // The work first, in the order set in the admin panel, then what the phase costs
      // to run underneath it. Splitting them is the one ordering this page imposes:
      // an apartment is not a step, and reading it among the steps suggests it is.
      const work = lines.filter((t) => t.kind !== "expense");
      const expenses = lines.filter((t) => t.kind === "expense");

      // Walk the work in order, closing each segment with its own sum before the next
      // separator opens one. A segment with nothing to add up is closed silently —
      // a row reading $0 says less than no row at all.
      const rows = [];
      let inSegment = false;
      let openSum = 0;
      const closeSegment = () => {
        if (inSegment && openSum) rows.push(segmentSumHtml(openSum));
        inSegment = false;
        openSum = 0;
      };
      for (const t of work) {
        if (t.kind === "divider") {
          closeSegment();
          inSegment = true;
        } else if (inSegment) {
          openSum += lineNumbers(t).subtotal;
        }
        rows.push(lineHtml(t, "comment"));
      }
      closeSegment();

      // Expenses are a segment like any other, and close the same way.
      if (expenses.length) {
        rows.push(`<div class="line divider expenses-mark"><span class="divider-name">Expenses</span></div>`);
        rows.push(...expenses.map((t) => lineHtml(t, "comment")));
        const expenseTotal = expenses.reduce((a, t) => a + lineNumbers(t).subtotal, 0);
        if (expenseTotal) rows.push(segmentSumHtml(expenseTotal));
      }

      // Everything in the phase, work and expenses together.
      const phaseTotal = lines
        .filter((t) => t.kind !== "divider")
        .reduce((a, t) => a + lineNumbers(t).subtotal, 0);
      if (phaseTotal) rows.push(phaseTotalHtml(phaseTotal));


      host.innerHTML =
        rows.join("") +
        `<div class="plines-add">
          <button class="btn ghost small" data-add="${phases[0]}" data-add-choices="${phases.join(" ")}" data-add-process="1">
            + Add task
          </button>
        </div>`;
      host.classList.add("budget-scope", "plines-live");
    }

    renderProcessSummary(state);
  }

  // ------------------------------------------------------- slide 4 · the board

  function renderBoard(state) {
    if (!board) return;

    board.innerHTML = state.phases
      .map((p) => {
        const tasks = state.tasks.filter((t) => t.phase === p.id);
        if (!tasks.length) return "";
        const open = tasks.filter((t) => !t.assigned && t.kind !== "divider").length;
        const proposed = tasks.reduce(
          (a, t) => a + t.proposals.reduce((b, x) => b + (t.assigned === x.id ? x.amount : 0), 0),
          0
        );
        return `<section class="phase">
          <header>
            <div>
              <h2>${esc(p.title)}</h2>
              <p class="note">${esc(p.note)}</p>
            </div>
            <span class="amount">${open} open${
              state.money && proposed ? ` · ${money(proposed)} committed` : ""
            }</span>
          </header>
          ${tasks.map(lineHtml).join("")}
        </section>`;
      })
      .join("");

    if (!summary) return;
    const all = state.tasks.filter((t) => t.kind !== "divider");
    const proposals = all.reduce((a, t) => a + t.proposals.length, 0);
    const staffed = all.filter((t) => t.assigned).length;
    const committed = all.reduce((a, t) => {
      const p = t.proposals.find((x) => x.id === t.assigned);
      return a + (p ? p.amount : 0);
    }, 0);

    const rows = `
      <div class="row"><span>Lines</span><span class="v">${all.length}</span></div>
      <div class="row"><span>Proposals submitted</span><span class="v">${proposals}</span></div>
      <div class="row"><span>Lines with someone on them</span><span class="v">${staffed}</span></div>`;

    summary.innerHTML = state.money
      ? `${rows}<div class="row total"><span>Committed so far</span><span class="v">${money(committed)}</span></div>`
      : rows;
  }

  Budget.onRender((state) => {
    renderSteps(state);
    renderBoard(state);
  });

  Budget.start({
    onStatus(kind, msg) {
      if (!liveEl) return;
      if (kind === "live") {
        liveEl.textContent = "live";
        liveEl.setAttribute("data-on", "true");
        return;
      }
      liveEl.removeAttribute("data-on");
      liveEl.textContent = kind === "error" ? msg : kind === "offline" ? "offline" : "reconnecting…";
    },
  });
})();
