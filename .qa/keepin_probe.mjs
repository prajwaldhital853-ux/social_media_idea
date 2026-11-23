/**
 * Does a server that cannot be reached end a session it never rejected?
 *
 * Three real failures, one after another: the 15-minute access token lapsing and
 * the page being reloaded; the session-extension call going unanswered while the
 * user is mid-click; and the server coming back. Django never said "no" to any of
 * them, so the seat has to survive all three — and a deliberate sign-out must
 * still work, or this is a broken door rather than a fix.
 */
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.QA_BASE || 'http://127.0.0.1:3009';
const OUT = process.env.QA_OUT || '.qa';
const EMAIL = 'sita@demo.test';
const PASSWORD = 'exposing-demo-1';

const results = [];
const ok = (name, pass, extra = '') => {
  results.push({ name, pass: !!pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${extra ? ` — ${extra}` : ''}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--lang=en-US', '--force-device-scale-factor=1'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
page.on('pageerror', e => console.log('PAGEERROR', e.message));

let blockRefresh = false;
let refreshAttempts = 0;
await page.setRequestInterception(true);
page.on('request', req => {
  if (/\/api\/auth\/refresh\//.test(req.url())) {
    refreshAttempts += 1;
    if (blockRefresh) return void req.abort('failed').catch(() => {});
    return void req.continue().catch(() => {});
  }
  req.continue().catch(() => {});
});

const cdp = await page.createCDPSession();
const dropAccessToken = () => cdp.send('Network.deleteCookies', { name: 'exposing_access', url: BASE });
const who = () => page.$eval('.rail-user-name', el => el.textContent.trim()).catch(() => null);
const path = () => page.evaluate(() => location.pathname);
/** The anonymous empty state offers a sign-in; a failed list offers a retry. */
const askedToSignIn = () => page.$$eval('.empty-state-cta', els =>
  els.some(e => /sign in|log in/i.test(e.textContent || ''))).catch(() => false);

const setInput = (nth, value) => page.evaluate(([nth, value]) => {
  const el = document.querySelectorAll('.login-content input.login-input')[nth];
  if (!el) return;
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, [nth, value]);

async function signIn() {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const t0 = Date.now();
  for (;;) {
    await setInput(0, EMAIL);
    await setInput(1, PASSWORD);
    const armed = await page.evaluate(() => {
      const b = document.querySelector('.login-content form button.login-submit');
      return !!b && !b.disabled;
    }).catch(() => false);
    if (armed) break;
    if (Date.now() - t0 > 40000) throw new Error('login form never armed');
    await sleep(300);
  }
  await page.evaluate(() => document.querySelector('.login-content form button.login-submit').click());
  await sleep(2500);
  if (await page.$('.auth-code-dev')) {
    await page.evaluate(() => document.querySelector('.auth-code-dev').click());
    await sleep(3000);
  }
  await page.waitForSelector('.rail-user', { timeout: 60000 });
}

const seat = async label => {
  const held = await who();
  const nudge = await askedToSignIn();
  ok(label, held !== null && !nudge, `identity ${held}${nudge ? ', and the page offered a sign-in' : ''}`);
  return held;
};

await signIn();
const name = await who();
ok('signed in on the api build', name === 'Sita Karki', `as ${name}`);

// 1. the access token lapses and the page is reloaded, server healthy
refreshAttempts = 0;
await dropAccessToken();
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(6000);
await seat('a reload after the access token lapsed keeps the seat');
ok('the reload extended the session instead of giving up', refreshAttempts > 0, `${refreshAttempts} refresh attempts`);
await page.screenshot({ path: `${OUT}/keepin-reload.png` });

// 2. mid-session, the extension call goes unanswered
refreshAttempts = 0;
await dropAccessToken();
blockRefresh = true;
await page.click('a.nav-item[href="/notifications"]');
await sleep(3000);
await page.evaluate(() => document.querySelector('.notif-mark')?.click());
await sleep(8000);
const held = await seat('an unanswered refresh does not sign the user out of an open page');
ok('the app never reached the sign-in screen', !(await path()).startsWith('/login'), await path());
ok('the session was actually re-requested and refused by the network', refreshAttempts > 0, `${refreshAttempts} attempts`);
await page.screenshot({ path: `${OUT}/keepin-outage.png` });

// 3. the server answers again — nothing should be re-typed
blockRefresh = false;
await page.click('a.nav-item[href="/"]');
await sleep(2000);
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(7000);
const back = await seat('the seat is still there once the server answers again');
ok('the same identity came back with no sign-in', back === held && back === name, `${back}`);
await page.screenshot({ path: `${OUT}/keepin-wake.png` });

// 4. a deliberate sign-out still ends it
await page.evaluate(() => document.querySelector('.rail-bottom button.icon-btn')?.click());
await sleep(5000);
const gone = await who();
ok('a manual logout still ends the session', gone === null, `rail identity after logout: ${gone}`);
await page.screenshot({ path: `${OUT}/keepin-logout.png` });

await browser.close();
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
