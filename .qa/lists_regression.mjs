/**
 * Regression check for the shared server-list store (lib/lists.ts).
 *
 * Three things a background re-read must never do again: re-arm the first-load
 * skeleton under a list that already has rows, fan one receipt out into a loop
 * of inbox refetches, or break keyset pagination for the screen that scrolls.
 *
 * Run against the worktree stack: API :8002, Next :3001.
 *   cd backend && <venv python> qa_fixture_unread.py   # seed the precondition
 *   node .qa/lists_regression.mjs
 *
 * The unread row is not decoration: with every thread read, markThreadRead's
 * badge guard closes on the first call and the loop that caused this cannot
 * start. The check asserts the row exists rather than reporting a false green.
 */
import puppeteer from 'puppeteer-core';

const BASE = process.env.QA_BASE || 'http://127.0.0.1:3001';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--lang=en-US', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

let hits = [];
page.on('request', r => {
  const u = r.url();
  if (!u.startsWith(BASE)) return;
  if (/\.(js|css|ico|png|jpg|svg|woff2?)($|\?)/.test(u)) return;
  hits.push(`${r.method()} ${u.slice(BASE.length).split('?')[0]}`);
});
const tally = () => hits.reduce((m, h) => ({ ...m, [h]: (m[h] || 0) + 1 }), {});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const setInput = (nth, value) => page.evaluate(([nth, value]) => {
  const el = document.querySelectorAll('.login-content input.login-input')[nth];
  if (!el) return;
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, [nth, value]);

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('exposing-device', `qa-${Math.random().toString(36).slice(2, 10)}`));
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.login-content', { timeout: 20000 });
await page.waitForResponse(r => r.url().includes('/api/meta/'), { timeout: 20000 }).catch(() => {});
await setInput(0, 'sita@demo.test');
await setInput(1, 'exposing-demo-1');
await page.waitForFunction(() => document.querySelector('.login-submit') && !document.querySelector('.login-submit').disabled, { timeout: 15000 });
await page.evaluate(() => document.querySelector('.login-content form button.login-submit')?.click());
await page.waitForFunction(() => location.pathname === '/', { timeout: 30000 });
ok('sign in', true, page.url());

const seeded = await page.evaluate(async () => {
  const res = await fetch('/api/messages/inbox/', { credentials: 'same-origin' });
  const body = await res.json();
  return (body.results || []).filter(row => Number(row.unread) > 0).map(row => row.user && row.user.username);
});
ok('precondition: an unread thread exists', seeded.length > 0,
  seeded.length ? `unread with ${seeded.join(', ')}` : 'run backend/qa_fixture_unread.py first');

/** Sample a column every 120ms; count how often rows are replaced by a skeleton. */
async function watchColumn(path, selector, ms) {
  hits = [];
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  const flips = await page.evaluate(async ([selector, ms]) => {
    const t0 = Date.now();
    let hadRows = false;
    let flips = 0;
    let sawRows = false;
    while (Date.now() - t0 < ms) {
      const col = document.querySelector(selector);
      // The column also holds the header and the search bar, so "no children"
      // says nothing: count the rows inside the list they render into.
      const list = col?.querySelector('.inbox-list');
      const rows = (list?.querySelectorAll(':scope > *:not(.people-skeleton):not(.feed-sentinel)').length) || 0;
      // A list that had rows and shows none is the store handing its
      // first-load skeleton back — the flicker this check exists to catch.
      if (hadRows && rows === 0) flips++;
      hadRows = rows > 0;
      if (rows > 0) sawRows = true;
      await new Promise(r => setTimeout(r, 120));
    }
    return { flips, sawRows };
  }, [selector, ms]);
  return { ...flips, tally: tally() };
}

const inbox = await watchColumn('/messages', '.inbox-column', 14000);
ok('inbox keeps its rows while it re-reads', inbox.sawRows && inbox.flips === 0, `skeleton re-arms=${inbox.flips}`);

const thread = await watchColumn('/messages/arjun', '.inbox-column', 20000);
const readPosts = thread.tally['POST /api/messages/arjun/read/'] || 0;
const inboxGets = thread.tally['GET /api/messages/inbox/'] || 0;
ok('opening a thread does not re-arm the inbox skeleton', thread.flips === 0, `skeleton re-arms=${thread.flips}`);
ok('one thread open costs a bounded number of marks', readPosts <= 2 && inboxGets <= 2, `POST read=${readPosts} GET inbox=${inboxGets}`);

// Pagination rides on the same store the refresh fix changed: page two must
// still append rather than replace, on a screen nobody re-reads.
hits = [];
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('article.post', { timeout: 25000 }).catch(() => {});
const first = await page.evaluate(() => document.querySelectorAll('article.post').length);
for (let i = 0; i < 6; i++) {
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await sleep(1200);
}
const grown = await page.evaluate(() => document.querySelectorAll('article.post').length);
ok('feed still paginates past the first page', grown > first, `${first} -> ${grown} cards`);
ok('feed pagination reached the server twice or more',
  (tally()['GET /api/feed/'] || 0) >= 2, `GET /api/feed/=${tally()['GET /api/feed/'] || 0}`);

await browser.close();
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
