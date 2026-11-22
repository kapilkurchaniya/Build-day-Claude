// Phase 3 browser walkthrough: events, Explain panel, graphs, diary. node test/phase3.js
'use strict';
const { spawn } = require('child_process'); const fs = require('fs'), path = require('path'), os = require('os');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', PORT = 9338;
const URL_ = 'file://' + encodeURI(path.join(__dirname, '..', 'bhoj.html')), SHOTS = path.join(__dirname, 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bhoj3-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--window-size=1500,1000', '--hide-scrollbars', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  try {
    let target = null;
    for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === 'page'); } catch (e) {} }
    const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
    let id = 1; const pend = new Map(), errors = [];
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
    const send = (method, params) => new Promise(r => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result.result.value; };
    const shot = async (name, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.result.data, 'base64')); };
    const results = []; const check = (n, p, d) => results.push({ n, p: !!p, d: d === undefined ? '' : JSON.stringify(d) });
    await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: URL_ }); await sleep(1500);
    await ev('__bhoj.setSpeed(0)');

    // 1. tap the Sewage button, then the shore, with real mouse clicks
    const rect = sel => ev(`(() => { document.querySelector('${sel}').scrollIntoView({block:'nearest'}); const r = document.querySelector('${sel}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, l: r.left, t: r.top }; })()`);
    const click = async (x, y) => { for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
    const b = await rect('[data-ev="sewage"]'); await ev(`document.querySelector('[data-ev="sewage"]').scrollIntoView({block:'center'})`);
    const b2 = await rect('[data-ev="sewage"]'); await click(b2.x, b2.y); await sleep(200);
    check('sewage button arms placement', await ev(`document.querySelector('[data-ev="sewage"]').getAttribute('aria-pressed')`) === 'true' && /Tap the shore/.test(await ev(`document.getElementById('evMsg').textContent`)));
    const mp = await rect('#map'); const g = await ev(`(() => { const g = __bhoj.sim.world.ghat; return { x: g.x + 8, y: g.y }; })()`);
    await click(mp.l + (g.x + 0.5) / 160 * mp.w, mp.t + (g.y + 3) / 100 * mp.h); await sleep(300);
    const pipes = await ev('__bhoj.sim.ev.pipes.length');
    check('tapping near the shore opens a pipe', pipes === 1, pipes);
    check('placement mode ends after the pipe is placed', await ev(`document.querySelector('[data-ev="sewage"]').getAttribute('aria-pressed')`) === 'false');
    check('the event is in the diary', /Sewage pipe/.test(await ev(`document.getElementById('diary').textContent`)));

    // 2. other four events, with real clicks and feedback
    await sleep(900); await ev(`document.querySelector('aside').scrollTo(0, 0)`); await sleep(900);   // let the smooth scroll settle
    for (const e of ['rain', 'heat', 'immersion', 'drought']) { const r = await rect(`[data-ev="${e}"]`); await click(r.x, r.y); await sleep(100); }
    const logTypes = await ev(`__bhoj.sim.ev.log.map(e => e.type).join(',')`);
    check('all five events are logged', ['sewage', 'rain', 'heat', 'immersion', 'drought'].every(t => logTypes.includes(t)), logTypes);

    // 3. restart clean: sewage only, run 4 sim-days at full speed
    await ev(`document.getElementById('restart').click()`); await sleep(300);
    await ev(`(() => { const s = __bhoj.sim, g = s.world.ghat; for (let k = 0; k < 120; k++) Bhoj.step(s); Bhoj.triggerEvent(s, 'sewage', g.x + 8.5, g.y + 1.5); for (let k = 0; k < 240 * 3 + 60; k++) Bhoj.step(s); })()`);
    // pick the densest-algae cell and tap it for real
    const cell = await ev(`(() => { const s = __bhoj.sim; let best = -1, a = -1; const f = s.fish; for (let k = 0; k < s.wetCount; k++) { const i = s.wetList[k]; if (s.A[i] <= a) continue; const x = i % 160 + 0.5, y = ((i / 160) | 0) + 0.5; let near = false; for (let q = 0; q < f.state.length; q++) if (f.state[q] && Math.hypot(f.x[q] - x, f.y[q] - y) < 2.2) { near = true; break; } if (!near) { a = s.A[i]; best = i; } } return { x: best % 160, y: (best / 160) | 0, chl: Math.round(a * 150) }; })()`);
    await ev(`document.getElementById('map').scrollIntoView({block:'center'})`); const mp2 = await rect('#map');
    await click(mp2.l + (cell.x + 0.5) / 160 * mp2.w, mp2.t + (cell.y + 0.5) / 100 * mp2.h); await sleep(900);
    const ex = await ev(`({ title: document.getElementById('exTitle').textContent, text: document.getElementById('exLines').textContent, chain: document.getElementById('exChain').textContent, graphsHidden: document.getElementById('graphs').hidden })`);
    console.log('\nEXPLAIN PANEL (real tap):\n  ' + ex.title + '\n  ' + ex.text + '\n  chain: ' + ex.chain + '\n');
    check('tapping the bloom opens Explain with the sewage cause', /sewage/i.test(ex.text) && /days? ago|hours? ago/.test(ex.text), ex.text.slice(0, 160));
    check('the cause chain lists the pipe', /Sewage pipe/.test(ex.chain));
    check('live graphs appear for a tapped water cell', ex.graphsHidden === false);
    await ev(`document.getElementById('exTitle').scrollIntoView({block:'start'})`); await sleep(300);
    await shot('p3-explain.png');
    await ev(`window.scrollTo(0,0); document.querySelector('aside').scrollTo(0,0)`); await sleep(200); await shot('p3-full.png');

    // 4. a fish: tap one that is alive
    const fish = await ev(`(() => { const f = __bhoj.sim.fish; for (let k = 0; k < f.state.length; k++) if (f.state[k] === 1) return { x: f.x[k], y: f.y[k] }; })()`);
    await ev(`document.getElementById('map').scrollIntoView({block:'center'})`); const mp3 = await rect('#map');
    await click(mp3.l + fish.x / 160 * mp3.w, mp3.t + fish.y / 100 * mp3.h); await sleep(700);
    const fx = await ev(`document.getElementById('exTitle').textContent + ' | ' + document.getElementById('exLines').textContent`);
    check('tapping a fish explains the fish', /fish/i.test(fx), fx.slice(0, 200));
    console.log('FISH EXPLAIN:', fx.slice(0, 300));

    // 5. robustness
    await ev(`(() => { for (let k = 0; k < 40; k++) { __bhoj.fire('rain'); __bhoj.fire('heat'); __bhoj.fire('drought'); __bhoj.fire('immersion'); } })()`);
    const mp4 = await rect('#map'); await click(mp4.l + 30, mp4.t + 30); await sleep(300);   // click land in the corner
    console.log('after land click, selection =', await ev(`JSON.stringify(document.getElementById('exTitle').textContent)`), 'map rect', JSON.stringify(mp3), JSON.stringify(mp4));
    const land = await ev(`document.getElementById('exLines').textContent`);
    check('tapping land gives a sensible message', /land|shore/i.test(land), land.slice(0, 100));
    await ev(`(() => { const s = __bhoj.sim; for (let k = 0; k < 600; k++) Bhoj.step(s); })()`); await sleep(500);
    check('score is a finite number in range', await ev(`(() => { const v = __bhoj.sim.scoreSmooth; return Number.isFinite(v) && v >= 0 && v <= 100; })()`));
    check('no script errors', errors.length === 0, errors);
    let failed = 0; for (const r of results) { if (!r.p) failed++; console.log((r.p ? 'PASS  ' : 'FAIL  ') + r.n + (r.d ? '  ' + r.d : '')); }
    console.log(`\n${results.length - failed} of ${results.length} checks passed`); ws.close(); process.exitCode = failed ? 1 : 0;
  } finally { chrome.kill(); await sleep(300); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
