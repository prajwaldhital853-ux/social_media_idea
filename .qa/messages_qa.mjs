/**
 * Messages QA: the four behaviours the messenger owes its users.
 *
 *  1. a mutual follow heads the inbox, and a first message opens its row
 *  2. delivery rides the event stream (in SSE mode the API refuses the socket's
 *     origin, which is exactly what a proxy that flattens the upgrade does in
 *     production — the 5s poll is the only thing left, so a sub-3s answer proves
 *     the stream carried it)
 *  3. no bell while both readers watch, one bell when one of them leaves, and
 *     opening the thread directly reads that bell
 *  4. a button inside the top-right popover acts instead of dismissing it
 *
 * Two Chrome instances, one per account: a page that shares a browser with the
 * other can be reported hidden, and a hidden tab closes its streams by design.
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.QA_BASE || 'http://127.0.0.1:3001';
const OUT = process.env.QA_OUT || 'D:/social_medial-wt/agent-b/.qa';
const MODE = (process.env.MODE || 'sse').toLowerCase();
const PASS = 'exposing-demo-1';
const A = { email: 'kiran@demo.test', user: 'kiran' };
const B = { email: 'ujjwal@demo.test', user: 'ujjwal' };
// An inbox row carries the person's name, not their handle — that is what the
// product shows, so that is what the harness has to find.
const PEER = 'Ujjwal';
const ME_B = 'Kiran';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, pass, detail = '') => {
  results.push(!!pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  return !!pass;
};

async function launch() {
  const browser = await puppeteer.launch({
    executablePath: EXE, headless: 'new',
    args: ['--no-sandbox', '--lang=en-US', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  // Count the handshakes the app really attempts, so the retry cap is readable.
  await page.evaluateOnNewDocument(() => {
    const Native = window.WebSocket;
    const counts = { attempts: 0 };
    window.__ws = counts;
    const Wrapped = function (url, protocols) {
      if (String(url).includes('/ws/')) counts.attempts += 1;
      return protocols === undefined ? new Native(url) : new Native(url, protocols);
    };
    Wrapped.prototype = Native.prototype;
    Object.getOwnPropertyNames(Native).forEach(key => {
      if (key === 'prototype' || key === 'length' || key === 'name') return;
      try { Wrapped[key] = Native[key]; } catch { /* a read-only static */ }
    });
    window.WebSocket = Wrapped;
  });
  return { browser, page };
}

const goto = (page, path) => page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
const unread = page => page.evaluate(async () => {
  const r = await fetch('/api/notifications/unread/', { headers: { accept: 'application/json' } });
  return r.json();
});
const pathOf = page => page.evaluate(() => location.pathname);
/** The session arrives a beat after the page does; a panel opened before it is
 *  the signed-out panel. */
const signedIn = page => page.waitForFunction(() => !document.querySelector('.topbar-auth'), { timeout: 25000 });

/** A click a finger would send: pointerdown included, at the element's own box. */
async function realClick(page, scope, needle) {
  const found = await page.evaluate(([s, n]) => {
    const el = [...document.querySelectorAll(s)].find(row => (row.textContent || '').includes(n));
    if (!el) return false;
    el.setAttribute('data-qa-target', '1');
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    return true;
  }, [scope, needle]);
  if (!found) throw new Error(`nothing matching "${needle}" under ${scope}`);
  await sleep(150);
  const box = await page.evaluate(() => {
    const el = document.querySelector('[data-qa-target="1"]');
    const r = el.getBoundingClientRect();
    const point = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, hit: !!point && el.contains(point) };
  });
  await page.evaluate(() => document.querySelector('[data-qa-target]')?.removeAttribute('data-qa-target'));
  if (!box.hit) throw new Error(`the middle of "${needle}" is covered by something else`);
  await page.mouse.click(box.x, box.y);
  await sleep(350);
}

async function signOut(page) {
  await goto(page, '/settings');
  await page.waitForSelector('.settings-logout', { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => document.querySelector('.settings-logout')?.click());
  await page.waitForFunction(() => location.pathname === '/login', { timeout: 15000 }).catch(() => {});
  await sleep(500);
}

async function signIn(page, account) {
  await goto(page, '/login');
  if (!(await page.$('.login-content'))) { await signOut(page); await goto(page, '/login'); }
  await page.evaluate(([email, pass]) => {
    const set = (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const inputs = [...document.querySelectorAll('.login-content input.login-input')];
    set(inputs[0], email);
    set(inputs[1], pass);
    document.querySelector('.login-content form button.login-submit')?.click();
  }, [account.email, PASS]);
  await page.waitForFunction(() => location.pathname === '/' || !!document.querySelector('.auth-code'), { timeout: 30000 });
  if ((await page.evaluate(() => document.querySelector('.auth-code-title')?.textContent?.trim())) === 'Confirm it is you') {
    await page.evaluate(() => document.querySelector('.auth-code-dev')?.click());
    await page.waitForFunction(() => location.pathname === '/', { timeout: 20000 });
  }
  await sleep(900);
}

const rowTexts = page => page.evaluate(() => ({
  band: [...document.querySelectorAll('.inbox-suggested .inbox-row')].map(r => (r.textContent || '').replace(/\s+/g, ' ').trim()),
  threads: [...document.querySelectorAll('.inbox-column > .inbox-list .inbox-row')].map(r => (r.textContent || '').replace(/\s+/g, ' ').trim()),
}));

const sendFromCompose = async (page, text) => {
  await page.waitForSelector('.chat-compose input', { timeout: 15000 });
  await page.evaluate(t => {
    const input = document.querySelector('.chat-compose input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, t);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.chat-compose button.chat-send')?.click();
  }, text);
};

/** Milliseconds until one of the reader's bubbles carries the text, or -1. */
const seeBubble = async (page, needle, ms) => {
  const t0 = Date.now();
  try {
    await page.waitForFunction(n => [...document.querySelectorAll('.chat-bubble')]
      .some(b => (b.textContent || '').includes(n)), { timeout: ms, polling: 100 }, needle);
    return Date.now() - t0;
  } catch {
    return -1;
  }
};

const bellBadge = page => page.evaluate(() => document
  .querySelector('button[aria-label="Notifications"] .topbar-badge')?.textContent?.trim() || '');

const openTray = async page => {
  await signedIn(page);
  await realClick(page, 'button[aria-label="Notifications"]', '');
  await page.waitForSelector('.topbar-panel .panel-body', { timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector('.panel-loading'), { timeout: 10000 }).catch(() => {});
};

(async () => {
  const chromeA = await launch();
  const chromeB = await launch();
  const a = chromeA.page;
  const b = chromeB.page;
  const pages = { a, b };
  try {
    await signIn(a, A);
    await signIn(b, B);

    // ---------- 1. the mutual band leads the column ----------------------
    await goto(a, '/messages');
    await a.waitForFunction(() => !!document.querySelector('.inbox-row'), { timeout: 25000 });
    await sleep(1200);
    const first = await rowTexts(a);
    ok('two people who follow each other head the inbox',
      first.band.some(r => r.includes(PEER)) && !first.threads.some(r => r.includes(PEER)),
      `band=[${first.band.join(' | ')}]`);
    ok('the band says what it is', await a.evaluate(() =>
      /following each other/i.test(document.querySelector('.inbox-band-label')?.textContent || '')));
    ok('the band sits above the threads', await a.evaluate(() => {
      const band = document.querySelector('.inbox-suggested');
      const threads = document.querySelector('.inbox-column > .inbox-list');
      return !!band && !!threads
        && !!(band.compareDocumentPosition(threads) & Node.DOCUMENT_POSITION_FOLLOWING);
    }));

    // ---------- 4. a button inside the popover acts ----------------------
    await goto(a, '/');
    await signedIn(a);
    await a.waitForSelector('button[aria-label="Messages"]', { timeout: 20000 });
    await realClick(a, 'button[aria-label="Messages"]', '');
    await a.waitForSelector('.topbar-panel', { timeout: 10000 });
    await realClick(a, '.topbar-panel button[aria-label="New message"]', '');
    await a.waitForSelector('.people-modal', { timeout: 10000 });
    await realClick(a, '.people-search input', '');
    const pickerAlive = await a.evaluate(() => ({
      panel: !!document.querySelector('.topbar-panel'),
      picker: !!document.querySelector('.people-modal'),
      typing: document.activeElement === document.querySelector('.people-search input'),
    }));
    ok('opening the picker leaves the popover standing', pickerAlive.panel && pickerAlive.picker,
      JSON.stringify(pickerAlive));
    await a.type('.people-search input', B.user);
    await a.waitForFunction(n => [...document.querySelectorAll('.people-pick')]
      .some(r => (r.textContent || '').includes(n)), { timeout: 10000 }, `@${B.user}`);
    await realClick(a, '.people-pick', `@${B.user}`);
    await a.waitForFunction(p => location.pathname === p, { timeout: 15000 }, `/messages/${B.user}`);
    ok('the press lands: the picker opens that thread', (await pathOf(a)) === `/messages/${B.user}`, await pathOf(a));

    // ---------- 1b. a first message opens the row on both columns ----------
    // Park the receiver on their messages screen first: the row has to appear
    // there while they stand looking at it, which is the case the report named.
    await goto(b, '/messages');
    await b.waitForFunction(n => [...document.querySelectorAll('.inbox-suggested .inbox-row')]
      .some(r => (r.textContent || '').includes(n)), { timeout: 25000 }, ME_B);
    const hello = `first hello ${Date.now()}`;
    await sendFromCompose(a, hello);
    await a.waitForFunction(n => [...document.querySelectorAll('.chat-bubble.mine')]
      .some(bubble => (bubble.textContent || '').includes(n)), { timeout: 10000 }, hello);
    await sleep(1600);
    const afterSend = await rowTexts(a);
    const mine = afterSend.threads.find(r => r.includes(PEER)) || '';
    ok('a first message opens a row in the sender’s own inbox', !!mine, mine || `threads=[${afterSend.threads.join(' | ')}]`);
    ok('and that row already previews it', mine.includes(hello), mine);
    ok('the peer leaves the band now that there is a thread', !afterSend.band.some(r => r.includes(PEER)),
      `band=[${afterSend.band.join(' | ')}]`);

    // The other side of the same event: this column never held the conversation,
    // because the conversation did not exist when it was read. The bell that
    // announces it has to write the row into the list that is on screen.
    let bRows = await rowTexts(b);
    for (let i = 0; i < 15 && !bRows.threads.some(r => r.includes(ME_B)); i += 1) {
      await sleep(700);
      bRows = await rowTexts(b);
    }
    const bThread = bRows.threads.find(r => r.includes(ME_B)) || '';
    ok('the receiver’s column grows the row without a reload', !!bThread,
      bThread || `threads=[${bRows.threads.join(' | ')}] band=[${bRows.band.join(' | ')}]`);
    ok('and their band lets the peer go', !bRows.band.some(r => r.includes(ME_B)),
      `band=[${bRows.band.join(' | ')}]`);

    // ---------- 2. delivery with the socket refused ----------------------
    await goto(b, `/messages/${A.user}`);
    await b.waitForSelector('.chat-compose input', { timeout: 25000 });
    await sleep(2500);
    const stamp = `over the wire ${Date.now()}`;
    await sendFromCompose(a, stamp);
    const ms = await seeBubble(b, stamp, 12000);
    ok(`the peer reads it in under 3s with no socket (${MODE})`, ms >= 0 && ms < 3000,
      ms < 0 ? 'never arrived' : `${ms}ms`);

    const attempts = await a.evaluate(() => window.__ws.attempts);
    await sleep(10000);
    const held = await a.evaluate(() => window.__ws.attempts);
    ok('a refused socket stops trying instead of spamming the log', held <= 3 && held === attempts,
      `attempts=${attempts} then ${held}`);

    // ---------- 3. bells are for people who are not here -----------------
    const whileWatching = await unread(b);
    ok('no bell rings for a thread both are reading', (Number(whileWatching.unread) || 0) === 0,
      JSON.stringify(whileWatching));

    // typing rides the same wire
    await goto(a, `/messages/${B.user}`);
    await a.waitForSelector('.chat-compose input', { timeout: 20000 });
    await sleep(2000);
    let typingSeen = false;
    for (let i = 0; i < 8 && !typingSeen; i += 1) {
      await a.type('.chat-compose input', 'h');
      await sleep(500);
      typingSeen = await b.evaluate(() => !!document.querySelector('.chat-typing'));
    }
    ok('a keystroke shows up as typing on the peer’s screen', typingSeen);

    // one of them leaves, then a message is news
    await goto(b, '/');
    await sleep(1600);
    const away = `while you were out ${Date.now()}`;
    await sendFromCompose(a, away);
    let rang = null;
    const endBell = Date.now() + 15000;
    while (Date.now() < endBell) {
      rang = await unread(b);
      if ((Number(rang.unread) || 0) > 0) break;
      await sleep(700);
    }
    ok('a bell rings when the reader has left', !!rang && (Number(rang.unread) || 0) > 0, JSON.stringify(rang));
    let trayBadge = '';
    for (let i = 0; i < 12 && !trayBadge; i += 1) {
      trayBadge = await bellBadge(b);
      if (!trayBadge) await sleep(700);
    }
    ok('the tray counts it live, without a reload', trayBadge !== '', `badge=${trayBadge}`);
    const bellRow = await b.evaluate(async () => {
      const r = await fetch('/api/notifications/?unread=1');
      return ((await r.json()).results || []).find(n => n.kind === 'message') || null;
    });
    ok('the bell names its sender', !!bellRow && bellRow.actor_username === A.user, JSON.stringify(bellRow || {}));

    // ---------- 3b. opening the thread reads the bell it came for --------
    await goto(b, `/messages/${A.user}`);
    const sawAway = await seeBubble(b, away, 10000);
    ok('the message is in the thread', sawAway >= 0, sawAway < 0 ? 'missing' : `${sawAway}ms`);
    await sleep(2200);
    const afterOpen = await unread(b);
    ok('opening the thread without the tray reads its bell', (Number(afterOpen.unread) || 0) === 0,
      JSON.stringify(afterOpen));
    ok('and the tray badge drops with it', (await bellBadge(b)) === '', `badge=${await bellBadge(b)}`);
    await openTray(b);
    const tray = await b.evaluate(() => {
      const groups = [...document.querySelectorAll('.panel-group')];
      const fresh = groups.find(g => /new/i.test(g.querySelector('.panel-group-label')?.textContent || ''));
      return (fresh?.textContent || '').replace(/\s+/g, ' ').trim();
    });
    ok('the read bell is out of the tray’s New group', !/sent you a message/i.test(tray), tray);
    await b.keyboard.press('Escape');
    await sleep(400);

    // ---------- 3c. and a live bell still walks into the thread ----------
    await goto(b, '/');
    await sleep(1600);
    const through = `answer me through the tray ${Date.now()}`;
    await sendFromCompose(a, through);
    const endSecond = Date.now() + 15000;
    while (Date.now() < endSecond) {
      if ((Number((await unread(b)).unread) || 0) > 0) break;
      await sleep(700);
    }
    await openTray(b);
    await realClick(b, '.notif-list button', 'sent you a message');
    await b.waitForFunction(p => location.pathname === p, { timeout: 15000 }, `/messages/${A.user}`);
    ok('the bell opens the thread, not the profile', (await pathOf(b)) === `/messages/${A.user}`, await pathOf(b));
    ok('and the message it announced is waiting there', (await seeBubble(b, through, 8000)) >= 0);

    fs.writeFileSync(`${OUT}/messages-qa-${MODE}-results.json`, JSON.stringify({ mode: MODE, results }, null, 2));
  } catch (err) {
    ok('harness completed', false, String((err && err.message) || err));
    for (const [name, page] of Object.entries(pages)) {
      await page.screenshot({ path: `${OUT}/messages-qa-${MODE}-${name}-error.png` }).catch(() => {});
    }
  } finally {
    await chromeA.browser.close();
    await chromeB.browser.close();
  }
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks green (MODE=${MODE})`);
  process.exit(failed ? 1 : 0);
})();
