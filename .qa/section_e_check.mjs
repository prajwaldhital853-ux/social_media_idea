import puppeteer from 'puppeteer-core';
import { retryWrite } from './shots.mjs';
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.QA_BASE || 'http://localhost:3000';
const PASS = 'exposing-demo-1';
const MODE = (process.env.MODE || 'api').toLowerCase();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = 'D:/social_medial/.qa';

const results = [];
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// The recipient runs in a second browser: its cookie jar is separate, so both
// sides of the conversation are real clients at once.
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

// The receipt on the newest message I sent, as {cls, text}.
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
const sendFromCompose = async page => {
  await page.waitForSelector('.chat-compose input', { timeout: 10000 });
  await page.evaluate(text => {
    const input = document.querySelector('.chat-compose input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.chat-compose button.chat-send')?.click();
  }, `Tick probe ${Date.now()}`);
};

if (MODE === 'api') {
  const A = await launch();
  const B = await launch();
  await signIn(A.page, 'sita@demo.test');
  await goto(A.page, '/messages/arjun');
  await sleep(1200);
  await sendFromCompose(A.page);
  const sent = await waitReceipt(A.page, 'sent', 5000);
  ok('API: my message starts as a single gray tick', !!sent && sent.text === '✓', JSON.stringify(sent));
  await retryWrite(() => A.page.screenshot({ path: `${OUT}/e-sent.png` }));

  // The recipient's inbox fetch is the delivery proof.
  await signIn(B.page, 'arjun');
  await goto(B.page, '/messages');
  await sleep(1500);
  const delivered = await waitReceipt(A.page, 'delivered', 12000);
  ok('API: recipient inbox flips it to double gray (live poll, no reload)', !!delivered && delivered.text === '✓✓', JSON.stringify(delivered));
  await retryWrite(() => A.page.screenshot({ path: `${OUT}/e-delivered.png` }));

  // Opening the thread is the read proof.
  await goto(B.page, '/messages/sita');
  await page_wait_thread(B.page);
  const read = await waitReceipt(A.page, 'read', 12000);
  ok('API: recipient opening the thread flips it to double red', !!read && read.text === '✓✓', JSON.stringify(read));
  if (read) {
    const colors = await A.page.evaluate(() => {
      const pick = cls => [...document.querySelectorAll('.chat-bubble .chat-receipt')].find(s => s.className.includes(cls));
      const style = el => el ? getComputedStyle(el).color : '';
      return { delivered: style(pick('delivered')), read: style(pick('read')) };
    });
    ok('API: read tick is a different (red) color from the gray ones', colors.read && colors.read !== colors.delivered, JSON.stringify(colors));
  }
  await retryWrite(() => A.page.screenshot({ path: `${OUT}/e-read.png` }));

  await goto(A.page, '/messages');
  await A.page.waitForSelector('.inbox-row', { timeout: 10000 }).catch(() => {});
  await sleep(800);
  const preview = await A.page.evaluate(() => {
    const row = [...document.querySelectorAll('.inbox-row')].find(r => (r.querySelector('.inbox-row-preview')?.textContent || '').trim().startsWith('You'));
    const span = row?.querySelector('.inbox-row-preview .chat-receipt');
    return { preview: row?.querySelector('.inbox-row-preview')?.textContent?.trim().slice(0, 60) || null, span: span ? { cls: span.className, text: span.textContent } : null };
  });
  ok('API: inbox "You:" preview carries the receipt tick', !!preview.span && preview.span.text === '✓✓', JSON.stringify(preview));
  await retryWrite(() => A.page.screenshot({ path: `${OUT}/e-inbox.png` }));
  await A.browser.close();
  await B.browser.close();
} else {
  const A = await launch();
  // The demo seed ships signed in as sita (u1); the login form is not involved.
  await goto(A.page, '/');
  await sleep(1200);
  const who = await A.page.evaluate(() => JSON.parse(localStorage.getItem('exposing-demo-v1')).meId);
  ok('demo: fresh session is sita (u1)', who === 'u1', JSON.stringify({ who }));
  await goto(A.page, '/messages/bikash_s');
  await A.page.waitForSelector('.chat-bubble', { timeout: 10000 }).catch(() => {});
  await sleep(800);
  const seeded = await lastReceipt(A.page);
  ok('demo: seeded read message shows the red double tick', !!seeded && seeded.cls.includes('read') && seeded.text === '✓✓', JSON.stringify(seeded));
  await retryWrite(() => A.page.screenshot({ path: `${OUT}/e-demo-seeded.png` }));

  await sendFromCompose(A.page);
  const sent = await waitReceipt(A.page, 'sent', 4000);
  ok('demo: a fresh send starts as a single gray tick', !!sent && sent.text === '✓', JSON.stringify(sent));
  const delivered = await waitReceipt(A.page, 'delivered', 4000);
  ok('demo: the delivery receipt lands on its own', !!delivered && delivered.text === '✓✓', JSON.stringify(delivered));
  await retryWrite(() => A.page.screenshot({ path: `${OUT}/e-demo-delivered.png` }));

  await goto(A.page, '/messages');
  await sleep(900);
  const preview = await A.page.evaluate(() => {
    const row = [...document.querySelectorAll('.inbox-row')].find(r => /you/i.test(r.textContent || ''));
    const span = row?.querySelector('.inbox-row-preview .chat-receipt');
    return span ? { cls: span.className, text: span.textContent } : null;
  });
  ok('demo: inbox "You:" preview carries the receipt tick', !!preview && preview.text === '✓✓', JSON.stringify(preview));
  await retryWrite(() => A.page.screenshot({ path: `${OUT}/e-demo-inbox.png` }));
  await A.browser.close();
}

async function page_wait_thread(page) {
  await page.waitForSelector('.chat-bubble', { timeout: 10000 }).catch(() => {});
  await sleep(1200);
}

console.log(`== ${results.filter(Boolean).length}/${results.length} section E checks (${MODE}) ==`);
