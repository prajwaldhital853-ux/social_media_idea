/**
 * The reaction row a post wears, the crowd behind it and the pill under it.
 *
 * Every claim here is a measured box, a real pointer or a number read back from
 * the same endpoint the screen read, because this feature is one sentence: the
 * names and the count a card prints have to agree with the list behind them and
 * with the button that changes them.
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { retryWrite } from './shots.mjs';

// A second checkout runs its own pair of servers, so nothing here may assume the
// screens at :3000.
const BASE = process.env.QA_BASE || 'http://localhost:3001';
const OUT = process.env.QA_OUT || fileURLToPath(new URL('.', import.meta.url)).replace(/\/+$/, '');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DEMO = { username: 'sita', email: 'sita@demo.test', password: 'exposing-demo-1' };
const FB_ORDER = ['like', 'love', 'haha', 'wow', 'sad'];

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--lang=en-US', '--force-device-scale-factor=1']
});

// The failure test throws away two writes on purpose; nothing else may go red.
let expectFailure = false;
const errors = [];
async function newPage(viewport, mobile = false) {
  const page = await browser.newPage();
  await page.setViewport({ ...viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const where = (m.location() && m.location().url) || '';
    if (/\/api\/(auth|sync|notifications\/unread)\//.test(where)) return;
    if (expectFailure && /Failed to load resource|net::ERR_FAILED/.test(m.text())) return;
    errors.push(`console: ${m.text().slice(0, 200)}${where ? ' @ ' + where.slice(0, 140) : ''}`);
  });
  page.on('response', r => {
    if (r.status() < 400) return;
    const u = r.url();
    if (/\/api\/auth\//.test(u)) return;
    if (/\/api\/sync\//.test(u) && (r.status() === 401 || r.status() === 403)) return;
    errors.push(`http ${r.status()}: ${u.slice(0, 160)}`);
  });
  return page;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = (page, name) => retryWrite(() => page.screenshot({ path: `${OUT}/${name}.png` }));
const urlOf = page => page.evaluate(() => location.pathname);
const textOf = (page, sel) => page.$eval(sel, el => el.textContent.trim()).catch(() => '');
const count = (page, sel) => page.$$eval(sel, els => els.length).catch(() => 0);

async function goto(page, path) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(700);
}

async function waitFor(page, sel, timeout = 20000) {
  await page.waitForSelector(sel, { timeout }).catch(() => {});
  return count(page, sel);
}

const api = (page, path, init = {}) => page.evaluate(async ([path, init]) => {
  const headers = { ...(init.headers || {}) };
  if (init.method && init.method !== 'GET') {
    const pair = document.cookie.split('; ').find(c => c.startsWith('exposing_csrf='));
    headers['X-CSRF-Token'] = pair ? decodeURIComponent(pair.split('=')[1]) : '';
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { status: res.status, body };
}, [path, init]);

const freshDevice = page => page.evaluate(() => {
  localStorage.setItem('exposing-device', `qa-${Math.random().toString(36).slice(2, 12)}`);
});

const setInput = (page, nth, value) => page.evaluate(([nth, value]) => {
  const el = document.querySelectorAll('.login-content input.login-input')[nth];
  if (!el) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, [nth, value]);

async function signIn(page, identifier, password) {
  await goto(page, '/login');
  await page.waitForSelector('.login-content', { timeout: 20000 }).catch(() => {});
  await freshDevice(page);
  await setInput(page, 0, identifier);
  await setInput(page, 1, password);
  await page.evaluate(() => document.querySelector('.login-content form button.login-submit')?.click());
  await page.waitForFunction(() => location.pathname === '/' || !!document.querySelector('.auth-code'), { timeout: 25000 }).catch(() => {});
  if ((await textOf(page, '.auth-code-title')) === 'Confirm it is you') {
    await page.evaluate(() => document.querySelector('.auth-code-dev')?.click());
    await page.waitForFunction(() => location.pathname === '/', { timeout: 20000 }).catch(() => {});
  }
  await sleep(900);
  return urlOf(page);
}

/** The centre of the first element matching `sel`, or null. */
/** Brings the target clear of the phone's bottom bar, then measures it. */
async function reach(page, sel) {
  await page.evaluate(s => document.querySelector(s)?.scrollIntoView({ block: 'center' }), sel);
  await sleep(700);
  return center(page, sel);
}

async function center(page, sel) {
  const box = await page.$(sel).then(h => h && h.boundingBox());
  return box && { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

/** A parked cursor raises the picker on its own, so every test starts from the corner. */
async function settle(page) {
  await page.keyboard.press('Escape');
  await page.mouse.move(3, 3);
  await sleep(480);
}

const pillOf = page => page.evaluate(() => {
  const btn = document.querySelector('.post-actions .reaction-trigger');
  return btn ? btn.textContent.trim() : '';
});

/** The kinds a card should print: most used first, Facebook order to break a tie. */
const topKinds = kinds => FB_ORDER
  .map(kind => ({ kind, n: kinds[kind] || 0 }))
  .filter(k => k.n > 0)
  .sort((a, b) => b.n - a.n)
  .slice(0, 3)
  .map(k => k.kind);

/**
 * The busiest post within a few pages of the feed: several kinds on one card and
 * enough names behind them that the list below has to page.
 */
async function richestPost(page) {
  let best = null;
  let cursor = null;
  for (let i = 0; i < 8; i += 1) {
    const body = (await api(page, `/api/feed/${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)).body;
    for (const row of body?.results || []) {
      const kinds = {};
      const merge = map => { for (const k in (map || {})) kinds[k] = (kinds[k] || 0) + map[k]; };
      merge(row.reaction_kinds);
      for (const position in (row.media_reaction_kinds || {})) merge(row.media_reaction_kinds[position]);
      const total = (row.like_count || 0) + (row.media || []).reduce((n, m) => n + (m.like_count || 0), 0);
      if (!best || total > best.total) best = { id: String(row.id), total, kinds, expected: topKinds(kinds) };
    }
    cursor = body?.next_cursor;
    if (!cursor) break;
  }
  return best;
}

// =============================================================== desktop =====
const d = await newPage({ width: 1440, height: 900 });
await signIn(d, DEMO.email, DEMO.password);
const post = await richestPost(d);
await goto(d, `/post/${post.id}`);
await waitFor(d, '.post-page-content article.post .reaction-summary');

const CARD = '.post-page-content article.post';
const PILL = `${CARD} .post-actions .reaction-trigger`;
const summary = await d.evaluate(sel => {
  const row = document.querySelector(`${sel} .reaction-summary`);
  const actions = document.querySelector(`${sel} .post-actions`);
  if (!row || !actions) return null;
  const chips = [...row.querySelectorAll('.reaction-chip .reaction-art')];
  const boxes = chips.map(el => el.getBoundingClientRect());
  const names = row.querySelector('.reaction-names');
  const style = getComputedStyle(names);
  const ring = getComputedStyle(chips[0] || row);
  const btn = document.querySelector(`${sel} .post-actions .reaction-trigger`);
  const pill = getComputedStyle(btn);
  return {
    chips: chips.map(el => el.dataset.kind),
    overlap: boxes.length > 1 ? Math.round(boxes[0].right - boxes[1].left) : 0,
    ring: { width: ring.borderWidth, radius: ring.borderTopLeftRadius, color: ring.borderTopColor },
    oneLine: names.getBoundingClientRect().height < 22,
    ellipsis: style.textOverflow === 'ellipsis' && style.whiteSpace === 'nowrap' && style.overflow === 'hidden',
    names: names.textContent.trim(),
    rowAboveButtons: row.getBoundingClientRect().bottom <= actions.getBoundingClientRect().top + 1,
    mixInButtons: document.querySelectorAll(`${sel} .post-actions .reaction-mix`).length,
    pill: {
      radius: Math.round(parseFloat(pill.borderTopLeftRadius)),
      text: btn.textContent.trim(),
      reacted: btn.classList.contains('reacted'),
      art: btn.querySelector('.reaction-art')?.dataset.kind || null,
      icons: btn.querySelectorAll('.reaction-art, svg').length,
    },
  };
}, CARD);

ok('desktop: the row sits above the buttons and the buttons print no second mix',
  !!summary && summary.rowAboveButtons && summary.mixInButtons === 0,
  JSON.stringify({ above: summary?.rowAboveButtons, mixes: summary?.mixInButtons }));
ok('desktop: the chips are the three most-used kinds, in that order',
  !!summary && summary.chips.length <= 3 && summary.chips.join() === post.expected.join(),
  `screen "${summary?.chips.join(',')}" — server "${post.expected.join(',')}" of ${JSON.stringify(post.kinds)}`);
ok('desktop: the chips overlap and each wears a thin ring',
  !!summary && summary.overlap > 0 && parseFloat(summary.ring.width) >= 1 && parseFloat(summary.ring.radius) >= 40,
  JSON.stringify(summary && { overlapPx: summary.overlap, ring: summary.ring }));
ok('desktop: the names are one line, cut with an ellipsis',
  !!summary && summary.oneLine && summary.ellipsis, JSON.stringify(summary && { oneLine: summary.oneLine, ellipsis: summary.ellipsis }));
ok('desktop: the crowd is named as "… and N others"',
  / and [\d.,]+k? others$/.test(summary?.names || ''), summary?.names || '');
ok('desktop: the pill is a rounded pill holding one icon and the total',
  !!summary && summary.pill.radius >= 900 && summary.pill.icons === 1, JSON.stringify(summary?.pill));
ok('desktop: the pill counts the same crowd the row names',
  summary?.pill.text === String(post.total), `${summary?.pill.text} vs server ${post.total}`);
await shot(d, 'react-desktop-row');

const darkRing = await d.evaluate(() => {
  document.documentElement.setAttribute('data-theme', 'dark');
  return new Promise(resolve => setTimeout(() => {
    const chip = document.querySelector('.reaction-chip .reaction-art');
    const out = { ring: getComputedStyle(chip).borderTopColor, ground: getComputedStyle(document.body).backgroundColor };
    document.documentElement.removeAttribute('data-theme');
    resolve(out);
  }, 300));
});
ok('desktop: the ring is the page’s own ground in either theme',
  !!darkRing.ring && darkRing.ring === darkRing.ground, JSON.stringify(darkRing));

// ---------------------------------------------------------------- the pill ---
if (summary.pill.reacted) {
  const start = await center(d, PILL);
  await d.mouse.click(start.x, start.y);
  await sleep(1300);
  await settle(d);
}
const before = Number(String(await pillOf(d)).replace(/[^\d]/g, '')) || 0;
const at = await center(d, PILL);

await d.mouse.click(at.x, at.y);
const immediate = await pillOf(d);
const trayAfterTap = await count(d, '.reaction-tray');
await sleep(1400);
const settledCount = await pillOf(d);
const afterTap = await d.evaluate(sel => ({
  reacted: document.querySelector(`${sel} .post-actions .reaction-trigger`).classList.contains('reacted'),
  art: document.querySelector(`${sel} .post-actions .reaction-trigger .reaction-art`)?.dataset.kind || null,
  names: document.querySelector(`${sel} .reaction-names`)?.textContent.trim() || '',
}), CARD);
ok('desktop: a tap changes the icon and the count at once, and keeps them',
  immediate === String(before + 1) && settledCount === immediate && afterTap.reacted,
  `${before} -> ${immediate} -> ${settledCount}`);
ok('desktop: a short tap never opens the picker', trayAfterTap === 0, `${trayAfterTap} trays`);
ok('desktop: the names lead with "You" once the reader has reacted',
  /^You\b/.test(afterTap.names), afterTap.names);

await settle(d);
await d.mouse.move(at.x, at.y);
await d.mouse.down();
await sleep(240);
const earlyTray = await count(d, '.reaction-tray');
await sleep(340);
const tray = await d.evaluate(() => {
  const el = document.querySelector('.reaction-tray');
  if (!el) return null;
  return {
    kinds: [...el.querySelectorAll('button')].map(b => b.getAttribute('aria-label')),
    bottom: el.getBoundingClientRect().bottom,
  };
});
ok('desktop: holding about four tenths of a second opens the picker above the pill',
  earlyTray === 0 && !!tray && tray.kinds.length === 5
    && tray.kinds.map(k => k.toLowerCase()).join() === FB_ORDER.join()
    && tray.bottom <= at.box.y + 4,
  `${earlyTray} tray at 240ms, then "${tray ? tray.kinds.join('/') : 'nothing'}"`);

const loveAt = await center(d, '.reaction-tray button:nth-child(2)');
await d.mouse.move(loveAt.x, loveAt.y);
await d.mouse.up();
await sleep(1000);
const loved = await d.evaluate(sel => {
  const btn = document.querySelector(`${sel} .post-actions .reaction-trigger`);
  return {
    art: btn.querySelector('.reaction-art')?.dataset.kind || null,
    text: btn.textContent.trim(),
    color: getComputedStyle(btn).color,
    tray: !!document.querySelector('.reaction-tray'),
  };
}, CARD);
ok('desktop: a second reaction replaces the first, and the pill wears its colour',
  loved.art === 'love' && !loved.tray && loved.text === String(before + 1) && loved.color !== 'rgb(62, 67, 72)',
  JSON.stringify(loved));
await shot(d, 'react-desktop-pill');

await settle(d);
await d.mouse.move(at.x, at.y);
await d.mouse.down();
await sleep(560);
await d.mouse.up();
const heart = await center(d, '.reaction-tray button:nth-child(2)');
await d.mouse.click(heart.x, heart.y);
await sleep(1100);
const off = await pillOf(d);
const stillReacted = await d.evaluate(sel => document.querySelector(`${sel} .post-actions .reaction-trigger`).classList.contains('reacted'), CARD);
ok('desktop: choosing the same reaction again takes it off',
  off === String(before) && !stillReacted, `${before} -> ${off}, reacted ${stillReacted}`);
await settle(d);

// A write that never lands has to leave nothing behind but a sentence.
if ((await count(d, `${PILL}.reacted`)) > 0) {
  await d.mouse.click(at.x, at.y);
  await sleep(1300);
  await settle(d);
}
await d.setRequestInterception(true);
let failNext = 2;
const blocker = req => {
  if (/\/api\/reactions\//.test(req.url()) && req.method() !== 'GET' && failNext > 0) {
    failNext -= 1;
    return req.abort('failed');
  }
  return req.continue().catch(() => {});
};
d.on('request', blocker);
expectFailure = true;
await d.mouse.click(at.x, at.y);
const jumped = await pillOf(d);
await d.waitForFunction(() => !!document.querySelector('.toast.show'), { timeout: 15000 }).catch(() => {});
const toast = await textOf(d, '.toast');
const undone = await pillOf(d);
expectFailure = false;
await d.setRequestInterception(false);
d.off('request', blocker);
ok('desktop: a failed reaction undoes itself and says so',
  jumped === String(before + 1) && undone === String(before) && /not answering|too long|failed/i.test(toast),
  `optimistic ${jumped}, back to ${undone}, toast "${toast}"`);
await sleep(3200); // the toast has its own stay; the next check reads a clean console
await settle(d);

await d.mouse.move(at.x, at.y);
await sleep(620);
const hoverTray = await count(d, '.reaction-tray');
await d.keyboard.press('Escape');
await d.mouse.move(3, 3);
await sleep(520);
const goneTray = await count(d, '.reaction-tray');
ok('desktop: hovering opens the picker and walking away closes it',
  hoverTray === 1 && goneTray === 0, `${hoverTray} on hover, ${goneTray} after leaving`);

// ------------------------------------------------------------- the sheet ----
await goto(d, `/post/${post.id}`);
await waitFor(d, '.post-page-content .reaction-summary');
const rowAt = await center(d, '.post-page-content .reaction-summary');
await d.mouse.click(rowAt.x, rowAt.y);
await d.waitForSelector('.reactors-sheet', { timeout: 12000 }).catch(() => {});
await sleep(1100);
const sheet = await d.evaluate(() => {
  const el = document.querySelector('.reactors-sheet');
  if (!el) return null;
  const box = el.getBoundingClientRect();
  const list = el.querySelector('.reactors-list');
  const first = el.querySelector('.reactor-row');
  return {
    box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), bottom: Math.round(box.bottom) },
    centered: Math.abs((box.x + box.width / 2) - window.innerWidth / 2) < 3 && box.y > 10,
    tabs: [...el.querySelectorAll('.reactors-tabs button')].map(b => ({
      kind: b.querySelector('.reaction-art')?.dataset.kind || 'all',
      text: b.textContent.trim(),
    })),
    rows: el.querySelectorAll('.reactor-row').length,
    firstRow: first && {
      avatar: !!first.querySelector('img, .avatar'),
      name: first.querySelector('.people-meta b')?.textContent.trim() || '',
      handle: first.querySelector('.people-meta small')?.textContent.trim() || '',
      kind: !!first.querySelector('.reactor-kind .reaction-art'),
      follow: first.querySelector('.follow-btn')?.textContent.trim() || null,
    },
    hrefs: [...el.querySelectorAll('.reactor-row .people-id')].map(a => a.getAttribute('href')),
    scrolls: list.scrollHeight > list.clientHeight,
  };
});
const peopleApi = await api(d, `/api/reactions/people/?target_type=post&target_id=${post.id}`);
const counts = peopleApi.body?.counts || {};
const total = peopleApi.body?.total || 0;

ok('desktop: the row opens the list of everyone who reacted',
  !!sheet && sheet.rows > 0 && sheet.scrolls, JSON.stringify({ rows: sheet?.rows, status: peopleApi.status }));
ok('desktop: on a desk it is a framed dialog centered on the page',
  !!sheet && sheet.centered && Math.abs(sheet.box.w - 460) <= 2, JSON.stringify(sheet?.box));
ok('desktop: the tabs are All plus one per kind, each with its count',
  !!sheet && sheet.tabs.length === 1 + Object.keys(counts).length
    && sheet.tabs[0].text.replace(/\D/g, '') === String(total),
  JSON.stringify({ tabs: sheet?.tabs.map(t => t.text), counts, total }));
ok('desktop: every row has an avatar, a name, its reaction and a Follow button',
  !!sheet?.firstRow && sheet.firstRow.avatar && !!sheet.firstRow.name && sheet.firstRow.kind,
  JSON.stringify(sheet?.firstRow));
ok('desktop: the list opens on one page of people, not the whole crowd',
  !!sheet && sheet.rows > 0 && sheet.rows <= 12 && total > 12, `${sheet?.rows} rows of ${total}`);

let grew = true;
for (let i = 0; i < 12 && grew; i += 1) {
  grew = await d.evaluate(() => new Promise(resolve => {
    const list = document.querySelector('.reactors-list');
    if (!list) return resolve(false);
    list.scrollTop = list.scrollHeight;
    const started = document.querySelectorAll('.reactor-row').length;
    setTimeout(() => resolve(document.querySelectorAll('.reactor-row').length > started), 1700);
  }));
}
const walked = await d.evaluate(() => {
  const hrefs = [...document.querySelectorAll('.reactor-row .people-id')].map(a => a.getAttribute('href'));
  return { rows: hrefs.length, unique: new Set(hrefs).size };
});
ok('desktop: the list pages to the end without printing a person twice',
  walked.rows > 12 && walked.rows === walked.unique && walked.rows <= total,
  JSON.stringify({ ...walked, total }));
await shot(d, 'react-desktop-sheet');

const loveTab = (sheet?.tabs || []).find(t => t.kind === 'love');
if (loveTab) {
  await d.evaluate(() => [...document.querySelectorAll('.reactors-tabs button')]
    .find(b => b.querySelector('.reaction-art')?.dataset.kind === 'love')?.click());
  await sleep(1600);
  const tabbed = await d.evaluate(() => ({
    rows: document.querySelectorAll('.reactor-row').length,
    kinds: [...document.querySelectorAll('.reactor-kind .reaction-art')].map(a => a.dataset.kind),
  }));
  ok('desktop: a tab shows that reaction and nothing else',
    tabbed.rows > 0 && tabbed.kinds.every(k => k === 'love') && tabbed.rows === Math.min(counts.love, 12),
    JSON.stringify({ ...tabbed, love: counts.love }));
} else {
  ok('desktop: a tab shows that reaction and nothing else', false, 'the post has no love tab');
}

const followed = await d.evaluate(async () => {
  const find = () => [...document.querySelectorAll('.reactor-row .follow-btn')].find(b => b.textContent.trim() === 'Follow');
  const btn = find();
  if (!btn) return null;
  const row = btn.closest('.reactor-row');
  btn.click();
  await new Promise(r => setTimeout(r, 1800));
  const after = row.querySelector('.follow-btn')?.textContent.trim();
  const cls = row.querySelector('.follow-btn')?.className || '';
  row.querySelector('.follow-btn')?.click();
  await new Promise(r => setTimeout(r, 1400));
  return { after, accepted: after === 'Following' && /on/.test(cls), requested: after === 'Requested' && /pending/.test(cls) };
});
ok('desktop: a Follow pressed in the list lands there and then',
  !!followed && (followed.accepted || followed.requested), JSON.stringify(followed));

await d.keyboard.press('Escape');
await sleep(700);
ok('desktop: Escape puts the list away', (await count(d, '.reactors-sheet')) === 0);

// ================================================================ mobile =====
const m = await newPage({ width: 390, height: 844 }, true);
await signIn(m, DEMO.email, DEMO.password);
await goto(m, '/');
await waitFor(m, 'article.post .reaction-summary');
const mRow = await m.evaluate(() => {
  const row = document.querySelector('.reaction-summary');
  const names = row?.querySelector('.reaction-names');
  const btn = document.querySelector('.post-actions .reaction-trigger');
  const box = btn.getBoundingClientRect();
  return {
    chips: [...(row?.querySelectorAll('.reaction-chip .reaction-art') || [])].map(a => a.dataset.kind),
    names: names?.textContent.trim() || '',
    oneLine: (names?.getBoundingClientRect().height || 0) < 24,
    pillHeight: Math.round(box.height),
    pillWidth: Math.round(box.width),
    radius: Math.round(parseFloat(getComputedStyle(btn).borderTopLeftRadius)),
  };
});
ok('mobile: a phone prints the same row above its buttons',
  mRow.chips.length > 0 && mRow.chips.length <= 3 && mRow.names.length > 0 && mRow.oneLine, JSON.stringify(mRow));
ok('mobile: the pill is a thumb-sized rounded pill',
  mRow.pillHeight >= 40 && mRow.radius >= 900 && mRow.pillWidth >= 44,
  JSON.stringify({ h: mRow.pillHeight, w: mRow.pillWidth, r: mRow.radius }));
await shot(m, 'react-mobile-row');

await goto(m, `/post/${post.id}`);
await waitFor(m, '.post-page-content .reaction-summary');
const mSummary = await reach(m, '.post-page-content .reaction-summary');
await m.touchscreen.tap(mSummary.x, mSummary.y);
await m.waitForSelector('.reactors-sheet', { timeout: 12000 }).catch(() => {});
await sleep(1200);
const mSheet = await m.evaluate(() => {
  const el = document.querySelector('.reactors-sheet');
  if (!el) return null;
  const box = el.getBoundingClientRect();
  return {
    x: Math.round(box.x), w: Math.round(box.width), bottom: Math.round(box.height ? box.bottom : 0),
    top: Math.round(box.y),
    rows: el.querySelectorAll('.reactor-row').length,
    tabs: [...el.querySelectorAll('.reactors-tabs button')].map(b => b.textContent.trim()),
  };
});
ok('mobile: the list is a sheet the width of the phone, resting on its bottom edge',
  !!mSheet && mSheet.x === 0 && mSheet.w === 390 && mSheet.bottom >= 840 && mSheet.top > 40,
  JSON.stringify(mSheet));

let mGrew = true;
for (let i = 0; i < 8 && mGrew; i += 1) {
  mGrew = await m.evaluate(() => new Promise(resolve => {
    const list = document.querySelector('.reactors-list');
    if (!list) return resolve(false);
    list.scrollTop = list.scrollHeight;
    const started = document.querySelectorAll('.reactor-row').length;
    setTimeout(() => resolve(document.querySelectorAll('.reactor-row').length > started), 1700);
  }));
}
const mWalked = await m.evaluate(() => {
  const hrefs = [...document.querySelectorAll('.reactor-row .people-id')].map(a => a.getAttribute('href'));
  return { rows: hrefs.length, unique: new Set(hrefs).size };
});
ok('mobile: the sheet pages on a phone too',
  mWalked.rows > 12 && mWalked.rows === mWalked.unique, JSON.stringify(mWalked));
await shot(m, 'react-mobile-sheet');

const mTab = await m.evaluate(() => {
  const tab = [...document.querySelectorAll('.reactors-tabs button')].find(b => b.querySelector('.reaction-art'));
  if (!tab) return null;
  const kind = tab.querySelector('.reaction-art').dataset.kind;
  tab.click();
  return kind;
});
await sleep(1600);
const mTabbed = await m.evaluate(() => [...document.querySelectorAll('.reactor-kind .reaction-art')].map(a => a.dataset.kind));
ok('mobile: a tab filters the sheet on a phone',
  !!mTab && mTabbed.length > 0 && mTabbed.every(k => k === mTab), `${mTab}: ${mTabbed.join(',')}`);

await m.touchscreen.tap(195, 30);
await sleep(800);
ok('mobile: a tap above the sheet puts it away', (await count(m, '.reactors-sheet')) === 0);

await goto(m, `/post/${post.id}`);
await waitFor(m, '.post-page-content .reaction-summary');
const mBefore = Number(String(await pillOf(m)).replace(/[^\d]/g, '')) || 0;
const mPill = await reach(m, '.post-actions .reaction-trigger');
await m.touchscreen.tap(mPill.x, mPill.y);
const mImmediate = await pillOf(m);
const mTray = await count(m, '.reaction-tray');
await sleep(1500);
ok('mobile: a tap reacts at once and never raises the picker',
  Number(mImmediate) === mBefore + 1 && mTray === 0 && Number(await pillOf(m)) === Number(mImmediate),
  `${mBefore} -> ${mImmediate}, ${mTray} trays`);

await m.touchscreen.touchStart(mPill.x, mPill.y);
await sleep(650);
const mHoldTray = await count(m, '.reaction-tray');
await m.touchscreen.touchEnd();
await sleep(500);
const mStillOpen = await count(m, '.reaction-tray');
const mLove = await center(m, '.reaction-tray button:nth-child(2)');
await m.touchscreen.tap(mLove.x, mLove.y);
await sleep(1300);
const mMood = await m.evaluate(() => document.querySelector('.post-actions .reaction-trigger .reaction-art')?.dataset.kind || null);
await m.touchscreen.tap(mPill.x, mPill.y); // and off again, so the run leaves no trace
await sleep(1400);
const mAfter = await pillOf(m);
ok('mobile: a long press raises the picker and leaves it there to choose from',
  mHoldTray === 1 && mStillOpen === 1 && mMood === 'love',
  `${mHoldTray} during the hold, ${mStillOpen} after release, chose ${mMood}`);
ok('mobile: the phone and the server still agree after all that',
  Number(mAfter) === mBefore, `${mBefore} -> ${mImmediate} -> ${mAfter}`);

ok('no console or HTTP errors during the run', errors.length === 0, [...new Set(errors)].slice(0, 6).join(' | '));

await browser.close();

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} reaction checks green.`);
if (errors.length) console.log('console/network noise:\n' + [...new Set(errors)].slice(0, 25).join('\n'));
await retryWrite(() => writeFileSync(`${OUT}/reactions-results.json`, JSON.stringify({ post, results, errors: [...new Set(errors)] }, null, 2)));
process.exit(failed.length ? 1 : 0);
