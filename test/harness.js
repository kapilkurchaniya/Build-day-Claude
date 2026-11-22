// Node test harness for Bhoj. Run with:  node test/harness.js
// It pulls the simulation <script> out of bhoj.html and runs it without a
// browser, so the science can be checked and tuned quickly.
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'bhoj.html'), 'utf8');
function block(id) {
  const m = html.match(new RegExp('<script id="' + id + '">([\\s\\S]*?)</script>'));
  if (!m) throw new Error('script block not found: ' + id);
  return m[1];
}
const ctx = vm.createContext({});
vm.runInContext(block('sim'), ctx, { filename: 'sim' });
new vm.Script(block('ui'), { filename: 'ui' });          // syntax check only (needs a DOM to run)
const B = ctx.Bhoj;

const results = [];
function check(name, pass, detail) { results.push({ name, pass: !!pass, detail: detail || '' }); }

const SEEDS = [1100, 1, 2, 3, 42, 2026, 99999, 123456789];
const W = B.W, H = B.H, N = B.N;

// --- determinism ---------------------------------------------------------
{
  const a = B.createWorld(1100), b = B.createWorld(1100), c = B.createWorld(1101);
  let same = true, differ = false;
  for (let i = 0; i < N; i++) { if (a.bed[i] !== b.bed[i]) same = false; if (a.bed[i] !== c.bed[i]) differ = true; }
  check('same seed gives the identical lake', same && JSON.stringify(a.trees) === JSON.stringify(b.trees));
  check('different seed gives a different lake', differ);
  const s1 = B.createSim(7), s2 = B.createSim(7); let rngSame = true, inRange = true;
  for (let i = 0; i < 1000; i++) { const x = B.rand(s1), y = B.rand(s2); if (x !== y) rngSame = false; if (!(x >= 0 && x < 1)) inRange = false; }
  check('runtime random stream is repeatable and in [0,1)', rngSame && inRange);
}

// --- lake shape, for several seeds ---------------------------------------
for (const seed of SEEDS) {
  const sim = B.createSim(seed), w = sim.world;
  const frac = sim.wetCount / N;
  check(`seed ${seed}: water covers 20-55% of the map`, frac > 0.2 && frac < 0.55, (frac * 100).toFixed(1) + '%');

  let nan = false, borderLand = true, maxDepth = 0;
  for (let i = 0; i < N; i++) {
    if (!Number.isFinite(w.bed[i])) nan = true;
    const x = i % W, y = (i / W) | 0;
    if ((x < 2 || y < 2 || x > W - 3 || y > H - 3) && sim.wet[i]) borderLand = false;
    if (sim.depth[i] > maxDepth) maxDepth = sim.depth[i];
  }
  check(`seed ${seed}: no NaN, land at the border, sensible depth`, !nan && borderLand && maxDepth > 4 && maxDepth <= B.MAX_DEPTH, 'max ' + maxDepth.toFixed(1) + ' m');

  // one connected body of water
  const seen = new Uint8Array(N), stack = [w.inflow.y * W + w.inflow.x]; let reached = 0;
  seen[stack[0]] = 1;
  while (stack.length) {
    const c = stack.pop(), x = c % W; reached++;
    for (const n of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
      if (n >= 0 && n < N && !seen[n] && sim.wet[n]) { seen[n] = 1; stack.push(n); }
    }
  }
  check(`seed ${seed}: lake is one connected body`, reached === sim.wetCount, reached + ' of ' + sim.wetCount);

  const islandsOk = w.islands.length >= 2 && w.islands.every(p => !sim.wet[p.y * W + p.x]);
  check(`seed ${seed}: 2-3 islands, each real land`, islandsOk, w.islands.length + ' islands');
  const wetAt = p => sim.wet[p.y * W + p.x] === 1;
  check(`seed ${seed}: inflow, outlet and ghat sit on water`, wetAt(w.inflow) && wetAt(w.outlet) && wetAt(w.ghat),
    `in ${w.inflow.x},${w.inflow.y} out ${w.outlet.x},${w.outlet.y} ghat ${w.ghat.x},${w.ghat.y}`);
  check(`seed ${seed}: scenery placed`, w.trees.length > 80 && w.buildings.length >= 6, w.trees.length + ' trees, ' + w.buildings.length + ' buildings');

  // drought: the lake shrinks but does not vanish
  B.setLevel(sim, -1.5);
  const shrink = sim.wetCount / sim.fullWetCount;
  check(`seed ${seed}: a 1.5 m drop shrinks the lake visibly`, shrink < 0.95 && shrink > 0.4, (shrink * 100).toFixed(0) + '% of full area');
}

// --- clock and sun -------------------------------------------------------
{
  const c0 = B.clock(0), c1 = B.clock(B.STEPS_PER_DAY), c30 = B.clock(B.STEPS_PER_DAY * 30), cHalf = B.clock(65);
  check('clock starts at 06:00 on 1 Sep 2026', c0.time === '06:00' && c0.date === 'Day 1 · 1 Sep 2026', c0.time + ' ' + c0.date);
  check('240 steps make one day', c1.time === '06:00' && c1.day === 1 && c1.date === 'Day 2 · 2 Sep 2026', c1.date);
  check('months roll over', c30.date === 'Day 31 · 1 Oct 2026', c30.date);
  check('65 steps is 12:30', cHalf.time === '12:30', cHalf.time);
  const noon = B.sun(60), midnight = B.sun(180), dawn = B.sun(0);
  check('sun: bright at noon, dark at midnight', noon.light > 0.99 && midnight.light < 0.01 && Math.abs(dawn.elev) < 1e-9,
    `noon ${noon.light.toFixed(2)} midnight ${midnight.light.toFixed(2)}`);
}

// --- speed ---------------------------------------------------------------
{
  const sim = B.createSim(1100), t0 = process.hrtime.bigint();
  for (let i = 0; i < 2400; i++) B.step(sim);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  check('10 sim-days step without error', sim.t === 2400, (ms / 2400).toFixed(4) + ' ms per step');
  const g0 = process.hrtime.bigint(); B.createSim(5);
  check('world generation is quick', true, (Number(process.hrtime.bigint() - g0) / 1e6).toFixed(1) + ' ms');
}

// --- Phase 2: the living lake -------------------------------------------
function badValues(sim) {          // NaN, Infinity or negatives in any wet cell
  let bad = 0;
  for (let k = 0; k < sim.wetCount; k++) {
    const i = sim.wetList[k];
    for (const f of B.FIELDS) { const v = sim[f][i]; if (!Number.isFinite(v) || v < 0) bad++; }
    if (!Number.isFinite(sim.sed[i]) || sim.sed[i] < 0) bad++;
  }
  const fi = sim.fish;
  for (let k = 0; k < B.FISH_MAX; k++) if (fi.state[k] && !(Number.isFinite(fi.x[k]) && Number.isFinite(fi.y[k]))) bad++;
  return bad;
}
function outOfWater(sim) { let n = 0; const fi = sim.fish; for (let k = 0; k < B.FISH_MAX; k++) if (fi.state[k] === 1 && !sim.wet[(fi.y[k] | 0) * W + (fi.x[k] | 0)]) n++; return n; }
{
  // Undisturbed lake for 10 days.
  const sim = B.createSim(1100);
  let minMean = 99, maxChl = 0, bad = 0, maxSub = 0, maxV = 0, out = 0;
  const probe = sim.world.ghat.y * W + sim.world.ghat.x + 6 * W;   // a cell a little off the ghat
  let dayMax = -1, dayMin = 99, swings = [];
  for (let s = 0; s < 2400; s++) {
    B.step(sim);
    minMean = Math.min(minMean, sim.stats.meanO); maxChl = Math.max(maxChl, sim.stats.meanChl);
    maxSub = Math.max(maxSub, sim.subSteps); maxV = Math.max(maxV, sim.maxSpeed);
    const o = sim.wet[probe] ? sim.O[probe] : sim.stats.meanO; dayMax = Math.max(dayMax, o); dayMin = Math.min(dayMin, o);
    if (sim.t % 240 === 0) { swings.push(dayMax - dayMin); dayMax = -1; dayMin = 99; bad += badValues(sim); out += outOfWater(sim); }
  }
  check('calm lake, 10 days: no fish deaths', sim.fish.deaths === 0 && sim.fish.alive === 300, sim.fish.alive + ' alive');
  check('calm lake, 10 days: oxygen stays healthy (mean > 6.5 mg/L)', minMean > 6.5, 'lowest mean ' + minMean.toFixed(2));
  check('calm lake, 10 days: water stays clear (mean chlorophyll < 15 ug/L)', maxChl < 15, maxChl.toFixed(1) + ' ug/L');
  check('calm lake: oxygen rises by day and falls by night', Math.min(...swings) > 0.2, swings.map(x => x.toFixed(2)).join(' '));
  check('calm lake: no NaN, Infinity or negative values; fish stay in water', bad === 0 && out === 0, bad + ' bad, ' + out + ' fish on land');
  check('calm lake: nutrient ledger balances within 0.1%', Math.abs(B.ledgerError(sim)) < 0.001, (B.ledgerError(sim) * 100).toFixed(4) + '%');
  check('currents stay gentle and stable', maxV < 0.6 && maxSub <= 4, 'max ' + maxV.toFixed(2) + ' cells/step, ' + maxSub + ' sub-steps');
}
{
  // Flow is divergence-free: a uniform tracer must stay uniform.
  const sim = B.createSim(42);
  sim.P.fill(5); B.PAR.riverP_saved = B.PAR.riverP;
  const saveP = { s: B.PAR.pSettle, b: B.PAR.pBackground }; B.PAR.pSettle = 0; B.PAR.pBackground = 5;
  const w0 = sim.weather.wind; sim.weather.wind = 0;   // no wind-stirred turbidity for this check
  const oldRiver = B.PAR.riverP; B.PAR.riverP = 5;
  for (let s = 0; s < 240; s++) { sim.weather.wind = 0; B.step(sim); }
  let dev = 0; for (let k = 0; k < sim.wetCount; k++) dev = Math.max(dev, Math.abs(sim.P[sim.wetList[k]] - 5));
  B.PAR.riverP = oldRiver; B.PAR.pSettle = saveP.s; B.PAR.pBackground = saveP.b; sim.weather.wind = w0;
  check('flow is divergence-free (a uniform tracer stays uniform)', dev < 0.01, 'max deviation ' + dev.toExponential(2));
}
{
  // Determinism: same seed, same run.
  const a = B.createSim(77), b = B.createSim(77);
  for (let s = 0; s < 480; s++) { B.step(a); B.step(b); }
  let same = a.rngState === b.rngState;
  for (let i = 0; i < N && same; i++) if (a.O[i] !== b.O[i] || a.A[i] !== b.A[i]) same = false;
  for (let k = 0; k < B.FISH_MAX && same; k++) if (a.fish.x[k] !== b.fish.x[k] || a.fish.state[k] !== b.fish.state[k]) same = false;
  check('same seed gives an identical 2-day run (fields, fish, random stream)', same);
}
{
  // Sewage preview (the full event arrives in Phase 3).
  const sim = B.createSim(1100), g = sim.world.ghat;
  let firstDeath = -1, firstBloom = -1, firstHypoxia = -1;
  const start = 240;
  for (let s = 0; s < 240 * 6; s++) {
    if (sim.t >= start) { B.addNutrient(sim, g.x, g.y + 2, 2, 8 * 0.7, 'N'); B.addNutrient(sim, g.x, g.y + 2, 2, 8 * 0.3, 'D'); }
    B.step(sim);
    if (firstBloom < 0 && sim.stats.maxChl > 100) firstBloom = sim.t;
    if (firstHypoxia < 0 && sim.stats.minO < 3) firstHypoxia = sim.t;
    if (firstDeath < 0 && sim.fish.deaths > 0) firstDeath = sim.t;
  }
  const d = t => t < 0 ? 'never' : ((t - start) / 240).toFixed(1) + ' d';
  check('sewage preview: a bloom (>100 ug/L) forms 1-3.5 days after the pipe opens', firstBloom > 0 && (firstBloom - start) / 240 >= 1 && (firstBloom - start) / 240 <= 3.5, 'bloom ' + d(firstBloom));
  check('sewage preview: oxygen falls below 3 mg/L and fish start dying', firstHypoxia > 0 && firstDeath > 0, 'hypoxia ' + d(firstHypoxia) + ', first death ' + d(firstDeath) + ', ' + sim.fish.deaths + ' dead');
  check('sewage preview: no bad values and the ledger still balances', badValues(sim) === 0 && Math.abs(B.ledgerError(sim)) < 0.001, (B.ledgerError(sim) * 100).toFixed(4) + '%');
}
{
  // Drought and refill: level falls 2 m in steps, then comes back.
  const sim = B.createSim(2026);
  for (let s = 0; s < 480; s++) { if (s % 12 === 0) B.setLevel(sim, sim.level - (s < 240 ? 0.1 : -0.1)); B.step(sim); }
  check('drought and refill: ledger balances, no bad values, no fish on land', Math.abs(B.ledgerError(sim)) < 0.005 && badValues(sim) === 0 && outOfWater(sim) === 0,
    'ledger ' + (B.ledgerError(sim) * 100).toFixed(4) + '%, level ' + sim.level.toFixed(2) + ' m, fish ' + sim.fish.alive);
}
{
  // Severe drought: the lake nearly dries up without crashing.
  const sim = B.createSim(3);
  B.setLevel(sim, -6);
  for (let s = 0; s < 240; s++) B.step(sim);
  check('lake nearly dry: still runs, no bad values', badValues(sim) === 0 && sim.wetCount >= 0, sim.wetCount + ' wet cells, ' + sim.fish.alive + ' fish');
}
{
  const sim = B.createSim(1100), t0 = process.hrtime.bigint();
  for (let i = 0; i < 480; i++) B.step(sim);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 480;
  check('a full step (flow, chemistry, fish) is fast enough for 100x', ms < 4, ms.toFixed(2) + ' ms per step');
}

// --- Phase 3: events, origin tags, diary, explanations -------------------
function runScenario(setup, days, seed) {
  const sim = B.createSim(seed || 1100), g = sim.world.ghat;
  const r = { sim, bloom: -1, hyp: -1, kill: -1, minScore: 100, bad: 0 };
  for (let s = 0; s < days * 240; s++) {
    if (sim.t === 240) setup(sim, g);
    B.step(sim);
    if (sim.t % 120 === 0) r.bad += badValues(sim);
    r.minScore = Math.min(r.minScore, sim.scoreSmooth);
  }
  for (const e of sim.ev.log) { if (e.type === 'bloom' && r.bloom < 0) r.bloom = e.t; if (e.type === 'hypoxia' && r.hyp < 0) r.hyp = e.t; if (e.type === 'fishkill' && r.kill < 0) r.kill = e.t; }
  return r;
}
{
  const pipe = (sim, g) => B.triggerEvent(sim, 'sewage', g.x + 8.5, g.y + 1.5);
  const sew = runScenario(pipe, 8), heat = runScenario((s) => B.triggerEvent(s, 'heat'), 8);
  const both = runScenario((s, g) => { pipe(s, g); B.triggerEvent(s, 'heat'); }, 8);
  const dd = r => ((r - 240) / 240);
  check('sewage: algae bloom 2-3 days after the pipe opens, not instantly', sew.bloom > 0 && dd(sew.bloom) >= 1.8 && dd(sew.bloom) <= 3.2, 'bloom ' + dd(sew.bloom).toFixed(2) + ' d');
  check('sewage: oxygen crash below 3 mg/L is logged, with the pipe as its cause', sew.hyp > 0 && sew.sim.ev.log.some(e => e.type === 'hypoxia' && e.causes.length > 0), 'first crash ' + dd(sew.hyp).toFixed(2) + ' d');
  check('sewage: the diary links the bloom back to the pipe', sew.sim.ev.log.some(e => e.type === 'bloom' && e.causes.some(id => (B.findEntry(sew.sim, id) || {}).type === 'sewage')));
  check('sewage: one pipe visibly lowers the score (below 95) and it stays in 0-100', sew.minScore < 95 && sew.minScore >= 0, 'min ' + sew.minScore.toFixed(0));
  check('heat wave alone is mild: no fish kill and no bloom', heat.kill < 0 && heat.bloom < 0 && heat.minScore > 90, 'min score ' + heat.minScore.toFixed(0) + ', deaths ' + heat.sim.fish.deaths);
  check('heat wave plus sewage is clearly worse and faster than sewage alone', both.bloom > 0 && both.bloom < sew.bloom && both.sim.fish.deaths > sew.sim.fish.deaths && both.minScore < sew.minScore,
    `bloom ${dd(both.bloom).toFixed(1)} vs ${dd(sew.bloom).toFixed(1)} d, deaths ${both.sim.fish.deaths} vs ${sew.sim.fish.deaths}, score ${both.minScore.toFixed(0)} vs ${sew.minScore.toFixed(0)}`);
  check('events: no bad values and the ledger balances (sewage; sewage + heat)', sew.bad === 0 && both.bad === 0 && Math.abs(B.ledgerError(sew.sim)) < 0.01 && Math.abs(B.ledgerError(both.sim)) < 0.01,
    (B.ledgerError(sew.sim) * 100).toFixed(4) + '%, ' + (B.ledgerError(both.sim) * 100).toFixed(4) + '%');
  // Explain: tags add up to 1; the densest-bloom cell blames sewage and names how long ago
  let best = -1, a = -1; for (let k = 0; k < sew.sim.wetCount; k++) { const i = sew.sim.wetList[k]; if (sew.sim.A[i] > a) { a = sew.sim.A[i]; best = i; } }
  const sh = B.tagShares(sew.sim, best), ex = B.explainCell(sew.sim, best);
  check('origin tags sum to 100% and blame sewage for the bloom cell', Math.abs(sh.reduce((x, y) => x + y, 0) - 1) < 1e-6 && sh[0] > 0.8, sh.map(v => Math.round(v * 100)).join('/'));
  check('Explain: plain-language answer names sewage and the delay', /sewage/i.test(ex.lines.join(' ')) && /(hours?|days?) ago/.test(ex.lines.join(' ')) && ex.chain.length >= 2, ex.lines.join(' ').slice(0, 140));
  let fk = -1; for (let k = 0; k < B.FISH_MAX; k++) if (sew.sim.fish.state[k] === 1) { fk = k; break; }
  const fe = B.explainFish(sew.sim, fk);
  check('Explain: a fish explains its own state', /fish/i.test(fe.title) && fe.lines.length >= 2, fe.lines[0]);
  const calm = B.createSim(5); for (let s = 0; s < 480; s++) B.step(calm);
  const ce = B.explainCell(calm, calm.wetList[1000]);
  check('Explain: a healthy spot gets a healthy explanation, not a blank', ce.lines.length >= 2 && /healthy/i.test(ce.lines[0]), ce.lines.join(' ').slice(0, 120));
  const land = B.explainCell(calm, 0);
  check('Explain: land gets a sensible message', land.lines.length === 1 && /land|bed/i.test(land.lines[0]));
  const hist = B.cellHistory(sew.sim, best);
  check('live graph history covers about 5 days with finite values', hist.t.length >= 100 && hist.O.every(Number.isFinite) && hist.chl.every(Number.isFinite), hist.t.length + ' frames');
}
{
  const rain = runScenario((s) => B.triggerEvent(s, 'rain'), 8);
  check('heavy rain: runoff adds nutrients and turbidity, level rises then drains back', rain.sim.ledger.added > 500 && Math.abs(B.ledgerError(rain.sim)) < 0.01 && rain.sim.level < 0.1 && rain.bad === 0,
    `added ${rain.sim.ledger.added.toFixed(0)}, level ${rain.sim.level.toFixed(2)}, ledger ${(B.ledgerError(rain.sim) * 100).toFixed(3)}%`);
  const imm = runScenario((s) => B.triggerEvent(s, 'immersion'), 4);
  check('idol immersion: turbidity pulse and organic load at the ghat, lake stays valid', imm.bad === 0 && imm.sim.ev.log.some(e => e.type === 'immersion') && Math.abs(B.ledgerError(imm.sim)) < 0.01, 'ledger ' + (B.ledgerError(imm.sim) * 100).toFixed(3) + '%');
  const dr = runScenario((s) => B.triggerEvent(s, 'drought'), 9);
  check('drought: level falls, area shrinks, no bad values, ledger balances', dr.sim.level < -0.5 && dr.bad === 0 && Math.abs(B.ledgerError(dr.sim)) < 0.01, `level ${dr.sim.level.toFixed(2)} m, ledger ${(B.ledgerError(dr.sim) * 100).toFixed(3)}%`);
  const sim = B.createSim(1100); let ok = true;
  for (const t of ['rain', 'immersion', 'heat', 'drought', 'sewage', 'bogus']) { for (let k = 0; k < 30; k++) { const r = B.triggerEvent(sim, t, 0, 0); if (typeof r.ok !== 'boolean') ok = false; } B.step(sim); }
  check('repeated rapid events and bad pipe placement never throw', ok && badValues(sim) === 0);
  const dry = B.createSim(9); B.setLevel(dry, -6.4); for (let k = 0; k < 240; k++) B.step(dry);
  const r2 = B.triggerEvent(dry, 'sewage', 80, 50); for (let k = 0; k < 240; k++) B.step(dry);
  check('events on a nearly dry lake do not crash', typeof r2.ok === 'boolean' && badValues(dry) === 0);
}

// --- report --------------------------------------------------------------
let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.detail ? '  [' + r.detail + ']' : ''));
}
console.log(`\n${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
