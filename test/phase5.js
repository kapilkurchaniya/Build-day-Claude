// Phase 5 browser checks: self-test, sky/weather, tab hidden, responsive + touch targets. node test/phase5.js
'use strict';
const { spawn } = require('child_process'); const fs = require('fs'), path = require('path'), os = require('os');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', PORT = 9341;
const URL_ = 'file://' + encodeURI(path.join(__dirname, '..', 'bhoj.html')), SHOTS = path.join(__dirname, 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bhoj5-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--window-size=1440,900', '--hide-scrollbars', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  try {
    let target = null;
    for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === 'page'); } catch (e) {} }
    const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
    let id = 1; const pend = new Map(), errors = [];
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
    const send = (method, params) => new Promise(r => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result.result.value; };
    const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.result.data, 'base64')); };
    const results = []; const check = (n, p, d) => results.push({ n, p: !!p, d: d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)) });
    const click = async (x, y) => { for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
    const clickSel = async sel => { const r = await ev(`(() => { const e = document.querySelector('${sel}'); e.scrollIntoView({block:'nearest'}); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`); await click(r.x, r.y); await sleep(150); };
    await send('Runtime.enable'); await send('Page.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: URL_ }); await sleep(1500);

    // ---------- self-test, started with a real click ----------
    await clickSel('#selfTestBtn'); await sleep(300);
    check('Self-test opens a modal dialog', await ev(`document.getElementById('testDlg').open`) === true);
    const t0 = Date.now();
    while (Date.now() - t0 < 90000 && !/checks passed|crashed/.test(await ev(`document.getElementById('testSummary').textContent`))) await sleep(500);
    const summary = await ev(`document.getElementById('testSummary').textContent`);
    const rows = await ev(`Array.from(document.querySelectorAll('#testList li')).map(li => li.className + ' | ' + li.children[1].textContent + ' | ' + li.children[2].textContent)`);
    console.log('\nSELF-TEST (took ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s): ' + summary); rows.forEach(r => console.log('  ' + r));
    await shot('p5-selftest.png');
    check('Self-test: all 7 checks run and every one passes', /^7 of 7/.test(summary) && rows.length === 7 && rows.every(r => r.startsWith('pass')), summary);
    check('Self-test did not disturb the live lake (still at the start)', await ev('__bhoj.sim.t') < 400);
    await clickSel('#testClose'); check('Self-test dialog closes', await ev(`document.getElementById('testDlg').open`) === false);
    // run again works
    await clickSel('#selfTestBtn'); await sleep(200); await clickSel('#testClose'); 

    // ---------- tab hidden and restored ----------
    await ev('__bhoj.setSpeed(100)'); await sleep(500);
    const tA = await ev('__bhoj.sim.t');
    await send('Page.setWebLifecycleState', { state: 'frozen' }); await sleep(4000); await send('Page.setWebLifecycleState', { state: 'active' }); await sleep(500);
    const tB = await ev('__bhoj.sim.t');
    check('after a hidden tab is restored the lake has not fast-forwarded', tB - tA < 80, 'advanced ' + (tB - tA) + ' steps over a 4.5 s gap (at 100x, 40 steps/s is normal)');
    await ev('__bhoj.setSpeed(0)');

    // ---------- sky and weather screenshots ----------
    await ev(`(() => { const s = __bhoj.sim; while (Bhoj.sun(s.t).hour < 23.5 && Bhoj.sun(s.t).hour > 6) Bhoj.step(s); })()`); await sleep(500); await shot('p5-night.png');
    await ev(`(() => { const s = __bhoj.sim; while (Bhoj.sun(s.t).hour > 6.5 || Bhoj.sun(s.t).hour < 6) Bhoj.step(s); })()`); await sleep(400); await shot('p5-dawn.png');
    await ev(`(() => { const s = __bhoj.sim; while (Math.abs(Bhoj.sun(s.t).hour - 17.8) > 0.1) Bhoj.step(s); })()`); await sleep(400); await shot('p5-golden.png');
    await ev(`(() => { const s = __bhoj.sim; Bhoj.triggerEvent(s, 'rain'); for (let k = 0; k < 40; k++) Bhoj.step(s); s.weather.cloud = 0.95; })()`); await sleep(800); await shot('p5-rain.png');
    check('night, dawn, golden hour and rain all render without errors', errors.length === 0, errors);
    await ev(`(() => { document.getElementById('restart').click(); })()`); await sleep(300);

    // ---------- responsive + touch targets ----------
    const SIZES = [[360, 640], [390, 844], [768, 1024], [1024, 768], [1366, 768], [1920, 1080], [2560, 1440], [3840, 2160]];
    for (const [w, h] of SIZES) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(700);
      const o = await ev(`(() => { const d = document.documentElement, q = s => document.querySelector(s).getBoundingClientRect(), m = q('#map'), t = q('#toolbar'), st = q('#strip'), a = q('aside');
        const small = []; document.querySelectorAll('button, input, select').forEach(e => { const r = e.getBoundingClientRect(); if (r.width === 0 || r.height === 0 || getComputedStyle(e).visibility === 'hidden') return; if (Math.min(r.width, r.height) < 43.5) small.push((e.id || e.textContent.trim().slice(0, 14)) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); });
        const clipped = []; document.querySelectorAll('aside .card, #toolbar, #strip, header').forEach(e => { if (e.scrollWidth > e.clientWidth + 2) clipped.push((e.getAttribute('aria-label') || e.id || e.tagName) + ' ' + e.scrollWidth + '>' + e.clientWidth); });
        const narrow = innerWidth <= 900;
        return { overflowX: d.scrollWidth - d.clientWidth, tm: Math.round(t.bottom - m.top), ms: Math.round(m.bottom - st.top), mapW: Math.round(m.width), mapRight: Math.round(m.right), vw: d.clientWidth, asideOverlap: narrow ? Math.round(m.bottom - a.top) : Math.round(m.right - a.left), small, clipped, stripFits: narrow || st.bottom <= innerHeight + 1 }; })()`);
      const ok = o.overflowX <= 0 && o.tm <= 1 && o.ms <= 1 && o.mapRight <= o.vw && o.asideOverlap <= 1 && o.small.length === 0 && o.clipped.length === 0 && o.stripFits && o.mapW >= 300;
      check(`${w}x${h}: no overflow or overlap, every control at least 44px, nothing clipped`, ok, ok ? `map ${o.mapW}px wide` : o);
      if ([360, 1920, 3840].includes(w)) await shot(`p5-size-${w}.png`);
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    check('no script errors anywhere', errors.length === 0, errors);
    let failed = 0; for (const r of results) { if (!r.p) failed++; console.log((r.p ? 'PASS  ' : 'FAIL  ') + r.n + (r.d ? '  ' + r.d : '')); }
    console.log(`\n${results.length - failed} of ${results.length} checks passed`); ws.close(); process.exitCode = failed ? 1 : 0;
  } finally { chrome.kill(); await sleep(300); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
