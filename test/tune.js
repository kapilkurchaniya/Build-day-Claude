// Tuning helper: prints daily lake trajectories. Run with  node test/tune.js [scenario]
// scenario: calm (default) | sewage | heat | both
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'bhoj.html'), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(html.match(/<script id="sim">([\s\S]*?)<\/script>/)[1], ctx);
const B = ctx.Bhoj, W = B.W;
const scen = process.argv[2] || 'calm', days = +(process.argv[3] || 10);
const sim = B.createSim(1100), w = sim.world;
const gx = w.ghat.x, gy = w.ghat.y + 2;   // "pipe" near the ghat for the sewage preview
const local = (r = +(process.env.R || 3)) => { let o = 0, a = 0, n = 0, omin = 99; for (let y = gy - r; y <= gy + r; y++) for (let x = gx - r; x <= gx + r; x++) { const i = y * W + x; if (!sim.wet[i]) continue; o += sim.O[i]; a += sim.A[i]; n++; omin = Math.min(omin, sim.O[i]); } return { o: o / n, a: a / n * B.CHL, omin }; };
console.log('day  hour  meanO  minO  meanChl maxChl  meanT  fish deaths  localO localMinO localChl  sub maxV  ledgerErr');
const t0 = Date.now();
for (let d = 0; d < days; d++) {
  for (let s = 0; s < B.STEPS_PER_DAY; s++) {
    if ((scen === 'sewage' || scen === 'both') && sim.t >= 240) { const L = +(process.env.LOAD || 3); B.addNutrient(sim, gx, gy, 2, L * (+(process.env.NS || 0.7)), 'N'); B.addNutrient(sim, gx, gy, 2, L * (1 - (+(process.env.NS || 0.7))), 'D'); }
    if ((scen === 'heat' || scen === 'both') && sim.t === 240) sim.weather.heat = 6;
    if ((scen === 'heat' || scen === 'both') && sim.t === 240 * 5) sim.weather.heat = 0;
    B.step(sim);
    const hr = Math.floor(B.sun(sim.t).hour);
    if (sim.t % 60 === 0) {
      const st = sim.stats, l = local();
      console.log([d + 1, String(hr).padStart(2), st.meanO.toFixed(2), st.minO.toFixed(2), st.meanChl.toFixed(1).padStart(6), st.maxChl.toFixed(0).padStart(5),
        st.meanT.toFixed(1), String(sim.fish.alive).padStart(4), String(sim.fish.deaths).padStart(5), l.o.toFixed(2).padStart(7), l.omin.toFixed(2).padStart(7), l.a.toFixed(0).padStart(7),
        (() => { let h = 0, b = 0, fb = 0, fh = 0; const f = sim.fish; for (let k = 0; k < sim.wetCount; k++) { const i = sim.wetList[k]; if (sim.O[i] < 3) h++; if (sim.A[i] * B.CHL > 60) b++; } for (let k = 0; k < B.FISH_MAX; k++) if (f.state[k] === 1) { const i = (f.y[k] | 0) * W + (f.x[k] | 0); if (sim.O[i] < 3) fh++; if (sim.A[i] * B.CHL > 60) fb++; } return 'hyp ' + h + ' bloom ' + b + ' fishInHyp ' + fh + ' fishInBloom ' + fb; })(), sim.maxSpeed.toFixed(3), (B.ledgerError(sim) * 100).toFixed(3) + '%'].join('  '));
    }
  }
}
console.log('ms per step', ((Date.now() - t0) / (days * 240)).toFixed(3));
