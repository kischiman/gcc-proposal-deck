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
  const stepHosts = [...document.querySelectorAll("[data-budget-phases]")];

  if (!board && !stepHosts.length) return;

  const { esc, money, lineHtml, lineNumbers, segmentSumHtml, phaseTotalHtml, estimateRowsHtml } = Budget;

  // ------------------------------------------------ slide 2 · the process steps

  /** The phases added up, contingency included, in the board's own summary box. */
  function renderProcessSummary(state) {
    const el = document.getElementById("process-summary");
    // Nothing priced yet — an empty box says less than no box.
    if (el) el.innerHTML = estimateRowsHtml(state);
  }

  function renderSteps(state) {
    for (const host of stepHosts) {
      const phases = host.dataset.budgetPhases.split(/\s+/);
      const lines = state.tasks.filter((t) => phases.includes(t.phase));
      // No lines for this phase yet — leave the static list alone rather than replacing
      // a readable fallback with an empty box.
      if (!lines.length) continue;

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

      // The phase headers on this slide are written by hand, not rendered from the
      // board, so the owner has to be placed into the one above this list.
      const owner = state.phases.find((p) => phases.includes(p.id))?.owner || "";
      const slot = host.closest(".phase")?.querySelector(".phase-owner");
      if (slot) slot.textContent = owner ? `${owner}` : "";
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
