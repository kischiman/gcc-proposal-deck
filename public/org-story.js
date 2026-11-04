// The Overview's story diagram: one organization, seven stages.
//
// Every stage is the same picture with different layers shown, so nodes never move and
// each stage reads as a still. Each drawn element names the stages it appears in
// (data-s) and, optionally, the stages where it steps back (data-dim). Copy lives in
// STAGES and in the label calls below, so all of it can be edited in one place.

(function () {
  const root = document.getElementById("org-story");
  if (!root) return;

  const STAGES = [
    { nav: "Status quo", title: "Status quo",
      note: "Work crosses departments without a clear route, so hand-offs are missed, work is redone and decisions stall. Each one adds cost." },
    { nav: "Workshop", title: "01 · Workshop",
      note: "One session with your leaders sets shared goals and picks the one department we start with." },
    { nav: "Observe & record", title: "02 · Observe & record",
      note: "We follow how work actually travels between people, and record where it waits, gets redone or meets disagreement." },
    { nav: "Design interventions", title: "03 · Design interventions",
      note: "A few influential connectors carry the redesign: a clear hand-off, an owner for each decision, and a working feedback loop." },
    { nav: "Measure change", title: "04 · Measure change",
      note: "Checkpoints on the redesigned routes track hand-off time, rework and decision clarity, and feed the next round of design." },
    { nav: "Automate with AI", title: "05 · Automate with AI",
      note: "Validated routine steps on the improved routes are automated." },
    { nav: "Accelerated growth", title: "06 · Accelerated growth",
      note: "The intended result: purposeful connections across teams, giving the cohesion and seamless collaboration that growth depends on." },
  ];
  const LAST = STAGES.length - 1;

  // ------------------------------------------------------------ geometry
  const NS = "http://www.w3.org/2000/svg";
  const W = 1000, H = 575;
  const DEPTS = [
    { key: "S", cx: 200 },
    { key: "O", cx: 500 },
    { key: "V", cx: 800 },
  ];
  const BOX = { y: 150, h: 290, half: 140 };
  const R = 8; // team member radius

  const P = { L: [500, 50] };
  DEPTS.forEach((d, i) => {
    P["M" + i] = [d.cx, 190];
    for (let k = 0; k < 6; k++) P[d.key + k] = [d.cx + ((k % 3) - 1) * 90, 290 + Math.floor(k / 3) * 70];
  });

  // A curved collaboration path between two people, trimmed to stop at their edges.
  function curve(a, b, bend, trimA = R + 3, trimB = R + 4) {
    const [ax, ay] = P[a] || a, [bx, by] = P[b] || b;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    const cx = mx + (-dy / len) * bend, cy = my + (dx / len) * bend;
    const t = (x, y, px, py, d) => { const l = Math.hypot(px - x, py - y) || 1; return [x + ((px - x) / l) * d, y + ((py - y) / l) * d]; };
    const [sx, sy] = t(ax, ay, cx, cy, trimA), [ex, ey] = t(bx, by, cx, cy, trimB);
    return `M${sx.toFixed(1)} ${sy.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
  }

  // ------------------------------------------------------------ building
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-labelledby", "os-title os-note");
  root.querySelector(".os-canvas").appendChild(svg);

  function el(tag, attrs, parent = svg) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
    parent.appendChild(n);
    return n;
  }
  // a layer element: s = stages shown, dim = stages where it steps back
  function layer(tag, attrs, s, dim) {
    const n = el(tag, attrs);
    n.classList.add("os-el");
    n.dataset.s = s;
    if (dim) n.dataset.dim = dim;
    return n;
  }
  function label(x, y, text, s, cls = "", anchor = "middle") {
    const n = layer("text", { x, y, class: "os-label " + cls, "text-anchor": anchor }, s);
    n.textContent = text;
    return n;
  }
  const ALL = "0,1,2,3,4,5,6";

  // markers
  const defs = el("defs", {});
  [["os-a-f", "fric"], ["os-a-i", "ind"], ["os-a-g", "gry"]].forEach(([id, c]) => {
    const m = el("marker", { id, viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse", markerUnits: "userSpaceOnUse" }, defs);
    el("path", { d: "M0 1 L9 5 L0 9 z", class: "os-mk " + c }, m);
  });

  // departments: the formal boundaries, left unnamed
  DEPTS.forEach((d) => {
    layer("rect", { x: d.cx - BOX.half, y: BOX.y, width: BOX.half * 2, height: BOX.h, class: "os-silo" }, ALL, "6");
  });

  // 01 shared goals: one band across every department, tied to each manager
  layer("rect", { x: 60, y: 118, width: 880, height: 18, class: "os-band" }, "1");
  label(500, 131, "Shared goals", "1", "os-band-label");
  DEPTS.forEach((d) => layer("path", { d: `M${d.cx} 136 V181`, class: "os-tie" }, "1"));

  // formal reporting structure: thin, orthogonal, grey
  let rep = `M500 61 V100 M200 100 H800 M200 100 V182 M500 100 V182 M800 100 V182`;
  DEPTS.forEach((d) => {
    const c = d.cx;
    rep += ` M${c} 198 V245 M${c - 90} 245 H${c + 90}`;
    for (const x of [c - 90, c, c + 90]) rep += ` M${x} 245 V${290 - R} M${x} ${290 + R} V${360 - R}`;
  });
  layer("path", { d: rep, class: "os-report" }, ALL, "2,3,4,5,6");

  // 02 the observed collaboration network: what actually happens between people
  [["S1", "O1", 30], ["S5", "O3", 16], ["O2", "V0", -18], ["S4", "V4", 70], ["S0", "S4", 14],
   ["O1", "V1", -40], ["V2", "V5", -14], ["O4", "O0", 18], ["S2", "O0", -14], ["O5", "V3", -18]]
    .forEach(([a, b, k]) => layer("path", { d: curve(a, b, k), class: "os-net" }, "2,3,4,5", "3,4,5"));

  // status quo friction (vermilion). Missed hand-off: work stops at the boundary
  layer("path", { d: curve("S2", [341, 286], -8), class: "os-fric", "marker-end": "url(#os-a-f)" }, "0,1,2", "1");
  layer("path", { d: "M346 276 V296 M354 276 V296", class: "os-wait" }, "0,1,2", "1");
  layer("path", { d: curve([359, 286], "O0", -8, 0), class: "os-fric ghost" }, "0,1,2", "1");
  // rework: the same piece of work goes back and forth
  layer("path", { d: curve("O5", "V3", -24), class: "os-fric", "marker-end": "url(#os-a-f)" }, "0,1,2", "1");
  layer("path", { d: curve("V3", "O5", -24), class: "os-fric", "marker-end": "url(#os-a-f)" }, "0,1,2", "1");
  // disagreement: two managers pulling a decision opposite ways, blocked in the middle
  layer("path", { d: curve([508, 196], [641, 208], 10, 0, 0), class: "os-fric", "marker-end": "url(#os-a-f)" }, "0,1,2", "1");
  layer("path", { d: curve([792, 196], [659, 208], -10, 0, 0), class: "os-fric", "marker-end": "url(#os-a-f)" }, "0,1,2", "1");
  layer("path", { d: "M650 196 V220", class: "os-block" }, "0,1,2", "1");

  label(333, 270, "Missed hand-offs", "0", "os-fric-label", "end");
  label(662, 234, "Disagreements", "0", "os-fric-label", "start");
  label(662, 407, "Inefficiencies", "0", "os-fric-label", "start");
  // ...converging on cost, down the gaps between departments
  layer("path", { d: "M350 300 V462 Q350 512 412 528", class: "os-converge", "marker-end": "url(#os-a-f)" }, "0");
  layer("path", { d: "M650 224 V462 Q650 512 588 528", class: "os-converge", "marker-end": "url(#os-a-f)" }, "0");
  layer("rect", { x: 415, y: 516, width: 170, height: 34, class: "os-cost" }, "0");
  label(500, 538, "Increased costs", "0", "os-cost-label");

  // 02 recorded: where the friction was seen
  [[350, 286], [650, 208], [650, 361]].forEach(([x, y]) => layer("circle", { cx: x, cy: y, r: 17, class: "os-record" }, "2"));
  label(333, 270, "Waiting", "2", "os-rec-label", "end");
  label(662, 234, "Disagreement", "2", "os-rec-label", "start");
  label(662, 407, "Rework", "2", "os-rec-label", "start");

  // 03 the redesigned routes: intentional bridges (indigo, heavier, drawn on)
  const bridge = (d, s, extra = {}) => layer("path", { d, class: "os-bridge", pathLength: 1, ...extra }, s);
  const B1 = bridge(curve("S2", "O0", -16), "3,4,5,6", { "marker-end": "url(#os-a-i)" });
  bridge(curve("M1", "M2", 30, 12, 12), "3,4,5,6", { "marker-end": "url(#os-a-i)" });
  const B3 = bridge(curve("O5", "V3", -22), "3,4,5,6", { "marker-end": "url(#os-a-i)" });
  bridge(curve("V3", "O5", -22), "3,4,5,6", { class: "os-bridge back", "marker-end": "url(#os-a-i)" });
  const B4 = bridge(curve("O2", "V0", -18), "3,4,5,6", { "marker-end": "url(#os-a-i)" });
  layer("circle", { cx: 500, cy: 190, r: 15, class: "os-owner" }, "3,4,5,6", "4,5,6");
  label(333, 270, "Clear hand-off", "3", "os-ind-label", "end");
  label(488, 228, "Decision owner", "3", "os-ind-label", "end");
  label(662, 407, "Feedback loop", "3", "os-ind-label", "start");

  // 04 checkpoints on the redesigned routes, feeding back into design
  [[350, 279], [650, 205], [650, 347]].forEach(([x, y]) =>
    layer("rect", { x: x - 6, y: y - 6, width: 12, height: 12, transform: `rotate(45 ${x} ${y})`, class: "os-check" }, "4,5", "5"));
  label(333, 270, "Handoff time", "4", "os-ind-label", "end");
  label(662, 234, "Decision clarity", "4", "os-ind-label", "start");
  label(662, 407, "Rework", "4", "os-ind-label", "start");
  layer("path", { d: "M486 512 A16 16 0 1 1 488 530", class: "os-loop", "marker-end": "url(#os-a-i)" }, "4");
  label(524, 527, "Measurement feeds the next round of design", "4", "os-ind-label", "start");

  // 05 automation on improved routes, with people reviewing
  [[398, 276, 398, 304], [698, 346, 698, 374], [698, 276, 698, 304]].forEach(([x1, y1, x2, y2]) =>
    layer("path", { d: `M${x1} ${y1} V${y2}`, class: "os-gate" }, "5"));
  label(333, 270, "Automated, then reviewed", "5", "os-ind-label", "end");
  label(662, 234, "Owner still decides", "5", "os-ind-label", "start");
  label(662, 407, "Human review gate", "5", "os-ind-label", "start");
  const tokens = [B1, B3, B4].map((path) => ({ path, n: layer("rect", { width: 8, height: 8, x: -4, y: -4, class: "os-token" }, "5") }));

  // 06 the network resolved into purposeful cross-team connections
  [["S1", "O1", -40], ["S4", "O4", 40], ["O1", "V1", -40], ["O4", "V4", 40], ["S5", "O3", 18]]
    .forEach(([a, b, k]) => layer("path", { d: curve(a, b, k), class: "os-link", pathLength: 1 }, "6"));
  label(350, 474, "Company cohesion", "6", "os-out-label");
  label(650, 474, "Seamless collaboration", "6", "os-out-label");
  layer("path", { d: "M350 484 Q350 514 400 528", class: "os-lead", "marker-end": "url(#os-a-i)" }, "6");
  layer("path", { d: "M650 484 Q650 514 600 528", class: "os-lead", "marker-end": "url(#os-a-i)" }, "6");
  layer("rect", { x: 405, y: 516, width: 190, height: 34, class: "os-growth" }, "6");
  label(500, 538, "Accelerated growth", "6", "os-growth-label");

  // people last, so every line passes under them
  el("rect", { x: 489, y: 39, width: 22, height: 22, class: "os-lead-node" });
  const lt = el("text", { x: 522, y: 56, class: "os-label os-leader" }); lt.textContent = "Leadership";
  DEPTS.forEach((d, i) => el("rect", { x: d.cx - 8, y: 182, width: 16, height: 16, class: "os-mgr" }));
  const people = {};
  DEPTS.forEach((d) => {
    for (let k = 0; k < 6; k++) {
      const id = d.key + k, [x, y] = P[id];
      people[id] = el("circle", { cx: x, cy: y, r: R, class: "os-person" });
    }
  });
  // influential connectors, emphasized from 03 on
  ["S2", "O5", "V0"].forEach((id) => { people[id].classList.add("os-el-hi"); people[id].dataset.hi = "3,4,5,6"; });

  // ------------------------------------------------------------ stages
  const layers = [...svg.querySelectorAll(".os-el")];
  const his = [...svg.querySelectorAll(".os-el-hi")];
  const nav = root.querySelector(".os-nav");
  const titleEl = root.querySelector("#os-title");
  const noteEl = root.querySelector("#os-note");
  const playBtn = root.querySelector(".os-play");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");

  const btns = STAGES.map((st, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "os-step";
    b.innerHTML = i ? `<span>0${i}</span>${st.nav}` : st.nav;
    b.addEventListener("click", () => { stop(); show(i); });
    nav.appendChild(b);
    return b;
  });

  let stage = -1;
  function show(i) {
    stage = i;
    for (const n of layers) {
      const on = n.dataset.s.split(",").includes(String(i));
      const dim = on && n.dataset.dim && n.dataset.dim.split(",").includes(String(i));
      n.classList.toggle("on", on);
      n.classList.toggle("dim", Boolean(dim));
    }
    for (const n of his) n.classList.toggle("hi", n.dataset.hi.split(",").includes(String(i)));
    btns.forEach((b, j) => b.setAttribute("aria-pressed", String(j === i)));
    titleEl.textContent = STAGES[i].title;
    noteEl.textContent = STAGES[i].note;
    root.dataset.stage = i;
    if (i === 5) runTokens(); else cancelAnimationFrame(raf);
  }

  // automated work travels the redesigned routes twice, then rests at the review gate
  let raf = 0;
  function place(t) {
    for (const { path, n } of tokens) {
      const L = path.getTotalLength();
      const p = path.getPointAtLength(L * Math.min(t, 0.9));
      n.setAttribute("transform", `translate(${p.x} ${p.y})`);
    }
  }
  function runTokens() {
    cancelAnimationFrame(raf);
    if (reduce.matches) return place(0.9);
    const start = performance.now(), lap = 1600, laps = 2;
    const tick = (now) => {
      const e = (now - start) / lap;
      if (e >= laps) return place(0.9);
      place(e % 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  // Play runs once through the story and stops on the outcome
  let timer = 0;
  function stop() {
    clearTimeout(timer);
    timer = 0;
    playBtn.setAttribute("aria-pressed", "false");
    playBtn.textContent = "Play";
  }
  function play() {
    if (stage >= LAST) show(0);
    playBtn.setAttribute("aria-pressed", "true");
    playBtn.textContent = "Pause";
    const next = () => {
      if (stage >= LAST) return stop();
      show(stage + 1);
      timer = setTimeout(next, stage === 5 ? 3800 : 3200);
    };
    timer = setTimeout(next, 2600);
  }
  playBtn.addEventListener("click", () => (timer ? stop() : play()));

  // arrow keys move between stages here, rather than between slides
  nav.addEventListener("keydown", (e) => {
    const k = e.key;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(k)) return;
    e.preventDefault();
    e.stopPropagation();
    stop();
    const i = k === "Home" ? 0 : k === "End" ? LAST : Math.max(0, Math.min(LAST, stage + (k === "ArrowRight" ? 1 : -1)));
    show(i);
    btns[i].focus();
  });

  show(0);

  // on a narrow screen the figure pans; open it centred on the middle department
  const canvas = root.querySelector(".os-canvas");
  const centre = () => { if (canvas.scrollWidth > canvas.clientWidth) canvas.scrollLeft = (canvas.scrollWidth - canvas.clientWidth) / 2; };
  requestAnimationFrame(centre);
})();
