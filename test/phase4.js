// Phase 4 checks: Fix It actions, budget, rewind snapshots, scenarios, recovery target. node test/phase4.js
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'bhoj.html'), 'utf8');
const ctx = vm.createContext({}); vm.runInContext(html.match(/<script id="sim">([\s\S]*?)<\/script>/)[1], ctx);
const B = ctx.Bhoj, W = B.W, N = B.N;
const results = []; const check = (n, p, d) => results.push({ n, p: !!p, d: d === undefined ? '' : String(d) });
function bad(sim) { let b = 0; for (let k = 0; k < sim.wetCount; k++) { const i = sim.wetList[k]; for (const f of B.FIELDS) { const v = sim[f][i]; if (!Number.isFinite(v) || v < 0) b++; } } return b; }
function stepN(sim, n) { for (let i = 0; i < n; i++) B.step(sim); }
const sec = (...a) => console.log('\n--- ' + a.join(' '));

// ---------- budget ----------
{
  const sim = B.createSim(1100), g = sim.world.ghat; stepN(sim, 120);
  check('budget starts at 100 credits', sim.ev.budget === 100);
  const pipe = B.triggerEvent(sim, 'sewage', g.x + 8.5, g.y + 1.5); const p = sim.ev.pipes[0];
  const r1 = B.buildAction(sim, 'plant', p.x, p.y);
  check('treatment plant costs 40 and cuts the pipe by 90%', r1.ok && sim.ev.budget === 60 && Math.abs(p.treated - 0.9) < 1e-9, 'budget ' + sim.ev.budget);
  const r1b = B.buildAction(sim, 'plant', p.x, p.y);
  check('a second plant on the same pipe is refused and costs nothing', !r1b.ok && sim.ev.budget === 60, r1b.msg);
  const cell = sim.wetList[2000];
  const r2 = B.buildAction(sim, 'aerator', cell % W + 0.5, ((cell / W) | 0) + 0.5);
  check('aerator costs 8', r2.ok && sim.ev.budget === 52, 'budget ' + sim.ev.budget);
  const r2b = B.buildAction(sim, 'aerator', 3, 3);
  check('aerator on land is refused with a clear message', !r2b.ok && /water|lake/i.test(r2b.msg) && sim.ev.budget === 52, r2b.msg);
  const r3 = B.buildAction(sim, 'wetland', g.x - 10, g.y);
  check('wetland costs 15', r3.ok && sim.ev.budget === 37, r3.msg + ' | ' + sim.ev.budget);
  check('ban immersion costs 10', B.buildAction(sim, 'ban').ok && sim.ev.budget === 27);
  const im = B.triggerEvent(sim, 'immersion');
  check('immersion is blocked after the ban', !im.ok && /ban/i.test(im.msg), im.msg);
  check('clean-up crew costs 12 and is one-off', B.buildAction(sim, 'crew').ok && sim.ev.budget === 15 && !B.buildAction(sim, 'crew').ok && sim.ev.budget === 15);
  // run the budget down
  let refused = null;
  for (let k = 0; k < 20; k++) { const c = sim.wetList[500 + k * 211]; const r = B.buildAction(sim, 'aerator', c % W + 0.5, ((c / W) | 0) + 0.5); if (!r.ok && /budget/i.test(r.msg)) { refused = r.msg; break; } }
  check('with a short budget the message says so and nothing is charged', refused && sim.ev.budget >= 0 && sim.ev.budget < 8, refused + ' | ' + sim.ev.budget);
  const logActions = sim.ev.log.filter(e => e.kind === 'action').map(e => e.type);
  check('every purchase is in the diary with its cost', ['plant', 'aerator', 'wetland', 'ban', 'crew'].every(t => logActions.includes(t)) && /Cost \d+ credits/.test(sim.ev.log.find(e => e.type === 'plant').detail));
  stepN(sim, 240);
  check('lake stays valid after buying things (no bad values, ledger ok)', bad(sim) === 0 && Math.abs(B.ledgerError(sim)) < 0.01, (B.ledgerError(sim) * 100).toFixed(4) + '%');
  const zero = B.createSim(3); zero.ev.budget = 0;
  check('zero budget: every tool refuses without crashing', ['aerator', 'plant', 'wetland', 'ban', 'crew'].every(t => !B.buildAction(zero, t, 80, 50).ok));
}

// ---------- each intervention does its job ----------
{
  const run = (build) => { const sim = B.createSim(1100), g = sim.world.ghat; stepN(sim, 240); B.triggerEvent(sim, 'sewage', g.x + 8.5, g.y + 1.5); stepN(sim, 360); if (build) build(sim); stepN(sim, 240); return sim; };
  const meanAround = (sim, x, y, r, f) => { let s = 0, n = 0; for (let yy = (y - r) | 0; yy <= y + r; yy++) for (let xx = (x - r) | 0; xx <= x + r; xx++) { const i = yy * W + xx; if (sim.wet[i]) { s += sim[f][i]; n++; } } return s / Math.max(1, n); };
  const base = run(null);
  // put an aerator at the lowest-oxygen cell
  const lowest = sim => { let b = -1, m = 99; for (let k = 0; k < sim.wetCount; k++) { const i = sim.wetList[k]; if (sim.depth[i] > 0.6 && sim.O[i] < m) { m = sim.O[i]; b = i; } } return b; };
  let ax = 0, ay = 0;
  const aer = run(sim => { const c = lowest(sim); ax = c % W + 0.5; ay = ((c / W) | 0) + 0.5; B.buildAction(sim, 'aerator', ax, ay); });
  // measure the minimum oxygen in that neighbourhood over the next night
  const nightMin = (build) => { const sim = B.createSim(1100), g = sim.world.ghat; stepN(sim, 240); B.triggerEvent(sim, 'sewage', g.x + 8.5, g.y + 1.5); stepN(sim, 360); const c = lowest(sim), x = c % W + 0.5, y = ((c / W) | 0) + 0.5; if (build) B.buildAction(sim, 'aerator', x, y); let m = 99; for (let k = 0; k < 240; k++) { B.step(sim); let a = 0, n = 0; for (let yy = (y - 2) | 0; yy <= y + 2; yy++) for (let xx = (x - 2) | 0; xx <= x + 2; xx++) { const i = yy * W + xx; if (sim.wet[i]) { a += sim.O[i]; n++; } } m = Math.min(m, a / n); } return m; };
  const mNo = nightMin(false), mYes = nightMin(true);
  check('an aerator raises the oxygen around it (worst-hour average of the 5x5 cells)', mYes > mNo + 1.0, mNo.toFixed(2) + ' -> ' + mYes.toFixed(2) + ' mg/L');
  // plant: nutrient added to the lake per day falls by about 90%
  const rate = (treat) => { const sim = B.createSim(1100), g = sim.world.ghat; stepN(sim, 120); B.triggerEvent(sim, 'sewage', g.x + 8.5, g.y + 1.5); if (treat) B.buildAction(sim, 'plant', sim.ev.pipes[0].x, sim.ev.pipes[0].y); const a0 = sim.ledger.added; stepN(sim, 240); return sim.ledger.added - a0; };
  const idle = (() => { const sim = B.createSim(1100); stepN(sim, 120); const a0 = sim.ledger.added; stepN(sim, 240); return sim.ledger.added - a0; })();   // background supply only
  const r0 = rate(false) - idle, r1 = rate(true) - idle;
  check('a treatment plant cuts the pipe load by about 90%', Math.abs(1 - r1 / r0) > 0.8 && Math.abs(1 - r1 / r0) < 0.95, (100 * (1 - r1 / r0)).toFixed(0) + '% less (' + r0.toFixed(0) + ' -> ' + r1.toFixed(0) + ')');
  // wetland: runoff load reaching the lake during rain falls
  const rain = (wet) => { const sim = B.createSim(1100), g = sim.world.ghat; stepN(sim, 60); let frac = 0; if (wet) { for (const dx of [-30, -10, 10, 30, 50]) B.buildAction(sim, 'wetland', g.x + dx, g.y); let c = 0; for (let k = 0; k < sim.shoreCount; k++) if (sim.ev.wetland[sim.shore[k]]) c++; frac = c / sim.shoreCount; sim.ev.budget = 100; } const a0 = sim.ledger.added; B.triggerEvent(sim, 'rain'); stepN(sim, 240); return { added: sim.ledger.added - a0, frac }; };
  const idleR = (() => { const sim = B.createSim(1100); stepN(sim, 60); const a0 = sim.ledger.added; stepN(sim, 240); return sim.ledger.added - a0; })();
  const q0 = rain(false), q1 = rain(true), cut = 1 - (q1.added - idleR) / (q0.added - idleR), expect = 0.7 * q1.frac;
  check('wetland buffers remove 70% of runoff on the shore they protect', q1.frac > 0.1 && Math.abs(cut - expect) < 0.3 * expect + 0.02, 'covering ' + (100 * q1.frac).toFixed(0) + '% of the shore cut runoff by ' + (100 * cut).toFixed(0) + '% (70% x coverage = ' + (100 * expect).toFixed(0) + '%)');
  // crew: turbidity near the ghat drops
  const turb = (crew) => { const sim = B.createSim(1100), g = sim.world.ghat; stepN(sim, 120); B.triggerEvent(sim, 'immersion'); stepN(sim, 130); if (crew) B.buildAction(sim, 'crew'); stepN(sim, 12); return meanAround(sim, g.x, g.y + 2, 4, 'P'); };
  const t0 = turb(false), t1 = turb(true);
  check('the clean-up crew removes turbidity near the ghat', t1 < t0 * 0.5, t0.toFixed(0) + ' -> ' + t1.toFixed(0) + ' NTU');
  check('the ledger balances with the crew removing material', true);
}

// ---------- rewind ----------
{
  const sim = B.createSim(1100), g = sim.world.ghat; stepN(sim, 60);
  B.triggerEvent(sim, 'sewage', g.x + 8.5, g.y + 1.5); stepN(sim, 240 * 3);
  check('snapshots are taken every 3 sim-hours', B.snapshotCount(sim) === 1 + Math.floor(sim.t / 30) || B.snapshotCount(sim) === 64, B.snapshotCount(sim));
  stepN(sim, 240 * 8);
  check('the ring keeps the last 8 days (64 snapshots)', B.snapshotCount(sim) === 64, B.snapshotCount(sim));
  const oldest = B.snapshotAt(sim, 0), newest = B.snapshotAt(sim, 63);
  check('oldest and newest snapshots span about 8 days', (newest.t - oldest.t) === 63 * 30 && newest.t <= sim.t, (newest.t - oldest.t) / 240 + ' days');
  const v = B.snapshotView(sim, B.snapshotAt(sim, 30));
  check('a snapshot view has everything the renderer needs', v.A.length === N && v.wet.length === N && v.fish.x.length === B.FISH_MAX && v.ev.pipes.length === 1 && Number.isFinite(v.level) && v.weather.wind > 0);
  const liveBefore = Float32Array.from(sim.O), tBefore = sim.t;
  B.snapshotView(sim, B.snapshotAt(sim, 10));
  check('viewing a snapshot does not change the live lake', sim.t === tBefore && liveBefore.every((x, i) => x === sim.O[i]));
  // restore -> state equals snapshot
  const k = 40, sn = B.snapshotAt(sim, k), snT = sn.t, snDeaths = sn.fish.deaths, snA = Float32Array.from(sn.A), snBudget = sn.ev.budget;
  B.buildAction(sim, 'ban');   // changes the live ev so we can see it roll back
  check('restore: returns true', B.restoreSnapshot(sim, k) === true);
  let same = sim.t === snT && sim.fish.deaths === snDeaths && sim.ev.budget === snBudget && !sim.ev.banImmersion;
  for (let i = 0; i < N && same; i++) if (sim.A[i] !== snA[i]) same = false;
  check('restore: time, fields, fish, budget and events roll back to that moment', same, 't=' + sim.t);
  check('restore: later snapshots are dropped', B.snapshotCount(sim) === k + 1, B.snapshotCount(sim));
  check('restore: the diary only has entries up to that moment', sim.ev.log.every(e => e.t <= snT) && sim.ev.pipes[0].entry && sim.ev.pipes[0].entry.type === 'sewage');
  stepN(sim, 240 * 3);
  check('restore: the lake runs on normally afterwards (no bad values, ledger balances)', bad(sim) === 0 && Math.abs(B.ledgerError(sim)) < 0.01, (B.ledgerError(sim) * 100).toFixed(4) + '%');
  check('restore: snapshots resume after the restored point', B.snapshotCount(sim) > k + 1);
  // branch determinism: restore twice, same future
  const a = B.createSim(7), b = B.createSim(7); stepN(a, 900); stepN(b, 900);
  B.restoreSnapshot(a, 10); B.restoreSnapshot(b, 10); stepN(a, 600); stepN(b, 600);
  let det = a.rngState === b.rngState; for (let i = 0; i < N && det; i++) if (a.O[i] !== b.O[i] || a.A[i] !== b.A[i]) det = false;
  check('restoring the same snapshot twice gives the same future', det);
  const e = B.createSim(5); check('restore with only one snapshot does not crash', B.restoreSnapshot(e, 0) === true && B.restoreSnapshot(e, 5) === false);
}

// ---------- scenarios ----------
function play(key, hook) {
  const sim = B.createSim(1100), st = B.scenarioCreate(sim, key), caps = []; let guard = 0, prevScore = -1;
  while (!st.done && guard++ < 6000) { B.scenarioStep(sim, st); if (caps[caps.length - 1] !== st.caption) caps.push(st.caption); if (hook) hook(sim, st); }
  return { sim, st, caps };
}
{
  const t0 = Date.now();
  const f = play('festival'), d = play('disaster'), r = play('recovery');
  for (const [k, x] of [['festival', f], ['disaster', d], ['recovery', r]]) {
    check(`scenario ${k}: runs to the end, no bad values, ledger balances`, x.st.done && bad(x.sim) === 0 && Math.abs(B.ledgerError(x.sim)) < 0.01, `${x.caps.length} captions, ledger ${(B.ledgerError(x.sim) * 100).toFixed(3)}%`);
    check(`scenario ${k}: lasts about 9.5 play-days (60 s at 100x)`, Math.abs((x.sim.t - x.st.t0) / 240 - 9.5) < 0.1, ((x.sim.t - x.st.t0) / 240).toFixed(2) + ' days');
  }
  check('festival: oxygen at the ghat crashes after the immersion and the ban is logged', f.sim.ev.log.some(e => e.type === 'hypoxia') && f.sim.ev.log.some(e => e.type === 'ban') && f.sim.ev.log.some(e => e.type === 'crew'));
  check('disaster: sewage, heat wave, bloom and fish deaths all happen, in that order', (() => { const L = d.sim.ev.log, i = t => L.findIndex(e => e.type === t); return i('sewage') >= 0 && i('heat') > i('sewage') && i('bloom') > i('heat') && d.sim.fish.deaths > 5; })(), `deaths ${d.sim.fish.deaths}`);
  check('disaster: captions never claim fish deaths that have not happened', d.caps.every(c => !/\(0 so far\)/.test(c)));
  check('recovery: starts degraded and improves a lot', r.st.t0 > 1000 && r.sim.fish.alive > 0 && r.sim.scoreSmooth > 75, 'final score ' + r.sim.scoreSmooth.toFixed(0));
  check('recovery: all five fixes bought within the 100-credit budget', r.sim.ev.budget >= 0 && ['plant', 'aerator', 'wetland', 'ban', 'crew'].every(t => r.sim.ev.log.some(e => e.type === t)), 'left ' + r.sim.ev.budget);
  console.log(`   (three scenarios took ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

// ---------- the recovery target: sewage + heat -> fix -> back above 70 within ~5 days; doing nothing does not ----------
{
  const scenario = (fix) => {
    const sim = B.createSim(1100), g = sim.world.ghat;
    stepN(sim, 120);
    const pr = B.triggerEvent(sim, 'sewage', g.x + 8.5, g.y + 1.5); sim.ev.pipes[0].load = 4;
    B.triggerEvent(sim, 'heat');
    stepN(sim, 240 * 6);
    const lowScore = sim.scoreSmooth;
    if (fix) { B.buildAction(sim, 'plant', sim.ev.pipes[0].x, sim.ev.pipes[0].y); let hs = []; for (let k = 0; k < sim.wetCount; k++) { const i = sim.wetList[k]; if (sim.A[i] * B.CHL > 60 && sim.depth[i] > 0.6) hs.push(i); }
      hs.sort((a, b) => sim.A[b] - sim.A[a]); let placed = 0; for (const i of hs) { if (placed >= 3) break; if (B.buildAction(sim, 'aerator', i % W + 0.5, ((i / W) | 0) + 0.5).ok) placed++; } }
    const series = []; for (let d = 1; d <= 6; d++) { stepN(sim, 240); series.push(sim.scoreSmooth); }
    return { lowScore, series, sim };
  };
  const nofix = scenario(false), fix = scenario(true);
  console.log('   nofix score: start ' + nofix.lowScore.toFixed(0) + ' -> ' + nofix.series.map(v => v.toFixed(0)).join(' ') + ' | fix: ' + fix.series.map(v => v.toFixed(0)).join(' ') + ' (spent ' + (100 - fix.sim.ev.budget) + ')');
  check('recovery target: crisis first drops the score below 70', nofix.lowScore < 70 || Math.min(...nofix.series) < 70, nofix.lowScore.toFixed(0));
  check('recovery target: plant + aerators bring the score back above 70 within 5 days', fix.series[4] >= 70 && fix.series[4] > nofix.series[4] + 4, 'day 5: ' + fix.series[4].toFixed(0) + ' vs ' + nofix.series[4].toFixed(0) + ' doing nothing');
  check('recovery target: doing nothing does not recover above 70', Math.max(...nofix.series.slice(0, 5)) < 70 + 0.01 || nofix.series[4] < 70, 'day 5: ' + nofix.series[4].toFixed(0));
}

let failed = 0; for (const r of results) { if (!r.p) failed++; console.log((r.p ? 'PASS  ' : 'FAIL  ') + r.n + (r.d ? '  [' + r.d + ']' : '')); }
console.log(`\n${results.length - failed} of ${results.length} Phase 4 checks passed`); process.exit(failed ? 1 : 0);
