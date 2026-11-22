// Phase 4 browser walkthrough: layers, Fix It tools, budget, Rewind, scenarios. node test/phase4_ui.js
'use strict';
const { spawn } = require('child_process'); const fs = require('fs'), path = require('path'), os = require('os');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', PORT = 9339;
const URL_ = 'file://' + encodeURI(path.join(__dirname, '..', 'bhoj.html')), SHOTS = path.join(__dirname, 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bhoj4-'));
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
    const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.result.data, 'base64')); };
    const results = []; const check = (n, p, d) => results.push({ n, p: !!p, d: d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)) });
    const rect = sel => ev(`(() => { const e = document.querySelector('${sel}'); e.scrollIntoView({block:'nearest'}); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, l: r.left, t: r.top }; })()`);
    const click = async (x, y) => { for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
    const clickSel = async sel => { const r = await rect(sel); await click(r.x, r.y); await sleep(120); };
    const mapAt = async (gx, gy) => { const r = await ev(`(() => { const r = document.getElementById('map').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`); await click(r.l + gx / 160 * r.w, r.t + gy / 100 * r.h); await sleep(150); };
    await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: URL_ }); await sleep(1500);
    await ev('__bhoj.setSpeed(0)');

    // ---- layout: map + toolbar + strip all fit ----
    const lay = await ev(`(() => { const q = s => document.querySelector(s).getBoundingClientRect(); const m = q('#map'), t = q('#toolbar'), s = q('#strip'), vh = innerHeight;
      return { mapBottom: Math.round(m.bottom), stripTop: Math.round(s.top), stripBottom: Math.round(s.bottom), toolbarBottom: Math.round(t.bottom), mapTop: Math.round(m.top), vh, mapW: Math.round(m.width), toolbarW: Math.round(t.width) }; })()`);
    check('the scrubber is really hidden when Rewind is off (not just flagged hidden)', await ev(`getComputedStyle(document.getElementById('scrub')).display`) === 'none' && await ev(`document.getElementById('scrub').getBoundingClientRect().height`) === 0);
    check('toolbar, map and strip stack without overlap and fit the window', lay.toolbarBottom <= lay.mapTop + 1 && lay.mapBottom <= lay.stripTop + 1 && lay.stripBottom <= lay.vh + 1 && lay.toolbarW === lay.mapW, lay);

    // ---- run a sewage crisis quickly, then look at each layer ----
    await ev(`(() => { const s = __bhoj.sim, g = s.world.ghat; for (let k = 0; k < 90; k++) Bhoj.step(s); Bhoj.triggerEvent(s, 'sewage', g.x + 8.5, g.y + 1.5); Bhoj.triggerEvent(s, 'heat'); for (let k = 0; k < 240 * 4 + 150; k++) Bhoj.step(s); })()`);
    await sleep(300);
    for (const l of ['oxygen', 'algae', 'pollution', 'flow', 'normal']) {
      await clickSel(`[data-layer="${l}"]`); await sleep(350);
      const leg = await ev(`document.getElementById('legend').textContent`);
      const pressed = await ev(`document.querySelector('[data-layer="${l}"]').getAttribute('aria-pressed')`);
      check(`layer ${l}: button pressed and legend shown`, pressed === 'true' && leg.length > 10, leg.slice(0, 80));
      await shot(`p4-layer-${l}.png`);
    }
    const mid = await ev(`(() => { const c = document.getElementById('map'), g = c.getContext('2d'); return Array.from(g.getImageData(c.width * 0.5, c.height * 0.5, 1, 1).data); })()`);
    check('canvas actually has pixels', mid[3] === 255);

    // ---- Fix It: budget, tools, refusals ----
    const credits = () => ev(`document.getElementById('fixCredits').textContent`);
    await ev('__bhoj.setSpeed(0)');
    check('budget shown as 100 credits at the start', await credits() === '100' && /100/.test(await ev(`document.getElementById('budgetChip').textContent`)));
    // aerator: arm, tap the water, 8 credits
    await clickSel('[data-fix="aerator"]');
    check('aerator tool arms and shows a hint', await ev(`document.querySelector('[data-fix="aerator"]').getAttribute('aria-pressed')`) === 'true' && /aerator/i.test(await ev(`document.getElementById('toast').textContent`)));
    const bloom = await ev(`(() => { const s = __bhoj.sim; let b = -1, a = -1; for (let k = 0; k < s.wetCount; k++) { const i = s.wetList[k]; if (s.depth[i] > 1 && s.A[i] > a) { a = s.A[i]; b = i; } } return { x: (b % 160) + 0.5, y: ((b / 160) | 0) + 0.5 }; })()`);
    await mapAt(bloom.x, bloom.y); await sleep(250);
    check('tapping the water places an aerator for 8 credits', await credits() === '92' && await ev('__bhoj.sim.ev.aerators.length') === 1, await credits());
    await mapAt(bloom.x + 0.4, bloom.y); await sleep(200);
    check('a second aerator right on top is refused and costs nothing', await credits() === '92' && /already/i.test(await ev(`document.getElementById('toast').textContent`)), await ev(`document.getElementById('toast').textContent`));
    await mapAt(3, 3); await sleep(200);
    check('aerator tapped on land is refused with a message', await credits() === '92' && /water|lake/i.test(await ev(`document.getElementById('toast').textContent`)));
    // treatment plant: needs a pipe
    await clickSel('[data-fix="plant"]'); await mapAt(80, 50); await sleep(200);
    check('treatment plant with no pipe nearby is refused', await credits() === '92' && /pipe/i.test(await ev(`document.getElementById('toast').textContent`)), await ev(`document.getElementById('toast').textContent`));
    const pipe = await ev(`(() => { const p = __bhoj.sim.ev.pipes[0]; return { x: p.x, y: p.y }; })()`);
    await mapAt(pipe.x, pipe.y); await sleep(250);
    check('tapping the pipe builds a plant for 40 credits and cuts the load 90%', await credits() === '52' && Math.abs(await ev('__bhoj.sim.ev.pipes[0].treated') - 0.9) < 1e-9, await credits());
    // wetland on the shore
    await clickSel('[data-fix="wetland"]'); const g = await ev(`(() => { const g = __bhoj.sim.world.ghat; return { x: g.x, y: g.y }; })()`);
    await mapAt(g.x - 12, g.y - 1); await sleep(250);
    check('wetland on the shore costs 15 credits', await credits() === '37' && await ev('__bhoj.sim.ev.wetlands.length') === 1, await credits());
    await clickSel('[data-fix="ban"]'); await clickSel('[data-fix="crew"]');
    check('ban (10) and clean-up crew (12) are bought', await credits() === '15' && await ev('__bhoj.sim.ev.banImmersion') === true && await ev('__bhoj.sim.ev.crewAt') >= 0, await credits());
    await clickSel('[data-fix="crew"]');
    check('the crew is one-off', await credits() === '15' && /already/i.test(await ev(`document.getElementById('toast').textContent`)));
    // run the budget down: aerators until refused
    await clickSel('[data-fix="aerator"]'); await mapAt(bloom.x + 9, bloom.y + 4); await sleep(200);
    check('the last 8 credits buy one more aerator, leaving 7', await credits() === '7');
    await clickSel('[data-fix="aerator"]'); await mapAt(bloom.x - 9, bloom.y - 4); await sleep(200);
    check('with 7 credits left the next aerator is refused with a budget message', await credits() === '7' && /budget/i.test(await ev(`document.getElementById('toast').textContent`)), await ev(`document.getElementById('toast').textContent`));
    check('immersion event refused after the ban', (await ev(`(() => { __bhoj.fire('immersion'); return document.getElementById('toast').textContent; })()`)).match(/ban/i) !== null);
    await ev(`document.querySelector('aside').scrollTo(0, 0)`);
    await ev(`(() => { const s = __bhoj.sim; for (let k = 0; k < 600; k++) Bhoj.step(s); })()`); await sleep(500); await clickSel('[data-layer="normal"]');
    await shot('p4-fixed.png');
    check('interventions appear in the diary and the score chart markers exist', /Treatment plant/.test(await ev(`document.getElementById('diary').textContent`)) && /Aerator/.test(await ev(`document.getElementById('diary').textContent`)));

    // ---- Rewind ----
    await ev(`(() => { document.getElementById('restart').click(); })()`); await sleep(200);
    check('rewind with no history yet is refused politely', await (async () => { await clickSel('#rewindBtn'); return /Not enough history|history/i.test(await ev(`document.getElementById('toast').textContent`)) && await ev('__bhoj.replay') === null; })());
    await ev(`(() => { const s = __bhoj.sim, g = s.world.ghat; for (let k = 0; k < 60; k++) Bhoj.step(s); Bhoj.triggerEvent(s, 'sewage', g.x + 8.5, g.y + 1.5); Bhoj.triggerEvent(s, 'heat'); for (let k = 0; k < 240 * 5; k++) Bhoj.step(s); })()`); await sleep(300);
    const tLive = await ev('__bhoj.sim.t'), scoreLive = await ev('Math.round(__bhoj.sim.scoreSmooth)');
    await clickSel('#rewindBtn'); await sleep(300);
    check('Rewind opens the scrubber and enters view-only mode', await ev('document.getElementById("scrub").hidden') === false && await ev('__bhoj.replay !== null'));
    await ev('__bhoj.setReplayK(2)'); await sleep(300); await shot('p4-rewind-early.png');
    const early = await ev(`({ clock: document.getElementById('clock').textContent, label: document.getElementById('scrubLabel').textContent, score: document.getElementById('healthNum').textContent })`);
    check('scrubbing to the past shows an earlier date and a healthier score', /Day \d/.test(early.label) && +early.score > scoreLive, { early, scoreLive });
    const frozen = await ev('__bhoj.sim.t'); await sleep(500);
    check('the live simulation is frozen while rewound', await ev('__bhoj.sim.t') === frozen && frozen === tLive);
    await clickSel('[data-ev="rain"]');
    check('events during rewind are refused with an explanation', await ev('__bhoj.sim.ev.log.every(e => e.type !== "rain")') && /view-only/i.test(await ev(`document.getElementById('toast').textContent`)));
    await clickSel('[data-fix="aerator"]'); await mapAt(80, 50);
    check('fix tools during rewind are refused', await ev('__bhoj.sim.ev.aerators.length') === 0);
    await clickSel('#scrubPlay'); await sleep(2500);
    const k1 = await ev('__bhoj.replay.k'); check('Play advances the scrubber through history', k1 > 2, k1);
    await ev('__bhoj.setReplayK(Number(document.getElementById("scrubRange").max))'); await sleep(250);
    await clickSel('#scrubLive'); await sleep(250);
    check('Return to live restores the live view', await ev('__bhoj.replay') === null && await ev('document.getElementById("scrub").hidden') === true && await ev('__bhoj.sim.t') === tLive);
    await clickSel('#rewindBtn'); await ev('__bhoj.setReplayK(20)'); const tk = await ev('Bhoj.snapshotAt(__bhoj.sim, 20).t'); await clickSel('#scrubResume'); await sleep(300);
    check('Resume from here makes that moment the present', await ev('__bhoj.sim.t') === tk && await ev('__bhoj.replay') === null && await ev('Bhoj.snapshotCount(__bhoj.sim)') === 21, await ev('__bhoj.sim.t'));
    await ev('__bhoj.setSpeed(100)'); await sleep(1500);
    check('the lake keeps running after a resume', await ev('__bhoj.sim.t') > tk + 20);
    await ev('__bhoj.setSpeed(0)');

    // ---- Scenarios (real time) ----
    for (const [key, secs] of [['festival', 0], ['disaster', 0], ['recovery', 0]]) {
      await clickSel(`[data-scn="${key}"]`); await sleep(400);
      check(`scenario ${key}: starts, runs at 100x and shows a caption`, await ev('__bhoj.scn !== null') && (await ev(`document.getElementById('caption').textContent`)).length > 10);
      const t0 = Date.now(); let prepSeen = false, lastCap = '', caps = new Set(), maxFrame = 0;
      while (Date.now() - t0 < 80000 && await ev('__bhoj.scn !== null')) {
        const st = await ev(`({ phase: __bhoj.scn && __bhoj.scn.st.phase, cap: document.getElementById('caption').textContent, frame: parseFloat(document.getElementById('statFrame').textContent) })`);
        if (st.phase === 'prep') prepSeen = true; caps.add(st.cap); maxFrame = Math.max(maxFrame, st.frame);
        if (key === 'disaster' && Date.now() - t0 > 40000 && Date.now() - t0 < 42500) await shot('p4-scn-disaster.png');
        if (key === 'recovery' && Date.now() - t0 > 25000 && Date.now() - t0 < 27500) await shot('p4-scn-recovery.png');
        if (key === 'festival' && Date.now() - t0 > 30000 && Date.now() - t0 < 32500) await shot('p4-scn-festival.png');
        await sleep(2000);
      }
      const took = (Date.now() - t0) / 1000;
      check(`scenario ${key}: finishes by itself in about a minute`, await ev('__bhoj.scn === null') && took < 80 && took > 25, took.toFixed(0) + ' s' + (prepSeen ? ' (incl. scene setting)' : ''));
      const finalCap = await ev(`document.getElementById('caption').textContent`);
      check(`scenario ${key}: caption narrates as it goes (${caps.size} captions) and ends with a summary`, caps.size >= 6 && /Scenario complete/.test(finalCap) && /score/i.test(finalCap), finalCap.slice(0, 160));
      check(`scenario ${key}: no layout or script errors`, errors.length === 0, errors);
      console.log(`   ${key}: ${took.toFixed(0)} s, ${caps.size} captions, last frame-time reading ${maxFrame} ms`);
    }

    // ---- resize with the new strip ----
    for (const [w, h] of [[390, 800], [820, 1000], [1920, 1080], [1280, 720]]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(500);
      const o = await ev(`(() => { const d = document.documentElement, q = s => document.querySelector(s).getBoundingClientRect(), m = q('#map'), t = q('#toolbar'), s = q('#strip');
        return { overflowX: d.scrollWidth - d.clientWidth, overlapTM: Math.round(t.bottom - m.top), overlapMS: Math.round(m.bottom - s.top), mapRight: Math.round(m.right), vw: d.clientWidth, narrow: innerWidth <= 900, stripBottom: Math.round(s.bottom), vh: innerHeight }; })()`);
      check(`layout ${w}x${h}: nothing overlaps or overflows`, o.overflowX <= 0 && o.overlapTM <= 1 && o.overlapMS <= 1 && o.mapRight <= o.vw && (o.narrow || o.stripBottom <= o.vh + 1), o);
      await shot(`p4-size-${w}.png`);
    }
    await send('Emulation.clearDeviceMetricsOverride');
    check('no script errors anywhere', errors.length === 0, errors);
    let failed = 0; for (const r of results) { if (!r.p) failed++; console.log((r.p ? 'PASS  ' : 'FAIL  ') + r.n + (r.d ? '  ' + r.d : '')); }
    console.log(`\n${results.length - failed} of ${results.length} checks passed`); ws.close(); process.exitCode = failed ? 1 : 0;
  } finally { chrome.kill(); await sleep(300); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
