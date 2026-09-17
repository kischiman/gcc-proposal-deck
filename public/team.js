// The team view of the process.
//
// The fullest picture there is: every phase and its lines, what each is estimated at,
// every proposal, and every comment the public has left — with both buttons on each
// line. The public deck shows the comments and not the proposals; this page is where
// the two are read together.
//
// Lines, dialogs and the estimate come from budget-core.js, the same as the board and
// the deck, so a figure here cannot disagree with a figure there.

const $ = (id) => document.getElementById(id);

const phasesEl = $("phases");
const summaryEl = $("summary");
const liveEl = $("live");

const { esc, money, lineHtml, estimateRowsHtml } = Budget;

function render(state) {
  phasesEl.innerHTML = state.phases
    .map((p) => {
      const tasks = state.tasks.filter((t) => t.phase === p.id);
      if (!tasks.length) return "";
      const proposals = tasks.reduce((a, t) => a + t.proposals.length, 0);
      const comments = tasks.reduce((a, t) => a + (t.comments || []).length, 0);
      const said = [
        proposals ? `${proposals} proposal${proposals === 1 ? "" : "s"}` : "",
        comments ? `${comments} comment${comments === 1 ? "" : "s"}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return `<section class="phase" data-phase="${esc(p.id)}">
        <header>
          <div>
            <h2>${esc(p.title)}</h2>
            <p class="note">${esc(p.note)}</p>
            ${p.owner ? `<p class="owner-name">Owner · <b>${esc(p.owner)}</b></p>` : ""}
          </div>
          <span class="amount">${said || "nothing yet"}</span>
        </header>
        ${tasks.map((t) => lineHtml(t, "both")).join("")}
      </section>`;
    })
    .join("");

  summaryEl.innerHTML = estimateRowsHtml(state);
}

Budget.onRender(render);
Budget.start({
  // Everything, regardless of what the public deck is set to show.
  source: "/api/team",
  // A comment written here stays with the team; the deck's own route makes public ones.
  commentPath: "/api/team/comment",
  showsBothKinds: true,
  onStatus(kind, msg) {
    if (kind === "live") {
      liveEl.textContent = "live";
      liveEl.setAttribute("data-on", "true");
      return;
    }
    liveEl.removeAttribute("data-on");
    liveEl.textContent = kind === "error" ? msg : kind === "offline" ? "offline" : "reconnecting…";
  },
});
