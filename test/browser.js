// Real-browser check for Bhoj. Run with:  node test/browser.js
// Starts headless Chrome, opens bhoj.html, lets it run in real time, then
// reads values back and saves screenshots. Uses only what ships with node 22.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9337;
const ROOT = path.join(__dirname, '..');
const URL_ = 'file://' + encodeURI(path.join(ROOT, 'bhoj.html'));
const SHOTS = path.join(__dirname, 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bhoj-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--window-size=1440,900', '--hide-scrollbars', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  try {
    let target = null;
    for (let i = 0; i < 50 && !target; i++) {
      await sleep(200);
      try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === 'page'); } catch (e) {}
    }
    if (!target) throw new Error('Chrome did not start');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let nextId = 1; const pending = new Map(), errors = [];
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value).join(' '));
    };
    const send = (method, params) => new Promise(res => { const id = nextId++; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
    const evaluate = async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed');
      return r.result.result.value;
    };
    const shot = async name => {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.result.data, 'base64'));
    };
    const read = () => evaluate(`(() => { const g = id => document.getElementById(id).textContent;
      return { t: __bhoj.sim.t, clock: g('clock'), date: g('date'), level: g('statLevel'), area: (g('statLevel').match(/([0-9]+)%/) || [0, 'none'])[1], fish: g('statFish'), oxy: g('statO'), sun: g('statSun'), frame: g('statFrame'), probe: g('probe') }; })()`);

    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.navigate', { url: URL_ });
    await sleep(1500);

    const results = [];
    const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail === undefined ? '' : JSON.stringify(detail) });

    // 10x for 3 s should be about 12 steps
    const a = await read(); await sleep(3000); const b = await read();
    check('10x advances about 4 steps per second', b.t - a.t >= 9 && b.t - a.t <= 15, { steps: b.t - a.t, clock: b.clock });
    await shot('p1-morning.png');

    // 100x for 3 s should be about 120 steps
    await evaluate('__bhoj.setSpeed(100)'); const c = await read(); await sleep(3000); const d = await read();
    check('100x advances about 40 steps per second', d.t - c.t >= 100 && d.t - c.t <= 135, { steps: d.t - c.t, clock: d.clock });
    check('frame time is under 16.7 ms on average', parseFloat(d.frame) < 17.5, d.frame);

    // pause really pauses
    await evaluate('__bhoj.setSpeed(0)'); const e = await read(); await sleep(800); const f = await read();
    check('pause stops the clock', e.t === f.t, { t: f.t });

    // jump to night by stepping, then screenshot
    await evaluate('(() => { const s = __bhoj.sim; while (Bhoj.sun(s.t).light > 0.01) Bhoj.step(s); })()');
    await sleep(400); await shot('p1-night.png');
    await evaluate('(() => { const s = __bhoj.sim; while (Math.abs(Bhoj.sun(s.t).elev - 0.1) > 0.03 || Bhoj.sun(s.t + 1).elev < Bhoj.sun(s.t).elev) Bhoj.step(s); })()');
    await sleep(400); await shot('p1-sunrise.png');

    // drought preview: lower the level and check the shoreline layer rebuilds
    await evaluate('(() => { const s = __bhoj.sim; while (Bhoj.sun(s.t).light < 0.999) Bhoj.step(s); Bhoj.setLevel(s, -1.8); })()');
    await sleep(600); const g = await read(); await shot('p1-lowwater.png');
    check('lowering the level shrinks the water area', parseInt(g.area) > 30 && parseInt(g.area) < 90, g.area);
    await evaluate('Bhoj.setLevel(__bhoj.sim, 0)');

    // pointer readout on water and on land
    const box = await evaluate(`(() => { const r = document.getElementById('map').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
    const move = (fx, fy) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + box.w * fx, y: box.y + box.h * fy });
    await move(0.5, 0.5); await sleep(250); const w1 = await read();
    await move(0.03, 0.05); await sleep(250); const w2 = await read();
    check('pointer readout: water in the middle, land in the corner', /Water/.test(w1.probe) && w2.probe === 'Land', { mid: w1.probe, corner: w2.probe });

    // restart with another seed, and a bad seed
    await evaluate(`(() => { document.getElementById('seed').value = '42'; document.getElementById('restart').click(); })()`);
    await sleep(500); const h = await read(); await shot('p1-seed42.png');
    check('restart with a new seed resets the clock', h.t <= 3 && h.clock.startsWith('06:'), h.clock);
    await evaluate(`(() => { document.getElementById('seed').value = '-5abc'; document.getElementById('restart').click(); })()`);
    await sleep(300);
    check('a bad seed falls back to the default', (await evaluate(`document.getElementById('seed').value`)) === '1100');

    // rapid resizes must not break anything
    for (const [w, hgt] of [[700, 900], [380, 700], [1920, 1080], [1440, 900]]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 1, mobile: false });
      await sleep(350);
      const o = await evaluate(`(() => { const d = document.documentElement, c = document.getElementById('map').getBoundingClientRect();
        return { overflowX: d.scrollWidth - d.clientWidth, mapW: Math.round(c.width), mapRight: Math.round(c.right), vw: d.clientWidth }; })()`);
      check(`layout fits at ${w}x${hgt}`, o.overflowX <= 0 && o.mapRight <= o.vw && o.mapW >= 160, o);
    }
    // Phase 2: sewage preview. Pipe near the ghat for 4 sim-days, then look at it.
    await send('Emulation.clearDeviceMetricsOverride');
    await evaluate(`(() => { document.getElementById('seed').value = '1100'; document.getElementById('restart').click(); })()`);
    await sleep(400);
    const t0 = Date.now();
    await evaluate(`(() => { const s = __bhoj.sim, g = s.world.ghat;
      for (let k = 0; k < 240 * 4 + 150; k++) { if (k >= 120) { Bhoj.addNutrient(s, g.x, g.y + 2, 2, 8 * 0.7, 'N'); Bhoj.addNutrient(s, g.x, g.y + 2, 2, 8 * 0.3, 'D'); } Bhoj.step(s); } })()`);
    const stepMs = (Date.now() - t0) / 1110;
    check('one sim step costs under 4 ms in the browser', stepMs < 4, stepMs.toFixed(2) + ' ms');
    await evaluate(`(() => { const s = __bhoj.sim; while (Math.abs(Bhoj.sun(s.t).hour - 14) > 0.06) Bhoj.step(s); })()`);
    await sleep(600); await shot('p2-bloom-day.png');
    const bloom = await read();
    check('sewage preview: bloom readout shows high algae', parseInt((await evaluate(`document.getElementById('statChl').textContent`))) > 12, await evaluate(`document.getElementById('statChl').textContent`));
    await evaluate(`(() => { const s = __bhoj.sim; while (Bhoj.sun(s.t).hour < 5.5 || Bhoj.sun(s.t).hour > 6) Bhoj.step(s); })()`);
    await sleep(600); await shot('p2-bloom-dawn.png');
    const dawn = await read();
    check('sewage preview: dawn oxygen low somewhere', parseFloat(dawn.oxy.split('·')[1]) < 3, dawn.oxy);
    // frame time with fish and a bloom on screen, at 100x
    await evaluate('__bhoj.setSpeed(100)'); await sleep(3000);
    const fr = await read();
    check('frame time at 100x with fish under 16.7 ms', parseFloat(fr.frame) < 17.5, fr.frame);
    check('no script errors in the page', errors.length === 0, errors);

    let failed = 0;
    for (const r of results) { if (!r.pass) failed++; console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.detail ? '  ' + r.detail : '')); }
    console.log(`\n${results.length - failed} of ${results.length} browser checks passed`);
    ws.close();
    process.exitCode = failed ? 1 : 0;
  } finally {
    chrome.kill();
    await sleep(300);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch(e => { console.error(e); process.exit(1); });
