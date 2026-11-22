// Play a scenario headlessly: node test/scen.js festival|disaster|recovery
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'bhoj.html'), 'utf8');
const c = vm.createContext({}); vm.runInContext(html.match(/<script id="sim">([\s\S]*?)<\/script>/)[1], c);
const B = c.Bhoj; Object.assign(B.PAR, JSON.parse(process.env.PAR || '{}'));
const key = process.argv[2] || 'festival', sim = B.createSim(+(process.env.SEED || 1100)), st = B.scenarioCreate(sim, key);
let lastCap = '', day = -1; const t0 = Date.now(); let prepScore = null;
while (!st.done) {
  B.scenarioStep(sim, st);
  if (st.phase === 'play' && prepScore === null) prepScore = sim.scoreSmooth;
  if (st.caption !== lastCap) { lastCap = st.caption; console.log(`[${st.phase} +${((sim.t - st.t0) / 240).toFixed(1)}d score ${sim.scoreSmooth.toFixed(0)} fish ${sim.fish.alive} deaths ${sim.fish.deaths}] ${st.caption}`); }
  if (st.phase === 'play' && (sim.t - st.t0) % 240 === 0 && Math.floor((sim.t - st.t0) / 240) !== day) { day = Math.floor((sim.t - st.t0) / 240); process.stdout.write(`   day ${day}: score ${sim.scoreSmooth.toFixed(0)} meanO ${sim.stats.meanO.toFixed(1)} minO ${sim.stats.minO.toFixed(1)} chlMax ${sim.stats.maxChl.toFixed(0)} budget ${sim.ev.budget}\n`); }
}
console.log('final score', sim.scoreSmooth.toFixed(0), 'deaths', sim.fish.deaths, 'alive', sim.fish.alive, 'budget left', sim.ev.budget, 'ledger', (B.ledgerError(sim) * 100).toFixed(3) + '%', 'ms', Date.now() - t0);
console.log('diary:'); for (const e of sim.ev.log) console.log('  ', B.clock(e.t).time, e.kind, '|', e.label);
