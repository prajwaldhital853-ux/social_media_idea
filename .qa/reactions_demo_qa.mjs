/**
 * The same reaction row, read from the demo build.
 *
 * The shipped build proves the row against the server's own numbers; this proves
 * the branch that draws it when the whole database lives on the device — chips,
 * names, the sheet's paging and the pill all come out of the local cache instead.
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { retryWrite } from './shots.mjs';

const BASE = process.env.QA_BASE || 'http://localhost:3001';
const OUT = process.env.QA_OUT || fileURLToPath(new URL('.', import.meta.url)).replace(/\/+$/, '');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FB_ORDER = ['like', 'love', 'haha', 'wow', 'sad'];

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--lang=en-US', '--force-device-scale-factor=1'],
});

const errors = [];
async function newPage(viewport, mobile = false) {
  const page = await browser.newPage();
  await page.setViewport({ ...viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });
  page.on('response', r => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url().slice(0, 160)}`); });
  return page;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = (page, name) => retryWrite(() => page.screenshot({ path: `${OUT}/${name}.png` }));
const count = (page, sel) => page.$$eval(sel, els => els.length).catch(() => 0);
const textOf = (page, sel) => page.$eval(sel, el => el.textContent.trim()).catch(() => '');

async function goto(page, path) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('article.post', { timeout: 30000 }).catch(() => {});
  await sleep(800);
}

/**
 * The busiest card on the device, then the same numbers recomputed from the
 * database it was drawn from — so a claim about the row is a claim about the
 * cache, not about whatever the seed happened to look like last week.
 */
/** The demo feed paints ten cards at a time; walk it so every card exists. */
async function loadAll(page) {
  for (let i = 0; i < 20; i += 1) {
    const before = await count(page, 'article.post');
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await sleep(450);
    if ((await count(page, 'article.post')) === before) break;
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await sleep(300);
}

/**
 * The busiest card the reader actually scrolls past, with the same numbers
 * recomputed from the cache it was drawn from — a reel or a hidden post is not
 * a card, so it cannot be the one under test.
 */
async function richest(page) {
  return page.evaluate(order => {
    const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
    const cards = [...document.querySelectorAll('article.post')];
    const scored = db.posts.filter(p => p.status === 'live' && (p.text || '').length >= 12).map(post => {
      const rows = db.reactions.filter(r =>
        (r.targetType === 'post' && r.targetId === post.id) ||
        (r.targetType === 'media' && r.targetId.startsWith(`${post.id}#m`)));
      const kinds = {};
      for (const r of rows) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
      const text = post.text.slice(0, 40);
      return {
        id: post.id,
        text,
        n: rows.length,
        people: new Set(rows.map(r => r.uid)).size,
        kinds,
        mine: rows.some(r => r.uid === db.meId && r.targetType === 'post'),
        rendered: cards.some(a => a.textContent.includes(text) && a.querySelector('.reaction-summary')),
      };
    }).filter(s => s.rendered && Object.keys(s.kinds).length > 1).sort((a, b) => b.n - a.n)[0];
    if (!scored) return null;
    scored.top = order.map(kind => ({ kind, n: scored.kinds[kind] || 0 })).filter(k => k.n > 0)
      .sort((a, b) => b.n - a.n).slice(0, 3).map(k => k.kind);
    return scored;
  }, FB_ORDER);
}

const openCard = async (page, text) => {
  for (let i = 0; i < 16; i += 1) {
    const found = await page.evaluate(t => {
      const card = [...document.querySelectorAll('article.post')].find(a => a.textContent.includes(t));
      if (!card) return false;
      card.scrollIntoView({ block: 'center' });
      return true;
    }, text);
    if (found) break;
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await sleep(400);
  }
  await sleep(700);
  return page.evaluate(t => {
    const card = [...document.querySelectorAll('article.post')].find(a => a.textContent.includes(t));
    const row = card?.querySelector('.reaction-summary');
    if (!row) return null;
    const chips = [...row.querySelectorAll('.reaction-chip .reaction-art')].map(el => el.getAttribute('data-kind'));
    const names = row.querySelector('.reaction-names');
    const pill = card.querySelector('.post-actions .reaction-trigger');
    const pillStyle = getComputedStyle(pill);
    const chipStyle = getComputedStyle(row.querySelector('.reaction-chip') || row);
    const secondChip = row.querySelector('.reaction-chip + .reaction-chip');
    return {
      names: names.textContent.trim(),
      chips,
      oneLine: getComputedStyle(names).whiteSpace === 'nowrap',
      ellipsis: getComputedStyle(names).textOverflow === 'ellipsis',
      pill: pill.textContent.trim(),
      pillRadius: parseFloat(pillStyle.borderRadius),
      pillArt: pill.querySelectorAll('.reaction-art').length,
      mixes: card.querySelectorAll('.post-actions .reaction-mix').length,
      overlap: secondChip ? -parseFloat(getComputedStyle(secondChip).marginLeft) : 0,
      ring: getComputedStyle(row.querySelector('.reaction-chip .reaction-art') || chipStyle).borderColor,
      ground: getComputedStyle(document.body).backgroundColor,
    };
  }, text);
};

const sheetState = page => page.evaluate(() => {
  const sheet = document.querySelector('.reactors-sheet');
  if (!sheet) return null;
  const box = sheet.getBoundingClientRect();
  return {
    tabs: [...sheet.querySelectorAll('.reactors-tabs button')].map(b => b.textContent.trim()),
    rows: sheet.querySelectorAll('.reactor-row').length,
    names: [...sheet.querySelectorAll('.reactor-row .people-meta b')].map(b => b.textContent.trim()),
    kinds: [...sheet.querySelectorAll('.reactor-kind .reaction-art')].map(el => el.getAttribute('data-kind')),
    follows: [...sheet.querySelectorAll('.reactor-row .follow-btn')].length,
    x: Math.round(box.x),
    w: Math.round(box.width),
    bottom: Math.round(window.innerHeight - box.bottom),
    sheetWidth: Math.round(window.innerWidth),
  };
});

/** The same post's numbers re-read from the cache, after the pill tests moved it. */
const cacheNumbers = (page, id) => page.evaluate(pid => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const rows = db.reactions.filter(r =>
    (r.targetType === 'post' && r.targetId === pid) || (r.targetType === 'media' && r.targetId.startsWith(`${pid}#m`)));
  const kinds = {};
  for (const r of rows) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
  return { n: rows.length, people: new Set(rows.map(r => r.uid)).size, kinds };
}, id);

// ================= DESKTOP =================
const d = await newPage({ width: 1280, height: 900 });
await goto(d, '/');

const isDemoBuild = await d.evaluate(() => !!localStorage.getItem('exposing-demo-v1'));
ok('demo: this build runs on the localStorage database', isDemoBuild, JSON.stringify({ isDemoBuild }));
if (!isDemoBuild) {
  console.log('\nreactions_demo_qa.mjs needs a demo build: NEXT_PUBLIC_API=off npx next build');
  await retryWrite(() => writeFileSync(`${OUT}/reactions-demo-results.json`, JSON.stringify({ results, errors }, null, 2)));
  await browser.close();
  process.exit(1);
}

await loadAll(d);
const target = await richest(d);
ok('demo: a card with several kinds and a crowd exists',
  !!target && Object.keys(target.kinds).length > 1 && target.people > 4, JSON.stringify(target?.kinds));
if (!target) {
  console.log('\nno rendered card carries more than one reaction kind — the demo seed changed shape.');
  await retryWrite(() => writeFileSync(`${OUT}/reactions-demo-results.json`, JSON.stringify({ results, errors }, null, 2)));
  await browser.close();
  process.exit(1);
}

const row = await openCard(d, target.text);
ok('demo: the row prints the three most-used kinds, most-used first',
  row && JSON.stringify(row.chips) === JSON.stringify(target.top),
  JSON.stringify({ screen: row?.chips, cache: target.top }));
ok('demo: the names are one ellipsised line', row?.oneLine && row?.ellipsis, row?.names);
ok('demo: the chips overlap and wear the page ground as a ring',
  row && (row.chips.length < 2 || row.overlap >= 4) && row.ring === row.ground, JSON.stringify({ overlap: row?.overlap, ring: row?.ring, ground: row?.ground }));
ok('demo: the pill counts the same crowd the row names',
  row && row.pill.replace(/\D/g, '') === String(target.n), JSON.stringify({ pill: row?.pill, cache: target.n }));
ok('demo: the pill holds one icon, not a second mix', row && row.pillArt <= 1 && row.mixes === 0, JSON.stringify({ art: row?.pillArt, mixes: row?.mixes }));
ok('demo: the pill is a rounded pill', row && row.pillRadius >= 20, JSON.stringify({ radius: row?.pillRadius }));
await shot(d, 'react-demo-row');

// The pill answers for the viewer alone: one tap moves the number by exactly one
// and flips what the cache holds for them.
const pillBox = await d.evaluate(t => {
  const card = [...document.querySelectorAll('article.post')].find(a => a.textContent.includes(t));
  const box = card.querySelector('.post-actions .reaction-trigger').getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}, target.text);
await d.mouse.click(pillBox.x, pillBox.y);
await sleep(800);
const afterTap = await d.evaluate(t => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const card = [...document.querySelectorAll('article.post')].find(a => a.textContent.includes(t));
  const post = db.posts.find(p => p.text.startsWith(t.slice(0, 20)));
  return {
    pill: card.querySelector('.post-actions .reaction-trigger').textContent.trim(),
    names: card.querySelector('.reaction-summary .reaction-names').textContent.trim(),
    mine: db.reactions.some(r => r.uid === db.meId && r.targetType === 'post' && r.targetId === post.id),
  };
}, target.text);
const expected = target.mine ? target.n - 1 : target.n + 1;
ok('demo: a tap moves the number by one and flips what the cache holds',
  afterTap.mine !== target.mine && afterTap.pill.replace(/\D/g, '') === String(expected),
  JSON.stringify({ before: target.n, after: afterTap.pill, mine: afterTap.mine }));
ok('demo: the names lead with "You" exactly when the reader has reacted',
  afterTap.mine === /^You[, ]/.test(afterTap.names), afterTap.names);

// A hold opens the tray, and releasing on an emoji chooses it.
await d.mouse.move(pillBox.x, pillBox.y);
await d.mouse.down();
await sleep(240);
ok('demo: a short hold does not open the tray', (await count(d, '.reaction-tray')) === 0, '0 tray at 240ms');
await sleep(320);
const trayKinds = await d.evaluate(() => [...document.querySelectorAll('.reaction-tray button')].map(b => b.getAttribute('aria-label')));
ok('demo: holding opens the picker with the five kinds', trayKinds.length === 5, trayKinds.join('/'));
const loveAt = await d.evaluate(() => {
  const box = document.querySelectorAll('.reaction-tray button')[1].getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
});
await d.mouse.move(loveAt.x, loveAt.y);
await d.mouse.up();
await sleep(800);
const chose = await d.evaluate(t => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const card = [...document.querySelectorAll('article.post')].find(a => a.textContent.includes(t));
  const post = db.posts.find(p => p.text.startsWith(t.slice(0, 20)));
  const mine = db.reactions.filter(r => r.uid === db.meId && r.targetType === 'post' && r.targetId === post.id);
  return { mine: mine.map(m => m.kind), art: card.querySelector('.post-actions .reaction-trigger .reaction-art')?.getAttribute('data-kind'), pill: card.querySelector('.post-actions .reaction-trigger').textContent.trim(), tray: !!document.querySelector('.reaction-tray') };
}, target.text);
ok('demo: releasing on an emoji chooses it and puts the tray away',
  chose.mine.length === 1 && chose.mine[0] === 'love' && chose.art === 'love' && !chose.tray, JSON.stringify(chose));
await d.mouse.click(pillBox.x, pillBox.y);
await sleep(700);
const undone = await d.evaluate(t => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const post = db.posts.find(p => p.text.startsWith(t.slice(0, 20)));
  return db.reactions.filter(r => r.uid === db.meId && r.targetType === 'post' && r.targetId === post.id).length;
}, target.text);
ok('demo: a tap on the reaction the reader already chose takes it off', undone === 0, `${undone} rows left`);

// The sheet behind the row.
await d.evaluate(t => {
  const card = [...document.querySelectorAll('article.post')].find(a => a.textContent.includes(t));
  card.querySelector('.reaction-summary').click();
}, target.text);
await d.waitForSelector('.reactors-sheet', { timeout: 8000 });
await sleep(700);
const first = await sheetState(d);
const live = await cacheNumbers(d, target.id);
const expectedTabs = ['all', ...FB_ORDER.filter(k => (live.kinds[k] || 0) > 0)];
const firstPage = Math.min(12, live.people);
ok('demo: the tabs are All plus one per kind, each with its count',
  first.tabs[0] === `All${live.people}` && first.tabs.length === expectedTabs.length && first.rows === firstPage, JSON.stringify({ tabs: first.tabs, rows: first.rows, people: live.people }));
ok('demo: every row has a name, its reaction and a Follow button',
  first.names.length === first.rows && first.kinds.length === first.rows && first.follows >= first.rows - 1,
  JSON.stringify({ rows: first.rows, follows: first.follows }));
ok('demo: on a desk the list is a centered dialog, not a sheet',
  first.x > 100 && first.w < first.sheetWidth - 100, JSON.stringify({ x: first.x, w: first.w }));
await shot(d, 'react-demo-sheet');

// Paging walks the cache to the end without printing a person twice.
let seen = first;
for (let i = 0; i < 8 && seen.rows < live.people; i += 1) {
  await d.evaluate(() => {
    const list = document.querySelector('.reactors-list');
    list.scrollTop = list.scrollHeight;
  });
  await sleep(500);
  seen = await sheetState(d);
}
const unique = new Set(seen.names).size;
ok('demo: the list pages to the end of the crowd without repeats',
  seen.rows >= live.people && unique === seen.rows, JSON.stringify({ rows: seen.rows, unique, people: live.people }));

// A tab filters to that kind.
await d.evaluate(() => document.querySelectorAll('.reactors-tabs button')[1].click());
await sleep(700);
const tabbed = await sheetState(d);
ok('demo: a tab shows that reaction and nothing else',
  tabbed.rows > 0 && tabbed.kinds.every(k => k === tabbed.kinds[0]), JSON.stringify({ kinds: [...new Set(tabbed.kinds)], rows: tabbed.rows }));

// Follow pressed inside the list lands in the cache — and the row that pressed
// it is the row that must answer, not whichever button happens to be first.
const followTarget = await d.evaluate(() => {
  const btn = [...document.querySelectorAll('.reactor-row .follow-btn')].find(b => b.textContent.trim().toLowerCase() === 'follow');
  if (!btn) return null;
  const row = btn.closest('.reactor-row');
  const name = row.querySelector('.people-meta b').textContent.trim();
  btn.click();
  return { name };
});
await sleep(900);
const followed = await d.evaluate(name => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const row = [...document.querySelectorAll('.reactor-row')].find(r => r.querySelector('.people-meta b')?.textContent.trim() === name);
  const user = db.users.find(u => (u.name || u.username) === name);
  return {
    label: row?.querySelector('.follow-btn')?.textContent.trim(),
    stored: db.follows.some(f => f.follower === db.meId && f.following === user?.id && f.status === 'accepted'),
  };
}, followTarget?.name);
ok('demo: a Follow pressed in the list lands there and then',
  followTarget && followed.stored && followed.label !== 'Follow', JSON.stringify({ name: followTarget?.name, after: followed.label, stored: followed.stored }));
await d.keyboard.press('Escape');
await sleep(600);
ok('demo: Escape puts the list away', (await count(d, '.reactors-sheet')) === 0);

// ================= MOBILE =================
const m = await newPage({ width: 390, height: 844 }, true);
await goto(m, '/');
const mRow = await openCard(m, target.text);
ok('demo: a phone prints the same row above its buttons',
  mRow && mRow.chips.length > 0 && mRow.pillArt <= 1 && mRow.mixes === 0 && mRow.names.length > 0,
  JSON.stringify({ chips: mRow?.chips, names: mRow?.names, pill: mRow?.pill }));
await m.evaluate(t => {
  const card = [...document.querySelectorAll('article.post')].find(a => a.textContent.includes(t));
  card.querySelector('.reaction-summary').click();
}, target.text);
await m.waitForSelector('.reactors-sheet', { timeout: 8000 });
await sleep(700);
const mSheet = await sheetState(m);
ok('demo: on a phone it is a sheet the width of the screen, on its bottom edge',
  mSheet.x === 0 && mSheet.w === mSheet.sheetWidth && mSheet.bottom === 0 && mSheet.rows === firstPage,
  JSON.stringify({ x: mSheet.x, w: mSheet.w, bottom: mSheet.bottom, rows: mSheet.rows }));
await shot(m, 'react-demo-mobile-sheet');
let mSeen = mSheet;
for (let i = 0; i < 8 && mSeen.rows < live.people; i += 1) {
  await m.evaluate(() => {
    const list = document.querySelector('.reactors-list');
    list.scrollTop = list.scrollHeight;
  });
  await sleep(500);
  mSeen = await sheetState(m);
}
ok('demo: the sheet pages on a phone too',
  mSeen.rows >= Math.min(live.people, 24) && new Set(mSeen.names).size === mSeen.rows,
  JSON.stringify({ rows: mSeen.rows, unique: new Set(mSeen.names).size }));
await m.evaluate(() => document.querySelector('.reactors-overlay').click());
await sleep(600);
ok('demo: a tap above the sheet puts it away', (await count(m, '.reactors-sheet')) === 0);

ok('demo: no console or HTTP errors during the run', errors.length === 0, errors.slice(0, 4).join(' | '));

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} demo reaction checks green.`);
await retryWrite(() => writeFileSync(`${OUT}/reactions-demo-results.json`, JSON.stringify({ target, results, errors: [...new Set(errors)] }, null, 2)));
await browser.close();
process.exit(failed.length ? 1 : 0);
