import puppeteer from 'puppeteer-core';
import net from 'node:net';

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:3000';
const PASS = 'exposing-demo-1';
const MODE = (process.env.MODE || 'api').toLowerCase();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = 'D:/social_medial/.qa';

const results = [];
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

async function launch() {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--lang=en-US', '--force-device-scale-factor=1'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  return { browser, page };
}
const goto = (page, path) => page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
const textOf = (page, sel) => page.evaluate(s => (document.querySelector(s)?.textContent || '').trim(), sel);

async function signOut(page) {
  await goto(page, '/settings');
  await page.waitForSelector('.settings-logout', { timeout: 10000 }).catch(() => {});
  await page.evaluate(() => document.querySelector('.settings-logout')?.click());
  await page.waitForFunction(() => location.pathname === '/login', { timeout: 15000 }).catch(() => {});
  await sleep(600);
}
async function signIn(page, identifier) {
  await goto(page, '/login');
  if (!(await page.$('.login-content'))) { await signOut(page); await goto(page, '/login'); }
  await page.evaluate(([identifier, pass]) => {
    const set = (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const inputs = [...document.querySelectorAll('.login-content input.login-input')];
    set(inputs[0], identifier); set(inputs[1], pass);
    document.querySelector('.login-content form button.login-submit')?.click();
  }, [identifier, PASS]);
  await page.waitForFunction(() => location.pathname === '/' || !!document.querySelector('.auth-code'), { timeout: 25000 }).catch(() => {});
  if ((await textOf(page, '.auth-code-title')) === 'Confirm it is you') {
    await page.evaluate(() => document.querySelector('.auth-code-dev')?.click());
    await page.waitForFunction(() => location.pathname === '/', { timeout: 20000 }).catch(() => {});
  }
  await sleep(900);
}

const lastReceipt = page => page.evaluate(() => {
  const mine = [...document.querySelectorAll('.chat-bubble.mine')];
  const span = mine.length ? mine[mine.length - 1].querySelector('.chat-receipt') : null;
  return span ? { cls: span.className, text: span.textContent } : null;
});
const waitReceipt = async (page, want, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await lastReceipt(page);
    if (r && r.cls.includes(want)) return r;
    await sleep(400);
  }
  return null;
};
const sendFromCompose = async (page, text) => {
  await page.waitForSelector('.chat-compose input', { timeout: 10000 });
  await page.evaluate(t => {
    const input = document.querySelector('.chat-compose input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, t);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.chat-compose button.chat-send')?.click();
  }, text);
};

// A raw-socket WebSocket probe through the Next proxy. The handshake response
// plus whatever frames the server pushes arrive as plain bytes we can read.
function wsProbe(path, cookie, waitMs = 3000) {
  return new Promise(resolve => {
    const sock = net.connect(3000, 'localhost', () => {
      const lines = [
        `GET ${path} HTTP/1.1`,
        'Host: localhost:3000',
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version: 13',
        'Origin: http://localhost:3000',
      ];
      if (cookie) lines.push(`Cookie: ${cookie}`);
      sock.write(lines.join('\r\n') + '\r\n\r\n');
    });
    let buf = Buffer.alloc(0);
    sock.on('data', d => { buf = Buffer.concat([buf, d]); });
    sock.on('error', () => {});
    setTimeout(() => {
      sock.destroy();
      resolve(buf);
    }, waitMs);
  });
}
const parseWs = buf => {
  const split = buf.indexOf('\r\n\r\n');
  const status = split === -1 ? 0 : Number(buf.toString('latin1').split('\r\n')[0].split(' ')[1] || 0);
  const body = split === -1 ? Buffer.alloc(0) : buf.slice(split + 4);
  const frames = [];
  let at = 0;
  while (at + 1 < body.length) {
    const b0 = body[at];
    const len = b0 & 0x7f;
    const start = at + 2;
    if (start + len > body.length) break;
    frames.push({
      opcode: (b0 >> 4) & 0xf,
      closeCode: len >= 2 ? (body[start] << 8) | body[start + 1] : null,
      text: b0 & 0x8f === 0x81 ? body.slice(start, start + len).toString() : null,
    });
    at = start + len;
  }
  return { status, frames };
};

if (MODE !== 'api') {
  console.log('== demo mode: realtime is API-only; run with MODE=api ==');
  process.exit(0);
}

// Transport layer first: the proxy must carry the upgrade, and the socket must
// answer cookie-less handsakes with 4401 and authed ones with a ready frame.
const A = await launch();
const B = await launch();
await signIn(A.page, 'sita');
const cookie = (await A.page.cookies(BASE)).filter(c => c.name === 'exposing_access')
  .map(c => `${c.name}=${c.value}`).join('; ');
ok('browser session holds an access cookie', cookie.includes('exposing_access='), cookie ? 'token present' : 'missing');

const unauth = parseWs(await wsProbe('/ws/chat/arjun/', ''));
ok('WS without a cookie is closed with 4401', unauth.frames.some(f => f.opcode === 8 && f.closeCode === 4401), JSON.stringify(unauth.frames.map(f => ({ op: f.opcode, code: f.closeCode }))));

const authed = parseWs(await wsProbe('/ws/chat/arjun/', cookie));
const readyFrame = authed.frames.find(f => f.text && f.text.includes('"kind":"ready"'));
ok('authed WS through the proxy answers ready', authed.status === 101 && !!readyFrame, JSON.stringify({ status: authed.status, frame: readyFrame?.text || null }));

// The bell's live line must exist in the page.
await sleep(500);
const hasStream = await A.page.evaluate(() => performance.getEntriesByType('resource').some(r => r.name.includes('/api/notifications/stream/')));
ok('SSE stream is connected in the page', hasStream, 'resource entry present');

// Two-sided thread: typing, live message, live read receipt.
await goto(A.page, '/messages/arjun');
await A.page.waitForSelector('.chat-compose input', { timeout: 15000 });
await signIn(B.page, 'arjun');
await goto(B.page, '/messages/sita');
await B.page.waitForSelector('.chat-compose input', { timeout: 15000 });
await sleep(800);

const stamp = Date.now();
await A.page.evaluate(() => {
  const input = document.querySelector('.chat-compose input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, 't');
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const typing = await B.page.waitForSelector('.chat-typing', { timeout: 8000 }).catch(() => null);
ok('typing on A lands on B over the socket', !!typing, typing ? 'indicator shown' : 'never arrived');

await sendFromCompose(A.page, `Realtime probe ${stamp}`);
const arrived = await B.page.waitForFunction(t =>
  [...document.querySelectorAll('.chat-bubble')].some(b => b.textContent.includes(t)),
  { timeout: 8000 }, `Realtime probe ${stamp}`).catch(() => null);
ok('A message lands on B thread live (no reload)', !!arrived, arrived ? 'bubble appeared' : 'never arrived');

const read = await waitReceipt(A.page, 'read', 12000);
ok('B having the thread open flips A tick to double red live', !!read && read.text === '✓✓', JSON.stringify(read));
if (read) {
  const colors = await A.page.evaluate(() => {
    const pick = cls => [...document.querySelectorAll('.chat-bubble .chat-receipt')].find(s => s.className.includes(cls));
    const style = el => el ? getComputedStyle(el).color : '';
    return { read: style(pick('read')), sentOrDelivered: style(pick('sent')) || style(pick('delivered')) };
  });
  ok('live red tick is colored like the read ticks', colors.read && colors.read !== colors.sentOrDelivered, JSON.stringify(colors));
}
await A.page.screenshot({ path: `${OUT}/f-live-thread.png` });

// SSE: a follow from B must reach A's badge and tray without a reload.
const badge = () => A.page.evaluate(() => {
  const slots = document.querySelectorAll('.topbar-slot');
  const el = slots[1]?.querySelector('.topbar-badge');
  return el ? Number(el.textContent) : 0;
});
const before = await badge();
await goto(B.page, '/u/sita');
await B.page.waitForSelector('.follow-btn', { timeout: 15000 });
await B.page.evaluate(() => {
  const btn = document.querySelector('.follow-btn');
  if (btn.classList.contains('on')) btn.click(); // drop a stale follow first
});
await sleep(1200);
await B.page.evaluate(() => document.querySelector('.follow-btn')?.click());
await sleep(1000);

const grew = await A.page.waitForFunction(prev => {
  const slots = document.querySelectorAll('.topbar-slot');
  const el = slots[1]?.querySelector('.topbar-badge');
  const now = el ? Number(el.textContent) : 0;
  return now > prev;
}, { timeout: 12000 }, before).then(() => true).catch(() => false);
ok('SSE pushes the follow to A badge without reload', grew, `badge ${before} -> live`);

await A.page.evaluate(() => document.querySelectorAll('.topbar-slot')[1]?.querySelector('button')?.click());
await sleep(900);
const row = await A.page.evaluate(() => {
  const rows = [...document.querySelectorAll('.notif-row')];
  return rows.length ? (rows[0].textContent || '').trim() : null;
});
ok('bell tray head shows the realtime row', !!row && /follow|requested|asked to follow/i.test(row), JSON.stringify((row || '').slice(0, 70)));
await A.page.screenshot({ path: `${OUT}/f-sse-row.png` });

await A.browser.close();
await B.browser.close();
console.log(`== ${results.filter(Boolean).length}/${results.length} section F checks (${MODE}) ==`);
process.exit(results.every(Boolean) ? 0 : 1);
