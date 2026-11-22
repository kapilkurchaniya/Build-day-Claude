// Calm-lake long run with PAR overrides: node test/calm.js '{"bgN":0.01,"death":0.05}' [days]
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'bhoj.html'), 'utf8');
const c = vm.createContext({}); vm.runInContext(html.match(/<script id="sim">([\s\S]*?)<\/script>/)[1], c);
const B = c.Bhoj; Object.assign(B.PAR, JSON.parse(process.argv[2] || '{}'));
const days = +(process.argv[3] || 24), s = B.createSim(1100), W = 160, pi = s.world.ghat.y * W + s.world.ghat.x + 4 * W;
const out = []; let mx = -1, mn = 99, sw = [];
for (let i = 0; i < 240 * days; i++) {
  B.step(s); const o = s.O[pi]; if (s.wet[pi]) { mx = Math.max(mx, o); mn = Math.min(mn, o); }
  if (s.t % 240 === 0) { sw.push((mx - mn).toFixed(2)); mx = -1; mn = 99; }
  if (s.t % (240 * 6) === 0) out.push('d' + s.t / 240 + ' chl ' + s.stats.meanChl.toFixed(1) + ' O ' + s.stats.meanO.toFixed(2) + ' N ' + s.stats.meanN.toFixed(3));
}
console.log(process.argv[2], '\n  ', out.join(' | '), '\n   swing last 3 days', sw.slice(-3).join(','), 'deaths', s.fish.deaths, 'score', s.scoreSmooth.toFixed(0));
