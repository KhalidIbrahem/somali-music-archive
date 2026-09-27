// Mobile check for the public pages: headless Chrome over the DevTools protocol, no packages.
// Usage: OUT=/tmp/shots BASE=http://127.0.0.1:3200 node apps/web/scripts/mobile-check.mjs
// Pass: scrollWidth == innerWidth at 375 and 414 px on every page, hamburger visible,
// desktop links hidden, the panel lists the six nav links, footer strip present.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const S = process.env.OUT ?? '/tmp/qaraamigen-mobile-check',
  BASE = process.env.BASE ?? 'http://127.0.0.1:3200';
const PORT = 9333;
mkdirSync(`${S}/shots`, { recursive: true });
const chrome = spawn(
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
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
const events = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  } else events.push(d);
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
const shot = async (name, full = false) => {
  const params = { format: 'png' };
  if (full) {
    const h = await evalJs('document.documentElement.scrollHeight');
    const w = await evalJs('window.innerWidth');
    params.clip = { x: 0, y: 0, width: w, height: Math.min(h, 6000), scale: 1 };
    params.captureBeyondViewport = true;
  }
  const { data } = await s('Page.captureScreenshot', params);
  writeFileSync(`${S}/shots/${name}.png`, Buffer.from(data, 'base64'));
};
const PAGES = ['/', '/generate', '/transcribe', '/listen', '/scores/beerdilaacshe', '/library'];
const report = [];
for (const width of [375, 414]) {
  await s('Emulation.setDeviceMetricsOverride', {
    width,
    height: 812,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await s('Emulation.setTouchEmulationEnabled', { enabled: true });
  for (const path of PAGES) {
    await s('Page.navigate', { url: BASE + path });
    for (let i = 0; i < 40 && (await evalJs('document.readyState')) !== 'complete'; i++)
      await sleep(100);
    await sleep(700);
    const probe = () =>
      evalJs(`(() => {
      const iw = window.innerWidth; const sw = document.documentElement.scrollWidth;
      const over = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > iw + 1 && getComputedStyle(e).position !== 'fixed'; }).slice(0, 6).map(e => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').slice(0,3).join('.') : ''));
      const btn = document.querySelector('[aria-controls="site-menu"]');
      const menu = document.getElementById('site-menu');
      const desktop = btn ? btn.previousElementSibling : null;
      const small = [...document.querySelectorAll('p, a, li, span, dd, dt, h1, h2, h3, button')].filter(e => e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 11 && e.getBoundingClientRect().height > 0).length;
      return { iw, sw, over, hasBtn: !!btn, btnVisible: btn ? getComputedStyle(btn).display !== 'none' : false, btnBox: btn ? btn.getBoundingClientRect().toJSON() : null, desktopHidden: desktop ? getComputedStyle(desktop).display === 'none' : null, menuHidden: menu ? menu.hidden : null, menuLinks: menu ? [...menu.querySelectorAll('a')].map(a => a.textContent.trim()) : [], tinyText: small, h1: document.querySelector('h1')?.textContent.trim().slice(0, 60), footer: !!document.querySelector('footer') && document.querySelector('footer').textContent.includes('© 2026 Khalid Ibrahim') };
    })()`);
    const before = await probe();
    const tag = `${width}-${path.replace(/\W+/g, '_') || 'home'}`;
    await shot(`${tag}-top`);
    let after = null;
    if (before.hasBtn) {
      await evalJs('document.querySelector(\'[aria-controls="site-menu"]\').click()');
      await sleep(300);
      after = await probe();
      await shot(`${tag}-menu`);
      await evalJs('document.querySelector(\'[aria-controls="site-menu"]\').click()');
      await sleep(200);
    }
    if (path === '/listen' || path === '/') await shot(`${tag}-full`, true);
    report.push({
      width,
      path,
      before,
      menuOpen: after
        ? {
            menuHidden: after.menuHidden,
            links: after.menuLinks,
            expanded: await evalJs(
              'document.querySelector(\'[aria-controls="site-menu"]\')?.getAttribute("aria-expanded")',
            ),
          }
        : null,
    });
  }
}
writeFileSync(`${S}/mobile-report.json`, JSON.stringify(report, null, 1));
for (const r of report)
  console.log(
    r.width,
    r.path.padEnd(22),
    'scrollW',
    r.before.sw,
    '/',
    r.before.iw,
    'over:',
    JSON.stringify(r.before.over),
    'btn',
    r.before.btnVisible,
    'desktopHidden',
    r.before.desktopHidden,
    'tiny',
    r.before.tinyText,
    'footer',
    r.before.footer,
    'menu:',
    r.menuOpen ? `${r.menuOpen.links.length} links hidden=${r.menuOpen.menuHidden}` : '-',
    '| h1:',
    r.before.h1,
  );
await send('Browser.close').catch(() => {});
chrome.kill();
