const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'bhoj.html'), 'utf8');
const c = vm.createContext({}); vm.runInContext(html.match(/<script id="sim">([\s\S]*?)<\/script>/)[1], c);
const B = c.Bhoj; Object.assign(B.PAR, JSON.parse(process.env.PAR || '{}'));
const sim = B.createSim(1100), st = B.scenarioCreate(sim, 'recovery');
function inv() { let n = 0, a = 0, d = 0, s = 0, hi = 0; for (let k = 0; k < sim.wetCount; k++) { const i = sim.wetList[k]; n += sim.N[i] * sim.vol[i]; a += sim.A[i] * sim.vol[i]; d += sim.D[i] * sim.vol[i]; s += sim.sed[i]; if (sim.A[i] * 150 > 60) hi++; } return `N ${n.toFixed(0)} A ${a.toFixed(0)} D ${d.toFixed(0)} sed ${s.toFixed(0)} | bloomCells ${hi} | burial ${sim.ledger.burial.toFixed(0)} outflow ${sim.ledger.outflow.toFixed(0)} added ${sim.ledger.added.toFixed(0)}`; }
console.log('start', inv());
let day = -1;
while (!st.done) { B.scenarioStep(sim, st); if (st.phase === 'play' && (sim.t - st.t0) % 480 === 0 && Math.floor((sim.t - st.t0)/480) !== day) { day = Math.floor((sim.t - st.t0)/480); console.log('t+' + (day*2) + 'd', inv()); } }
