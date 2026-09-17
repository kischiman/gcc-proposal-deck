// Public budget dashboard. Collaborators propose themselves for lines; who actually
// goes on the project is decided in the admin panel. The base rate card is not in this
// payload at all unless the admin has switched pre-filling on.
//
// Lines, dialogs and the live connection come from budget-core.js, which the deck
// mounts too. What is left here is this page's own layout: the phase sections and
// the summary block underneath them.

const $ = (id) => document.getElementById(id);

const phasesEl = $("phases");
const summaryEl = $("summary");
const liveEl = $("live");

const { esc, money, lineHtml, estimateRowsHtml } = Budget;

function render(state) {
  phasesEl.innerHTML = state.phases
    .map((p) => {
      const tasks = state.tasks.filter((t) => t.phase === p.id);
      const proposed = tasks.reduce(
        (a, t) => a + t.proposals.reduce((b, x) => b + (t.assigned === x.id ? x.amount : 0), 0),
        0
      );
      // A divider is a separator, not something anyone can be put on.
      const open = tasks.filter((t) => !t.assigned && t.kind !== "divider").length;
      return `<section class="phase">
        <header>
          <div>
            <h2>${esc(p.title)}</h2>
            <p class="note">${esc(p.note)}</p>
            ${p.owner ? `<p class="owner-name">Owner · <b>${esc(p.owner)}</b></p>` : ""}
          </div>
          <span class="amount">${open} open${
            state.money && proposed ? ` · ${money(proposed)} committed` : ""
          }</span>
        </header>
        ${tasks.map(lineHtml).join("")}
        <div class="phase-foot">
          <button class="btn ghost small" data-add="${esc(p.id)}">+ Add task</button>
        </div>
      </section>`;
    })
    .join("");

  const all = state.tasks.filter((t) => t.kind !== "divider");
  const committed = all.reduce((a, t) => {
    const p = t.proposals.find((x) => x.id === t.assigned);
    return a + (p ? p.amount : 0);
  }, 0);
  const proposals = all.reduce((a, t) => a + t.proposals.length, 0);
  const staffed = all.filter((t) => t.assigned).length;

  const scope = `
    <div class="row"><span>Lines</span><span class="v">${all.length}</span></div>
    <div class="row"><span>Proposals submitted</span><span class="v">${proposals}</span></div>
    <div class="row"><span>Lines with someone on them</span><span class="v">${staffed}</span></div>`;

  // The same rows the process slide shows, from the same function — the two boards
  // disagreeing about what the project costs was the whole problem.
  const estimate = estimateRowsHtml(state);

  // Only worth a line once somebody is actually on something.
  const committedRow = committed
    ? `<div class="row sub"><span>Committed so far</span><span class="v">${money(committed)}</span></div>`
    : "";

  summaryEl.innerHTML = scope + estimate + committedRow;
}

Budget.onRender(render);
Budget.start({
  onStatus(kind, msg) {
    if (kind === "live") {
      liveEl.textContent = "live";
      liveEl.setAttribute("data-on", "true");
      return;
    }
    liveEl.removeAttribute("data-on");
    liveEl.textContent = kind === "error" ? msg : kind === "offline" ? "offline" : "reconnecting…";
    if (kind === "error") setTimeout(() => Budget.state && (liveEl.textContent = "live", liveEl.setAttribute("data-on", "true")), 2500);
  },
});
