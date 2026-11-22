// Screenshot helper: node test/shot.js <out.png> <width> <height> "<js to run first>" [waitMs]
'use strict';
const { spawn } = require('child_process'); const fs = require('fs'), path = require('path'), os = require('os');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', PORT = 9340;
const [out, w, h, js, wait] = process.argv.slice(2); const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bhoj-s-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, `--window-size=${w},${h}`, '--hide-scrollbars', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  try {
    let target = null; for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === 'page'); } catch (e) {} }
    const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
    let id = 1; const pend = new Map(); ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
    const send = (method, params) => new Promise(r => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Runtime.enable'); await send('Page.enable'); await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'file://' + encodeURI(path.join(__dirname, '..', 'bhoj.html')) }); await sleep(1500);
    const r = await send('Runtime.evaluate', { expression: js || '0', returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) console.log('JS error:', r.result.exceptionDetails.exception?.description);
    await sleep(+(wait || 600));
    const shot = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64')); ws.close();
  } finally { chrome.kill(); await sleep(200); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
