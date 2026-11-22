// Diagnostic: whole lake starts as a bloom of a given density; print dawn/dusk oxygen.
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'bhoj.html'), 'utf8');
const ctx = vm.createContext({}); vm.runInContext(html.match(/<script id="sim">([\s\S]*?)<\/script>/)[1], ctx);
const B = ctx.Bhoj, A0 = +(process.argv[2] || 1.5), N0 = +(process.argv[3] || 0.5), heat = +(process.argv[4] || 0);
const sim = B.createSim(1100); sim.weather.heat = heat;
for (let k = 0; k < sim.wetCount; k++) { const i = sim.wetList[k]; sim.A[i] = A0; sim.N[i] = N0; sim.D[i] = 0.3; }
for (let d = 0; d < 4; d++) for (let s = 0; s < 240; s++) { B.step(sim); if (s % 60 === 59) { const st = sim.stats; let h = 0; for (let k = 0; k < sim.wetCount; k++) if (sim.O[sim.wetList[k]] < 3) h++; console.log('day', d + 1, B.clock(sim.t).time, 'meanO', st.meanO.toFixed(2), 'minO', st.minO.toFixed(2), 'chl', st.meanChl.toFixed(0), 'N', st.meanN.toFixed(3), 'T', st.meanT.toFixed(1), 'hypCells', h, 'fish', sim.fish.alive); } }
