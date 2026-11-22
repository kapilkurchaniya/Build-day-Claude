// Sweep sewage load / dissolved share; report local algae peak timing, hypoxia and deaths.
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'bhoj.html'), 'utf8');
const W = 160;
function trial(load, share, heat, over = {}, days = 8) {
  const ctx = vm.createContext({}); vm.runInContext(html.match(/<script id="sim">([\s\S]*?)<\/script>/)[1], ctx);
  const B = ctx.Bhoj; B.PAR.sewageLoad = load; B.PAR.sewageDissolved = share; Object.assign(B.PAR, over);
  const sim = B.createSim(1100), g = sim.world.ghat, px = g.x + 8, py = g.y + 1;
  let peakT = 0, peakA = 0, hyp = -1, kill = -1, minLocalO = 99, minScore = 100, bloom100 = -1;
  for (let s = 0; s < days * 240; s++) {
    if (sim.t === 240) { B.triggerEvent(sim, 'sewage', px, py); if (heat) B.triggerEvent(sim, 'heat'); }
    B.step(sim);
    if (sim.t > 240 && sim.t % 6 === 0) {
      const p = sim.ev.pipes[0]; let la = 0, lo = 99;
      for (let y = Math.round(p.y) - 6; y <= Math.round(p.y) + 6; y++) for (let x = Math.round(p.x) - 6; x <= Math.round(p.x) + 6; x++) { const i = y * W + x; if (sim.wet[i]) { la = Math.max(la, sim.A[i] * B.CHL); lo = Math.min(lo, sim.O[i]); } }
      if (la > peakA) { peakA = la; peakT = sim.t; }
      if (la > 100 && bloom100 < 0) bloom100 = sim.t;
      if (lo < 3 && hyp < 0) hyp = sim.t; minLocalO = Math.min(minLocalO, lo);
      if (sim.fish.deaths > 0 && kill < 0) kill = sim.t;
    }
    minScore = Math.min(minScore, sim.scoreSmooth);
  }
  const d = t => t < 0 ? 'never' : ((t - 240) / 240).toFixed(1);
  const sc=sim.scoreParts; return `score ${sim.scoreSmooth.toFixed(0)} [O ${sc.oxygen.toFixed(0)} A ${sc.algae.toFixed(0)} P ${sc.clarity.toFixed(0)} F ${sc.fish.toFixed(0)} L ${sc.level.toFixed(0)}] ${JSON.stringify(over)} load ${load} diss ${share} heat ${heat ? 'Y' : 'n'}: bloom>100 ${d(bloom100)}d peak ${peakA.toFixed(0)} @${d(peakT)}d | localMinO ${minLocalO.toFixed(1)} hyp ${d(hyp)}d | first death ${d(kill)}d deaths ${sim.fish.deaths} | minScore ${minScore.toFixed(0)}`;
}
for (const [l, sh, h, o] of JSON.parse(process.argv[2])) console.log(trial(l, sh, h, o || {}));
