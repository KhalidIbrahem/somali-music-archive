// Studio v3 phone check: headless Chrome over the DevTools protocol, no packages.
// Usage: OUT=/tmp/studio-shots BASE=http://127.0.0.1:3100 node apps/web/scripts/studio-mobile-check.mjs
// Pass: on /studio at 390 × 844 every mode (start screen, Create, Play, Learn, Listen, Record)
// renders without sideways page scroll (scrollWidth == innerWidth) and without console errors.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const S = process.env.OUT ?? '/tmp/qaraamigen-studio-mobile-check',
  BASE = process.env.BASE ?? 'http://127.0.0.1:3100';
const PORT = 9334;
mkdirSync(`${S}/shots`, { recursive: true });
const chrome = spawn(
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${S}/chrome-profile`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver;
for (let i = 0; i < 40; i++) {
  try {
    ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    break;
  } catch {
    await sleep(250);
  }
}
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  } else if (d.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(d.params.exceptionDetails?.exception?.description ?? 'exception');
  } else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') {
    consoleErrors.push(d.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
};
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, (d) =>
      d.error ? rej(new Error(method + ': ' + JSON.stringify(d.error))) : res(d.result),
    );
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const s = (m, p) => send(m, p, sessionId);
await s('Page.enable');
await s('Runtime.enable');
const evalJs = async (expr) =>
  (await s('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))
    .result.value;
const shot = async (name) => {
  const { data } = await s('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${S}/shots/${name}.png`, Buffer.from(data, 'base64'));
};
const probe = () =>
  evalJs(`(() => {
    const iw = window.innerWidth; const sw = document.documentElement.scrollWidth;
    const over = [...document.querySelectorAll('body *')].filter(e => {
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.right > iw + 1) || getComputedStyle(e).position === 'fixed') return false;
      // inside a horizontal scroller is fine (the timeline, the toolbar)
      let p = e.parentElement;
      while (p) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return false; p = p.parentElement; }
      return true;
    }).slice(0, 6).map(e => e.tagName.toLowerCase() + '.' + String(e.className).split(' ').slice(0, 3).join('.'));
    return { iw, sw, over };
  })()`);
const click = async (selectorOrText) => {
  const ok = await evalJs(`(() => {
    const sel = ${JSON.stringify(selectorOrText)};
    let el = sel.startsWith('text=') ? [...document.querySelectorAll('button')].find(b => b.textContent.trim() === sel.slice(5)) : document.querySelector(sel);
    if (!el) return false; el.click(); return true;
  })()`);
  if (!ok) throw new Error('no element for ' + selectorOrText);
  await sleep(400);
};
const report = [];
const widths = (process.env.WIDTHS ?? '390,414').split(',').map(Number);
for (const width of widths) {
  await s('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 2, mobile: true });
  await s('Emulation.setTouchEmulationEnabled', { enabled: true });
  await s('Page.navigate', { url: BASE + '/studio' });
  for (let i = 0; i < 60 && (await evalJs('document.readyState')) !== 'complete'; i++) await sleep(100);
  await sleep(1200);
  const steps = [
    ['start', null],
    ['create', 'text=Create'],
    ['play', 'text=Play'],
    ['learn', 'text=Learn'],
    ['listen', 'text=Listen'],
    ['record', 'text=Record'],
  ];
  for (const [name, action] of steps) {
    if (action) {
      // the mode chips in the toolbar (the start screen's cards share the labels; both are fine)
      await click(action);
    }
    const p = await probe();
    await shot(`${width}-${name}`);
    report.push({ width, step: name, ...p });
  }
  // Library overlay on a phone: Create mode opens it full-screen; close it.
  const lib = await evalJs(`!!document.querySelector('aside[aria-label="Library"]')`);
  report.push({ width, step: 'library-overlay-present', lib });
}
writeFileSync(`${S}/studio-mobile-report.json`, JSON.stringify({ report, consoleErrors }, null, 1));
let fail = false;
for (const r of report) {
  if (r.sw !== undefined) {
    const ok = r.sw === r.iw && r.over.length === 0;
    if (!ok) fail = true;
    console.log(r.width, r.step.padEnd(8), ok ? 'PASS' : 'FAIL', 'scrollW', r.sw, '/', r.iw, r.over.length ? JSON.stringify(r.over) : '');
  } else console.log(r.width, r.step, r.lib);
}
console.log('console errors:', consoleErrors.length, consoleErrors.slice(0, 5));
if (consoleErrors.length) fail = true;
ws.close();
chrome.kill();
process.exit(fail ? 1 : 0);
