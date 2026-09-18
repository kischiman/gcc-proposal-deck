// Shared state for the budget model.
//
// Two audiences. The public dashboard lets collaborators propose themselves for lines —
// quantity, unit, rate. The admin panel is the only place the base rate card exists, and
// the only place proposals get accepted onto the project.
//
// State is in memory and mirrored to JSON so a restart doesn't lose the day's work.
// Free hosting has an ephemeral disk, so Export is the real backup.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as persist from "./budget-persist.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.BUDGET_FILE || path.join(HERE, "..", "budget-state.json");

/** What a fresh document starts with — a starting point, not a fixture. Phases live in
 *  the document and are added, renamed, reordered and removed from the admin panel, so
 *  nothing below reads this constant after seeding. */
const DEFAULT_PHASES = [
  { id: "p1", title: "Phase 1", note: "", duration: "", objectives: [], outcomes: [] },
  { id: "p2", title: "Phase 2", note: "", duration: "", objectives: [], outcomes: [] },
  { id: "p3", title: "Phase 3", note: "", duration: "", objectives: [], outcomes: [] },
];

const newPhases = () => DEFAULT_PHASES.map((p) => ({ ...p, objectives: [], outcomes: [] }));

/** Phases as the document holds them. Everything reads through this rather than the
 *  seed, so a phase added in the panel is as real as one that shipped. */
const phaseList = () => (Array.isArray(state.phases) ? state.phases : []);
const hasPhase = (id) => phaseList().some((p) => p.id === id);

/** Shape whatever storage returns, so a document written before phases were editable
 *  gains the fields the panel now edits instead of rendering undefined onto the deck. */
function normalisePhase(p, i) {
  const lines = (v) =>
    Array.isArray(v) ? v.map((s) => String(s).trim().slice(0, 300)).filter(Boolean) : [];
  return {
    id: String(p?.id || `p${i + 1}`),
    title: String(p?.title ?? "").trim().slice(0, 90),
    note: String(p?.note ?? "").trim().slice(0, 300),
    duration: String(p?.duration ?? "").trim().slice(0, 40),
    // What this phase costs, in the words the proposal uses — "US$10,000", "included
    // in the package", "by number of projects". Deliberately text: a phase's fee is a
    // commercial statement, not a number the board should try to add up.
    fee: String(p?.fee ?? "").trim().slice(0, 80),
    objectives: lines(p?.objectives),
    outcomes: lines(p?.outcomes),
  };
}

// Key names are load-bearing — totals and the admin rate card read them — so they stay.
// The figures start at zero: this proposal's rates are set in the admin panel.
export const DEFAULT_RATES = {
  principal: 0,
  researcher: 0,
  designer: 0,
  engineer: 0,
  pm: 0,
  apartment: 0,
  perdiem: 0,
  contingency: 0,
};

export const UNITS = ["days", "weeks", "months", "sessions", "fixed"];

function seed() {
  // Nothing is seeded for this proposal. Lines are added in the admin panel, and the
  // process slide fills itself from whatever is added under each phase.
  return [];
}


const fresh = () => ({
  rates: { ...DEFAULT_RATES },
  settings: {},
  // Editable from the panel, so they belong to the document rather than the code.
  phases: newPhases(),
  // Who is carrying each phase, keyed by phase id. PHASES itself is a constant, so
  // this cannot live on it.
  owners: {},
  // Seed lines someone has deleted, so the backfill leaves them deleted.
  removed: [],
  // Slide 4's capture. It used to live in the server's memory, which a serverless host
  // does not have between one request and the next.
  workshop: { bottlenecks: [], nextId: 1, generation: null },
  tasks: seed(),
  updatedAt: Date.now(),
});

let state = fresh();
let origin = "seed";

/** Called once at startup, before the server accepts requests. */
export async function init() {
  const { state: loaded, source } = await persist.loadInitial(FILE);
  origin = source;
  // Merge first — the backfill inside migrate() decides what is already on the board
  // by phase and name, and would not recognize a line still tagged with an old bucket.
  state = foldIntoProcess(loaded ? migrate(mergePhaseTwo(loaded)) : fresh());
  if (!loaded) origin = "seed";
  console.log(`[budget] state from ${origin} · storage: ${persist.describe()}`);
  return origin;
}

export const storageInfo = () => ({
  origin,
  durable: persist.usingGist(),
  where: persist.describe(),
});

/** Push any coalesced write out — called on shutdown so a deploy can't drop it. */
export const flush = () => persist.flush();

/** Write the document out and wait for it — the serverless path. */
export const commit = () => persist.saveNow(state, FILE);

/** Re-read before serving. Two functions can run at once on different machines, so a
 *  copy held in memory from a previous request is a guess, not the board. */
export async function reload() {
  const { state: loaded } = await persist.loadInitial(FILE);
  if (loaded) state = foldIntoProcess(migrate(mergePhaseTwo(loaded)));
  return state;
}

export const getWorkshop = () => {
  state.workshop = state.workshop || { bottlenecks: [], nextId: 1, generation: null };
  return state.workshop;
};

/**
 * The deck's process slide is the public view of this budget, so the board carries the
 * same lines. Every fee line that is not one of those steps is folded into a single
 * priced "Delivery" line for its phase: the phase total is unchanged, and any proposals
 * sitting on the folded lines move across rather than disappearing with them. Expenses
 * are left where they are — they were never process steps and are not meant to be.
 *
 * Runs once, and records that it has. Without the flag, a task added later from /budget
 * — neither a process step nor an expense — would be folded away on the next boot.
 */
/** "Phase 2 · Build" → "Delivery · Build". The deck shows all three of Phase 2's
 *  buckets in one section, where three rows called "Delivery" are indistinguishable. */
function deliveryName(phase) {
  const title = phaseList().find((p) => p.id === phase)?.title || "";
  const tail = title.split("·").pop().trim();
  return tail ? `Delivery · ${tail}` : "Delivery";
}

/** Phase 2 was three buckets; it is one. Retagging is enough — order is preserved,
 *  and nothing else in a task depends on which bucket it used to sit in. */
function mergePhaseTwo(raw) {
  if (!raw || !Array.isArray(raw.tasks)) return raw;
  for (const t of raw.tasks) {
    if (t.phase === "p2a" || t.phase === "p2b" || t.phase === "p2c") t.phase = "p2";
  }
  return raw;
}

function foldIntoProcess(raw) {
  raw.settings = raw.settings || {};
  if (raw.settings.foldedToProcess) {
    // Folded before the lines were named per phase. Only the untouched default is
    // rewritten, so an admin's own name for a line is never overwritten — which also
    // makes this safe to run on every boot.
    for (const t of raw.tasks) {
      if (t.id.endsWith("-delivery") && t.name === "Delivery") t.name = deliveryName(t.phase);
    }
    return raw;
  }

  const keep = [];
  const byPhase = new Map();
  for (const t of raw.tasks) {
    if (t.fromProcess || t.kind === "expense") {
      keep.push(t);
      continue;
    }
    if (!byPhase.has(t.phase)) byPhase.set(t.phase, []);
    byPhase.get(t.phase).push(t);
  }

  for (const [phase, folded] of byPhase) {
    // A fixed line's quantity is its amount, which is the only shape that can hold a
    // sum of lines that were quoted in different units at different rates.
    const amount = folded.reduce((a, t) => a + baseAmount(t), 0);
    keep.push({
      id: `${phase}-delivery`,
      phase,
      name: deliveryName(phase),
      note: `Folded from ${folded.length} line${folded.length === 1 ? "" : "s"}: ${folded
        .map((t) => t.name)
        .join("; ")}`.slice(0, 300),
      qty: amount,
      unit: "fixed",
      rate: null,
      kind: "fee",
      proposals: folded.flatMap((t) => t.proposals || []),
      // Several folded lines could each have had someone on them; only one can be on
      // the line that replaces them, so the rest go back to being proposals.
      assigned: folded.map((t) => t.assigned).find(Boolean) || null,
      prefill: false,
      fromProcess: false,
      // A fixed amount that is nonetheless a fee — see updateTask.
      folded: true,
    });
  }

  raw.tasks = keep;
  raw.settings.foldedToProcess = true;
  return raw;
}

function migrate(raw) {
  try {
    if (Array.isArray(raw.tasks) && raw.rates) {
      raw.settings = raw.settings || {};
      raw.owners = raw.owners || {};
      raw.removed = raw.removed || [];
      // Documents written before phases were editable carry none; they get the seed.
      raw.phases =
        Array.isArray(raw.phases) && raw.phases.length
          ? raw.phases.map(normalisePhase)
          : newPhases();
      raw.workshop = raw.workshop || { bottlenecks: [], nextId: 1, generation: null };
      // the prefill switch used to be global; carry it onto each task
      const wasGlobal = raw.settings.prefillRates === true;
      delete raw.settings.prefillRates;
      for (const t of raw.tasks) {
        if (typeof t.prefill !== "boolean") t.prefill = wasGlobal;
      }
      // lines used to derive their cost from a role; give each one its own rate
      for (const t of raw.tasks) {
        if (typeof t.rate !== "number" && t.rate !== null) {
          t.rate = t.role === "fixed" ? null : raw.rates?.[t.role] ?? 0;
        }
        if (t.role === "fixed") t.unit = "fixed";
        delete t.role;
      }

      for (const t of raw.tasks) {
        if (!Array.isArray(t.comments)) t.comments = [];
        // Comments written before there were two kinds are the team's: they carry rates,
        // costings and questions between the people pricing this.
        for (const c of t.comments) if (!c.visibility) c.visibility = "team";
      }

      // migrate the earlier single-claim shape
      for (const t of raw.tasks) {
        if (!Array.isArray(t.proposals)) {
          t.proposals = t.claim
            ? [{ id: "m" + Math.random().toString(36).slice(2, 8), name: t.claim.name, qty: t.qty, unit: t.unit, rate: t.rateOverride || null, notes: t.claim.notes, at: t.claim.at }]
            : [];
          t.assigned = null;
          delete t.claim;
          delete t.rateOverride;
        }
      }

      // Lines added to the seed after this state was written — the research-process
      // steps, for instance. Append only: a stored line is never overwritten or
      // removed, so quantities, rates and proposals already in flight are untouched.
      const known = new Set(raw.tasks.map((t) => t.id));
      // Merging Phase 2's three buckets changed the ids the seed generates, so identity
      // by id alone would see every one of those lines as new and add it a second time.
      // A line already on the board under its old id is the same line.
      const byName = new Set(raw.tasks.map((t) => `${t.phase}|${t.name}`));
      // Lines someone deleted stay deleted. Both keys are held because merging Phase 2
      // changed the ids the seed generates, so an older removal is recorded by name.
      const removed = new Set(raw.removed || []);
      for (const t of seed()) {
        if (known.has(t.id) || byName.has(`${t.phase}|${t.name}`)) continue;
        if (removed.has(t.id) || removed.has(`${t.phase}|${t.name}`)) continue;
        // Once folded, the seed's own fee lines are exactly what was folded away —
        // re-adding them here would undo the fold on every boot.
        if (raw.settings?.foldedToProcess && !t.fromProcess && t.kind !== "expense") continue;
        raw.tasks.push(t);
      }

      return raw;
    }
  } catch (err) {
    console.error("[budget] could not migrate stored state:", err.message);
  }
  return fresh();
}

function save() {
  state.updatedAt = Date.now();
  persist.save(state, FILE);
}

// ---------------------------------------------------------------- reads

export const getState = () => state;

const proposalOf = (t) => t.proposals.find((p) => p.id === t.assigned) || null;

/** The admin's own estimate for a line: a fixed sum, or quantity x rate. */
export function baseAmount(task) {
  if (task.kind === "divider") return 0;
  if (task.unit === "fixed") return Number(task.qty) || 0;
  return (Number(task.qty) || 0) * (Number(task.rate) || 0);
}

/** What the line costs once someone is on it; falls back to the base estimate. */
export function effectiveAmount(task) {
  if (task.kind === "divider") return 0;
  const p = proposalOf(task);
  if (!p) return baseAmount(task);
  // Someone on the line who named no rate does not make it free — the estimate on the
  // line still stands until they do.
  return proposalAmount(p) || baseAmount(task);
}

/** What a proposal comes to. Zero when whoever wrote it named no rate: a quantity is
 *  not a sum of money, and reading "2 months" as "$2" is worse than saying nothing. */
export function proposalAmount(p) {
  // A fixed proposal carries its sum in rate; older ones kept it in qty.
  if (p.unit === "fixed") return Number(p.rate || p.qty) || 0;
  if (!p.rate) return 0;
  return (Number(p.qty) || 0) * (Number(p.rate) || 0);
}

export function totals(useEffective = true) {
  const { rates, tasks } = state;
  const amount = useEffective ? effectiveAmount : baseAmount;
  const byPhase = Object.fromEntries(phaseList().map((p) => [p.id, 0]));
  // A line whose phase was removed still costs money; count it rather than lose it.
  for (const t of tasks) byPhase[t.phase] = (byPhase[t.phase] || 0) + amount(t);
  const net = Object.values(byPhase).reduce((a, b) => a + b, 0);
  const contingency = net * ((Number(rates.contingency) || 0) / 100);
  return { byPhase, net, contingency, total: net + contingency };
}

/** A proposal as the public board is allowed to see it.
 *
 * With the budget hidden, every field that could carry a figure is dropped here
 * rather than concealed in the page — the payload itself must not contain what a
 * viewer is not meant to read. A fixed proposal keeps its sum in `rate`, and older
 * ones kept it in `qty`, so for those neither number travels.
 */
function publicProposal(p, money) {
  if (money) return { ...p, amount: proposalAmount(p) };
  const { rate, qty, ...rest } = p;
  return p.unit === "fixed" ? rest : { ...rest, qty };
}

/** What the public dashboard is allowed to see. */
/** The team's view: everything the board holds, whatever the public switches say. The
 *  page is unlisted rather than public, and it exists to read proposals and comments
 *  side by side — gating it by the same switches would leave it showing nothing. */
export const teamView = () => buildView({ money: true, proposals: true, comments: true });

export const publicView = () => buildView();

function buildView(force) {
  const money = force ? force.money : state.settings.publicMoney === true;
  // Proposals are the team's working material — who might take a line on, for how long
  // and at what rate — and are not what the public page is for. Hidden unless asked for.
  const showProposals = force ? force.proposals : state.settings.publicProposals === true;
  // Two kinds. A comment left on the deck is public and shows there; one left on the
  // team page never does. The switch governs the public ones only — the team's are not
  // its business, and are never on the deck whatever it says.
  const showComments = force ? force.comments : state.settings.publicComments !== false;

  const withOwners = phaseList().map((p) => ({ ...p, owner: (state.owners || {})[p.id] || "" }));

  return {
    phases: withOwners,
    units: UNITS,
    // Whether the board shows cost at all, or scope alone. Off unless the admin
    // has turned it on, so a link shared in a hurry cannot leak the budget.
    money,
    showProposals,
    showComments,
    // The rate card never crosses this line as a whole. A base rate travels only
    // for the individual lines marked prefill, and only as that line's suggestion.
    // The contingency percentage is a project markup, not anyone's day rate, but it
    // is still a figure, so it travels only when money does.
    contingency: money ? Number(state.rates.contingency) || 0 : null,
    rates: null,
    tasks: state.tasks.map((t) => {
      // A fixed line's quantity *is* its price, so it is not scope and cannot
      // travel as scope.
      const priced = t.unit === "fixed";
      return {
        id: t.id,
        phase: t.phase,
        name: t.name,
        note: t.note,
        unit: t.unit,
        kind: t.kind,
        added: t.added,
        // What the line costs. Once the board is showing cost, every line shows its
        // own — anything else leaves the public totals disagreeing with the admin's
        // over exactly the lines nobody thought to mark.
        qty: money ? t.qty : null,
        rate: money && !priced ? t.rate || null : null,
        // What the propose form fills in for you. That is what `prefill` is for, and
        // it stays a per-line choice.
        suggestedQty: t.prefill && (money || !priced) ? t.qty : null,
        suggestedRate: money && t.prefill && !priced ? t.rate || null : null,
        prefilled: !!t.prefill,
        // A divider's span is time, not money, so it travels whatever the board is
        // showing — hiding it would leave a marker with nothing to mark.
        span: t.kind === "divider" ? { qty: t.qty, unit: t.unit } : null,
        // the deck's process slide shows exactly these lines
        fromProcess: !!t.fromProcess,
        proposals: showProposals ? t.proposals.map((p) => publicProposal(p, money)) : [],
        // Whether anyone is on the line is part of who proposed, so it goes too.
        assigned: showProposals ? t.assigned : null,
        // Said plainly, so a page can explain an empty line rather than imply nobody came.
        proposalCount: t.proposals.length,
        comments: force
          ? t.comments || []
          : showComments
            ? (t.comments || []).filter((c) => c.visibility === "public")
            : [],
        commentCount: (t.comments || []).filter((c) => c.visibility === "public").length,
      };
    }),
    updatedAt: state.updatedAt,
  };
}

export function adminView() {
  return {
    phases: phaseList().map((p) => ({ ...p, owner: (state.owners || {})[p.id] || "" })),
    units: UNITS,
    rates: state.rates,
    settings: state.settings,
    tasks: state.tasks.map((t) => ({
      ...t,
      base: baseAmount(t),
      effective: effectiveAmount(t),
      proposals: t.proposals.map((p) => ({ ...p, amount: proposalAmount(p) })),
    })),
    totals: { effective: totals(true), base: totals(false) },
    people: people(),
    updatedAt: state.updatedAt,
  };
}

/** Everyone who has proposed, with what they're on and what it comes to. */
export function people() {
  const map = new Map();
  for (const t of state.tasks) {
    for (const p of t.proposals) {
      const key = p.name.toLowerCase();
      if (!map.has(key)) map.set(key, { name: p.name, proposed: 0, assigned: 0, lines: [] });
      const rec = map.get(key);
      const amt = proposalAmount(p);
      const isAssigned = t.assigned === p.id;
      rec.proposed += amt;
      if (isAssigned) rec.assigned += amt;
      rec.lines.push({ taskId: t.id, task: t.name, phase: t.phase, amount: amt, assigned: isAssigned });
    }
  }
  return [...map.values()].sort((a, b) => b.assigned - a.assigned || b.proposed - a.proposed);
}

// ---------------------------------------------------------------- writes

export function setRate(key, value) {
  if (!(key in state.rates)) return false;
  state.rates[key] = Number(value) || 0;
  save();
  return true;
}

/** Whether this line's base rate is offered as a suggestion on the public board. */
/** Anyone may leave a comment: a name and something to say, no numbers. It is the only
 *  thing the public page takes, and the only thing it shows back. */
export function addComment(id, { name, text }, visibility = "team") {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return false;
  const who = String(name || "").trim().slice(0, 60);
  const said = String(text || "").trim().slice(0, 1000);
  if (!who || !said) return false;
  task.comments = task.comments || [];
  task.comments.push({
    id: "c" + crypto.randomBytes(4).toString("hex"),
    name: who,
    text: said,
    // Where it was left decides who sees it, which is not something a caller gets to
    // choose: the deck's route says public, the team's says team.
    visibility: visibility === "public" ? "public" : "team",
    at: Date.now(),
  });
  save();
  return true;
}

/** Moderation. A page anyone can write to needs a way to take something off it. */
export function removeComment(id, commentId) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task || !Array.isArray(task.comments)) return false;
  const before = task.comments.length;
  task.comments = task.comments.filter((c) => c.id !== commentId);
  if (task.comments.length === before) return false;
  save();
  return true;
}

/** Whether the public board shows the comments people have left. */
export function setPublicComments(value) {
  state.settings = state.settings || {};
  state.settings.publicComments = Boolean(value);
  save();
  return true;
}

/** Whether the public board shows who has proposed themselves. On unless turned off;
 *  the lines keep taking proposals either way. */
export function setPublicProposals(value) {
  state.settings = state.settings || {};
  state.settings.publicProposals = Boolean(value);
  save();
  return true;
}

/** Name whoever is carrying a phase. Clearing it is just an empty name. */
export function setPhaseOwner(phase, name) {
  if (!hasPhase(phase)) return false;
  state.owners = state.owners || {};
  const clean = String(name || "").trim().slice(0, 60);
  if (clean) state.owners[phase] = clean;
  else delete state.owners[phase];
  save();
  return true;
}

/** Fee or expense. Expenses are money going out rather than work someone can take on,
 *  so they stay on the budget sheet and off the process page. */
export function setExpense(id, value) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return false;
  // A divider is neither, and switching it to either would put it back in the counts.
  if (task.kind === "divider") return false;
  task.kind = value ? "expense" : "fee";
  save();
  return true;
}

export function setPrefill(id, value) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return false;
  task.prefill = Boolean(value);
  save();
  return true;
}

/** Same decision across every line at once — 31 checkboxes is not a workflow. */
export function setPrefillAll(value) {
  for (const t of state.tasks) t.prefill = Boolean(value);
  save();
  return true;
}

/** Whether the public board shows cost at all. Off means scope only. */
export function setPublicMoney(value) {
  state.settings.publicMoney = Boolean(value);
  save();
  return true;
}

/** Add or replace this person's proposal on a line. One proposal per name per line. */
export function propose(id, { name, qty, unit, rate, notes }) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return false;

  const clean = String(name || "").trim().slice(0, 60);
  if (!clean) return false;

  const existing = task.proposals.findIndex((p) => p.name.toLowerCase() === clean.toLowerCase());
  const prior = existing >= 0 ? task.proposals[existing] : null;

  // While the budget is hidden the board never sent this person their own figures,
  // so their form posts them back empty. That means "unchanged", not "clear it" —
  // without this, editing your days on a scope-only board silently wipes the rate
  // you had already entered. When the budget is public the field was populated, so
  // an empty one is a deliberate erasure and is honored.
  const concealed = state.settings.publicMoney !== true && prior;
  const blank = (v) => v === undefined || v === null || v === "";
  const priced = (UNITS.includes(unit) ? unit : task.unit) === "fixed";

  const proposal = {
    id: "p" + crypto.randomBytes(4).toString("hex"),
    name: clean,
    qty: concealed && priced && blank(qty) ? prior.qty : Number(qty) || 0,
    unit: UNITS.includes(unit) ? unit : task.unit || "days",
    rate: concealed && blank(rate) ? prior.rate : Number(rate) || null,
    notes: String(notes || "").trim().slice(0, 600),
    at: Date.now(),
  };

  if (existing >= 0) {
    proposal.id = prior.id; // keep the id so an assignment survives an edit
    task.proposals[existing] = proposal;
  } else {
    task.proposals.push(proposal);
  }

  save();
  return true;
}

/** Admin edits someone's proposal in place — the id survives, so an assignment holds. */
export function updateProposal(id, proposalId, { name, qty, unit, rate, notes }) {
  const task = state.tasks.find((t) => t.id === id);
  const p = task?.proposals.find((x) => x.id === proposalId);
  if (!p) return false;

  if (name !== undefined) {
    const clean = String(name).trim().slice(0, 60);
    if (!clean) return false;
    p.name = clean;
  }
  if (unit !== undefined && UNITS.includes(unit)) p.unit = unit;
  if (qty !== undefined && qty !== "") p.qty = Number(qty) || 0;
  if (rate !== undefined) p.rate = Number(rate) || null;
  if (notes !== undefined) p.notes = String(notes).trim().slice(0, 600);
  if (p.unit === "fixed") p.rate = null;

  save();
  return true;
}

export function withdraw(id, proposalId) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return false;
  const before = task.proposals.length;
  task.proposals = task.proposals.filter((p) => p.id !== proposalId);
  if (task.assigned === proposalId) task.assigned = null;
  if (task.proposals.length === before) return false;
  save();
  return true;
}

/** Admin: put someone on the line, or take them off. */
export function assign(id, proposalId) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return false;
  if (proposalId && !task.proposals.some((p) => p.id === proposalId)) return false;
  task.assigned = proposalId || null;
  save();
  return true;
}

/** Admin edits the line itself: what it is, how much of it, and at what rate. */
/**
 * Put a phase's lines in the given order. Only that phase moves: its lines are lifted
 * out, reordered, and dropped back into the slots they occupied, so every other phase
 * keeps its own arrangement whatever the client happened to know about.
 *
 * Ids the client did not send — a line added by someone else a moment ago — keep their
 * relative order at the end of the phase rather than vanishing from it.
 */
export function reorderTasks(phase, ids) {
  if (!hasPhase(phase)) return false;
  if (!Array.isArray(ids)) return false;

  const slots = [];
  const mine = [];
  state.tasks.forEach((t, i) => {
    if (t.phase === phase) {
      slots.push(i);
      mine.push(t);
    }
  });
  if (!slots.length) return false;

  const byId = new Map(mine.map((t) => [t.id, t]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
  const seen = new Set(ordered.map((t) => t.id));
  for (const t of mine) if (!seen.has(t.id)) ordered.push(t);

  slots.forEach((slot, i) => {
    state.tasks[slot] = ordered[i];
  });
  save();
  return true;
}

export function updateTask(id, { name, note, qty, unit, rate, memo }) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return false;

  if (name !== undefined) {
    const clean = String(name).trim().slice(0, 90);
    if (!clean) return false;
    task.name = clean;
  }
  if (note !== undefined) task.note = String(note).trim().slice(0, 300);
  // Never reaches publicView, which names the fields it exposes rather than
  // excluding the ones it does not — a note added here cannot leak by omission.
  if (memo !== undefined) task.memo = String(memo).trim().slice(0, 500);
  if (unit !== undefined && UNITS.includes(unit)) task.unit = unit;
  if (qty !== undefined && qty !== "") task.qty = Number(qty) || 0;
  if (rate !== undefined) task.rate = Number(rate) || 0;

  // A fixed line's amount lives in qty; leaving a rate behind would quietly
  // reappear if the unit were ever switched back.
  if (task.unit === "fixed") task.rate = null;
  // Fee or expense is a decision, not a consequence of the unit — a flat sum can be
  // either, and only whoever is keeping the budget knows which. The switcher on the
  // line owns it; editing the line must not quietly overrule what they chose.

  save();
  return true;
}

export function addTask({ phase, name, note, qty, unit, rate, fromProcess, memo, kind }) {
  if (!hasPhase(phase)) return false;
  const clean = String(name || "").trim().slice(0, 90);
  if (!clean) return false;

  state.tasks.push({
    id: `${phase}-${Date.now().toString(36)}`,
    phase,
    name: clean,
    note: String(note || "").trim().slice(0, 300),
    memo: String(memo || "").trim().slice(0, 500),
    qty: Number(qty) || 0,
    unit: UNITS.includes(unit) ? unit : "days",
    rate: unit === "fixed" ? null : Number(rate) || 0,
    // A divider is a marker in the list, not work: it carries a span, never a price.
    kind: kind === "divider" ? "divider" : unit === "fixed" ? "expense" : "fee",
    proposals: [],
    comments: [],
    assigned: null,
    prefill: false,
    added: true,
    // Added from the deck's process slide, so it belongs in that list as well as
    // on the board — without this the line would vanish the moment it was created.
    fromProcess: !!fromProcess,
  });
  save();
  return true;
}

export function removeTask(id) {
  const before = state.tasks.length;
  const gone = state.tasks.find((t) => t.id === id);
  state.tasks = state.tasks.filter((t) => t.id !== id);
  if (state.tasks.length === before) return false;
  // Remember it. The seed backfill re-adds anything the seed has and the board does
  // not, so without this a deleted seed line comes back — at seed defaults, losing
  // whatever quantity, rate and prefill it had — the next time the server starts.
  state.removed = state.removed || [];
  const mark = `${gone.phase}|${gone.name}`;
  if (!state.removed.includes(id)) state.removed.push(id);
  if (!state.removed.includes(mark)) state.removed.push(mark);
  save();
  return true;
}

// ---------------------------------------------------------------- phases
//
// The deck's process slide is rendered from these, so adding one here adds a section
// to the proposal. Ids are generated rather than positional: "Phase 2" can be renamed,
// moved or removed without the lines underneath it pointing at the wrong section.

/** Add a phase. It arrives empty, at the end, and is named in the panel. */
export function addPhase({ title, note, duration } = {}) {
  const phase = normalisePhase(
    {
      id: `ph-${Date.now().toString(36)}`,
      title: title || `Phase ${phaseList().length + 1}`,
      note,
      duration,
    },
    phaseList().length
  );
  state.phases = [...phaseList(), phase];
  save();
  return true;
}

/** Rename a phase, or rewrite what it is for. Only the fields sent are touched, so the
 *  panel can save one field at a time without clearing the rest. */
export function updatePhase(id, { title, note, duration, fee, objectives, outcomes } = {}) {
  const phase = phaseList().find((p) => p.id === id);
  if (!phase) return false;

  const lines = (v) =>
    (Array.isArray(v) ? v : String(v ?? "").split("\n"))
      .map((s) => String(s).trim().slice(0, 300))
      .filter(Boolean);

  if (title !== undefined) phase.title = String(title).trim().slice(0, 90);
  if (note !== undefined) phase.note = String(note).trim().slice(0, 300);
  if (duration !== undefined) phase.duration = String(duration).trim().slice(0, 40);
  if (fee !== undefined) phase.fee = String(fee).trim().slice(0, 80);
  if (objectives !== undefined) phase.objectives = lines(objectives);
  if (outcomes !== undefined) phase.outcomes = lines(outcomes);

  save();
  return true;
}

/**
 * Remove a phase — but never the work on it.
 *
 * Deleting a phase that still carries lines would take proposals and comments with it,
 * and those are other people's contributions. So this refuses and says what is in the
 * way, leaving the decision about the lines where it belongs.
 *
 * Returns {ok} or {ok:false, error} rather than a bare boolean, because "no" here has
 * a reason worth putting in front of whoever clicked.
 */
export function removePhase(id) {
  if (!hasPhase(id)) return { ok: false, error: "That phase is not on the board." };
  if (phaseList().length <= 1) return { ok: false, error: "A proposal needs at least one phase." };

  const held = state.tasks.filter((t) => t.phase === id).length;
  if (held) {
    return {
      ok: false,
      error: `${held} line${held === 1 ? " is" : "s are"} still on this phase. Move or remove ${
        held === 1 ? "it" : "them"
      } first.`,
    };
  }

  state.phases = phaseList().filter((p) => p.id !== id);
  if (state.owners) delete state.owners[id];
  save();
  return { ok: true };
}

/** Put the phases in the given order. Anything the client did not know about keeps its
 *  place at the end rather than disappearing from the proposal. */
export function reorderPhases(ids) {
  if (!Array.isArray(ids)) return false;
  const byId = new Map(phaseList().map((p) => [p.id, p]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
  const seen = new Set(ordered.map((p) => p.id));
  for (const p of phaseList()) if (!seen.has(p.id)) ordered.push(p);
  if (!ordered.length) return false;
  state.phases = ordered;
  save();
  return true;
}

export function reset() {
  state = fresh();
  save();
}

export function replaceState(next) {
  if (!next || !Array.isArray(next.tasks) || !next.rates) return false;
  state = {
    rates: { ...DEFAULT_RATES, ...next.rates },
    settings: { ...(next.settings || {}) },
    phases:
      Array.isArray(next.phases) && next.phases.length ? next.phases.map(normalisePhase) : newPhases(),
    // Carried rather than dropped: importing a budget used to silently lose who was
    // carrying each phase, which seed lines had been deleted, and the whole Q&A capture.
    owners: { ...(next.owners || {}) },
    removed: Array.isArray(next.removed) ? [...next.removed] : [],
    workshop: next.workshop || { bottlenecks: [], nextId: 1, generation: null },
    tasks: next.tasks,
    updatedAt: Date.now(),
  };
  save();
  return true;
}
