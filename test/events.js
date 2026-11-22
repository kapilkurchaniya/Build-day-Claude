// Event tuning: node test/events.js <scenario> [days]
// scenarios: calm | sewage | heat | both | fix | nofix | rain | immersion | drought
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'bhoj.html'), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(html.match(/<script id="sim">([\s\S]*?)<\/script>/)[1], ctx);
const B = ctx.Bhoj, W = B.W; Object.assign(B.PAR, JSON.parse(process.env.PAR || '{}'));
const scen = process.argv[2] || 'sewage', days = +(process.argv[3] || 7), quiet = process.env.QUIET;

function run(scen, days, seed = 1100) {
  const sim = B.createSim(seed), g = sim.world.ghat;
  const pipeAt = { x: g.x + 8, y: g.y + 1 };
  const out = { sim, firstBloom: -1, firstHyp: -1, firstKill: -1, minScore: 100, scoreAt: {} };
  for (let s = 0; s < days * 240; s++) {
    const t = sim.t;
    if (t === 240) {
      if (['sewage', 'both', 'fix', 'nofix'].includes(scen)) { const r = B.triggerEvent(sim, 'sewage', pipeAt.x, pipeAt.y); if (!quiet) console.log('pipe:', r.msg); }
      if (['heat', 'both'].includes(scen)) B.triggerEvent(sim, 'heat');
      if (scen === 'rain') B.triggerEvent(sim, 'rain');
      if (scen === 'immersion') B.triggerEvent(sim, 'immersion');
      if (scen === 'drought') B.triggerEvent(sim, 'drought');
    }
    if (scen === 'fix' && t === 240 * 4) {      // treat the pipe and add 3 aerators near it
      sim.ev.pipes[0].treated = 0.9;
      const p = sim.ev.pipes[0];
      for (let k = 0; k < 3; k++) { const cx = Math.round(p.x + 6 + k * 7), cy = Math.round(p.y + 4); for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) { const i = y * W + x; if (sim.wet[i]) sim.aer[i] += 12 * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / 6); } }
    }
    B.step(sim);
    for (const en of sim.ev.log) {
      if (en.type === 'bloom' && out.firstBloom < 0) out.firstBloom = en.t;
      if (en.type === 'hypoxia' && out.firstHyp < 0) out.firstHyp = en.t;
      if (en.type === 'fishkill' && out.firstKill < 0) out.firstKill = en.t;
    }
    out.minScore = Math.min(out.minScore, sim.scoreSmooth);
    if (sim.t % 240 === 0) out.scoreAt[sim.t / 240] = sim.scoreSmooth;
  }
  return out;
}

const r = run(scen, days), sim = r.sim;
const d = t => t < 0 ? 'never' : ((t - 240) / 240).toFixed(2) + ' d after event';
console.log(`${scen}: bloom ${d(r.firstBloom)} | hypoxia ${d(r.firstHyp)} | fish kill ${d(r.firstKill)} | deaths ${sim.fish.deaths} | min score ${r.minScore.toFixed(0)}`);
console.log('score by day:', Object.entries(r.scoreAt).map(([k, v]) => k + ':' + v.toFixed(0)).join(' '));
if (!quiet) {
  console.log('\nDiary:');
  for (const en of sim.ev.log) console.log(' ', B.clock(en.t).date.replace(/ · .*/, ''), B.clock(en.t).time, `[${en.type}] ${en.label}`, en.causes.length ? '<- ' + en.causes.map(id => (B.findEntry(sim, id) || {}).label).join(' + ') : '');
  // explain the worst cell
  let worst = -1, wa = -1; for (let k = 0; k < sim.wetCount; k++) { const i = sim.wetList[k]; if (sim.A[i] > wa) { wa = sim.A[i]; worst = i; } }
  const ex = B.explainCell(sim, worst);
  console.log('\nExplain (densest algae cell) at', B.clock(sim.t).time, '\n  ' + ex.title + '\n  ' + ex.lines.join('\n  '));
  console.log('  chain:', ex.chain.map(e => e.label).join(' -> '));
  const h = B.cellHistory(sim, worst); console.log('  history frames', h.t.length, 'O', h.O.slice(-5).map(v => v.toFixed(1)).join(','));
  console.log('  ledger', (B.ledgerError(sim) * 100).toFixed(4) + '%');
}
