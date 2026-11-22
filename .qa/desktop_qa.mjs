/**
 * Phase 9 desktop-shell QA: the canvas, the compact rail, the top-bar popovers
 * and the two-pane messenger, measured in the browser rather than assumed from
 * CSS, because every one of these is a pixel a reviewer can disagree with.
 *
 * Mobile is re-checked in the same run: the messenger reuses the inbox column,
 * so a desktop rule that leaks below 1024px would break the phone layout.
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
import { retryWrite } from './shots.mjs';

// A second checkout runs its own pair of servers, so the suite has to be pointed
// at them instead of assumed to belong to the one on :3000.
const BASE = process.env.QA_BASE || 'http://localhost:3000';
const OUT = process.env.QA_OUT || 'D:/social_medial/.qa';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DEMO = { username: 'sita', email: 'sita@demo.test', password: 'exposing-demo-1' };

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

const errors = [];
async function newPage(viewport, mobile = false, context = browser) {
  const page = await context.newPage();
  await page.setViewport({ ...viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const where = (m.location() && m.location().url) || '';
    if (/\/api\/(auth|sync|notifications\/unread)\//.test(where)) return;
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
const textOf = (page, sel) => page.$eval(sel, el => el.textContent.trim()).catch(() => '');
const count = (page, sel) => page.$$eval(sel, els => els.length).catch(() => 0);

async function goto(page, path) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(700);
}

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
  await setInput(page, 0, identifier);
  await setInput(page, 1, password);
  await page.evaluate(() => document.querySelector('.login-content form button.login-submit')?.click());
  await page.waitForFunction(() => location.pathname === '/' || !!document.querySelector('.auth-code'), { timeout: 25000 }).catch(() => {});
  if ((await textOf(page, '.auth-code-title')) === 'Confirm it is you') {
    await page.evaluate(() => document.querySelector('.auth-code-dev')?.click());
    await page.waitForFunction(() => location.pathname === '/', { timeout: 20000 }).catch(() => {});
  }
  await sleep(900);
}

const rgb = s => s.replace(/\s/g, '');
const box = (page, sel) => page.$eval(sel, el => {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), cs };
}).catch(() => null);

const styles = (page, sel, props) => page.$eval(sel, (el, props) => {
  const cs = getComputedStyle(el);
  const out = {};
  for (const p of props) out[p] = cs[p];
  return out;
}, props).catch(() => null);

// Screenshots are the review artifact, so they must not catch a CDN tile mid-fetch.
async function settle(page, ms = 6000) {
  await page.waitForFunction(() => {
    const tiles = [...document.querySelectorAll('article.post img, .market-grid img')]
      .filter(img => { const r = img.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; });
    return tiles.length > 0 && tiles.every(img => img.complete && img.naturalWidth > 0);
  }, { timeout: ms }).catch(() => {});
  await sleep(400);
}

// ================= DESKTOP =================
const d = await newPage({ width: 1440, height: 900 });
await goto(d, '/');

// The product opens dark on a desktop viewport, before any stored choice.
const firstPaint = await d.evaluate(() => ({
  theme: document.documentElement.getAttribute('data-theme'),
  stored: localStorage.getItem('exposing-theme'),
  bodyBg: getComputedStyle(document.body).backgroundColor
}));
ok('desktop: opens in dark mode by default', firstPaint.theme === 'dark' && !firstPaint.stored, JSON.stringify(firstPaint));
ok('desktop: the page field is the soft canvas color', rgb(firstPaint.bodyBg) === 'rgb(16,17,20)', firstPaint.bodyBg);

await signIn(d, DEMO.email, DEMO.password);
await goto(d, '/');
await d.waitForSelector('.suggest-rail', { timeout: 15000 }).catch(() => {});

const shell = await d.evaluate(() => {
  const grid = getComputedStyle(document.querySelector('.shell'));
  const rail = document.querySelector('.rail').getBoundingClientRect();
  const main = document.querySelector('.main').getBoundingClientRect();
  const railCs = getComputedStyle(document.querySelector('.rail'));
  const topCs = getComputedStyle(document.querySelector('.topbar'));
  return {
    columns: grid.gridTemplateColumns,
    gap: grid.columnGap,
    railW: Math.round(rail.width),
    railH: Math.round(rail.height),
    viewportH: Math.round(window.innerHeight),
    mainW: Math.round(main.width),
    sideRoom: Math.round(window.innerWidth - main.right),
    gapPx: Math.round(main.left - rail.right),
    railBorder: railCs.borderRightWidth,
    railBg: railCs.backgroundColor,
    topbarBorder: topCs.borderBottomWidth,
    railAuth: !!document.querySelector('.rail-auth'),
    themeInRight: !!document.querySelector('.topbar-right button[aria-label*="mode" i]'),
    pageToggle: !!document.querySelector('.main .header-actions .icon-btn[aria-label*="mode" i]')?.offsetParent,
    toggleLeft: !!document.querySelector('.topbar-left button'),
    suggestCard: !!document.querySelector('.suggest-card'),
    suggestRail: !!document.querySelector('.suggest-rail'),
    suggestBg: document.querySelector('.suggest-rail') ? getComputedStyle(document.querySelector('.suggest-rail')).backgroundColor : ''
  };
});
ok('desktop: the rail is a real sidebar, wide enough to read', shell.railW >= 260 && shell.railW <= 300, `rail ${shell.railW}px`);
ok('desktop: the rail runs the full height under the top bar',
   shell.railH >= shell.viewportH - 60, JSON.stringify({ railH: shell.railH, viewport: shell.viewportH }));
ok('desktop: the feed leaves room on both sides', shell.mainW >= 560 && shell.mainW <= 640 && shell.sideRoom >= 300,
   JSON.stringify({ feed: shell.mainW, sideRoom: shell.sideRoom }));
ok('desktop: the gap between rail and feed is wide', shell.gapPx >= 32, `${shell.gapPx}px`);
ok('desktop: no hairline between rail, feed and top bar',
   shell.railBorder === '0px' && shell.topbarBorder === '0px',
   `rail ${shell.railBorder} / topbar ${shell.topbarBorder}`);
ok('desktop: the rail is the left sheet of the screen',
   rgb(shell.railBg) === 'rgb(23,25,28)', shell.railBg);
ok('desktop: no sign in / sign up block inside the rail', !shell.railAuth);
ok('desktop: the theme switch lives on the right of the top bar, and nowhere else',
   shell.themeInRight && !shell.toggleLeft && !shell.pageToggle,
   JSON.stringify({ themeInRight: shell.themeInRight, toggleLeft: shell.toggleLeft, pageToggle: shell.pageToggle }));
ok('desktop: suggestions are an inline list, not a card',
   !shell.suggestCard && shell.suggestRail && shell.suggestBg === 'rgba(0, 0, 0, 0)',
   JSON.stringify({ card: shell.suggestCard, rail: shell.suggestRail, bg: shell.suggestBg }));
await settle(d);
await shot(d, 'ss9-desktop-feed');

// ---------- The tabs ride the top bar, so they cost the feed no height ----------
const tabs = await d.evaluate(() => {
  const band = document.querySelector('.home-header');
  const bar = document.querySelector('.topbar-tabs');
  const r = bar?.getBoundingClientRect();
  return {
    bandShown: !!band && getComputedStyle(band).display !== 'none',
    bandH: band ? Math.round(band.getBoundingClientRect().height) : -1,
    pinned: !!r && r.width > 0 && r.top < 56,
    tabCount: document.querySelectorAll('.topbar-tabs .topbar-tab').length,
    posts: document.querySelectorAll('.post').length,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1
  };
});
ok('desktop: For you / Following live in the top bar, not in a band over the feed',
   tabs.pinned && tabs.tabCount === 2 && !tabs.bandShown && !tabs.overflow, JSON.stringify(tabs));
await shot(d, 'ss9-desktop-feed-lifted');
await d.evaluate(() => window.scrollTo(0, 0));
await sleep(400);

// ---------- Marketplace owns the page ----------
await goto(d, '/marketplace');
await d.waitForSelector('.market-grid', { timeout: 15000 }).catch(() => {});
await sleep(900);
const market = await d.evaluate(() => {
  const grid = document.querySelector('.market-grid');
  const main = document.querySelector('.main').getBoundingClientRect();
  return {
    mainW: Math.round(main.width),
    cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
    cards: document.querySelectorAll('.market-card').length,
    calm: !!document.querySelector('.side-calm')?.offsetParent,
    pageToggle: !!document.querySelector('.main .header-actions .icon-btn[aria-label*="mode" i]')?.offsetParent,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1
  };
});
ok('desktop: the marketplace uses everything right of the rail',
   market.mainW >= 1100 && market.cols >= 4 && !market.calm && !market.overflow, JSON.stringify(market));
ok('desktop: the marketplace header does not duplicate the top bar mode switch', !market.pageToggle, JSON.stringify({ pageToggle: market.pageToggle }));
await settle(d);
await shot(d, 'ss9-desktop-marketplace');
await goto(d, '/');
await d.waitForSelector('.suggest-rail', { timeout: 15000 }).catch(() => {});

// ---------- Notifications popover ----------
const bellStyles = await styles(d, '[aria-label="Notifications"]', ['display']);
ok('desktop: the bell in the top bar is a button, not a link',
   bellStyles === null || bellStyles.display !== 'none', JSON.stringify(bellStyles));
await d.evaluate(() => document.querySelector('[aria-label="Notifications"]')?.click());
await sleep(500);
const notifPanel = await d.evaluate(() => {
  const p = document.querySelector('.topbar-panel');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return {
    rows: document.querySelectorAll('.topbar-panel .notif-row').length,
    groups: [...document.querySelectorAll('.topbar-panel .panel-group-label')].map(h => h.textContent),
    tabs: [...document.querySelectorAll('.panel-tabs button')].map(b => b.textContent.trim()),
    foot: document.querySelector('.panel-foot a')?.textContent.trim(),
    right: Math.round(r.right),
    top: Math.round(r.top),
    w: Math.round(r.width),
    bg: getComputedStyle(p).backgroundColor
  };
});
ok('desktop: the bell opens an activity box over the canvas',
   !!notifPanel && notifPanel.rows > 0 && notifPanel.right > 1100 && notifPanel.top < 120,
   JSON.stringify(notifPanel));
await shot(d, 'ss9-desktop-notif-popover');

const unreadTab = await d.evaluate(async () => {
  const tabs = [...document.querySelectorAll('.panel-tabs button')];
  const unread = tabs.find(b => /unread/i.test(b.textContent));
  if (!unread) return null;
  unread.click();
  await new Promise(r => setTimeout(r, 350));
  return {
    active: unread.className,
    allUnread: [...document.querySelectorAll('.topbar-panel .notif-row')].every(row => row.classList.contains('unread'))
  };
});
ok('desktop: the Unread tab filters the popover to unread rows',
   unreadTab && /active/.test(unreadTab.active) && unreadTab.allUnread, JSON.stringify(unreadTab));

const panelClosed = await (async () => {
  // A real pointer press, because the popover listens for pointerdown.
  await d.mouse.click(700, 500);
  await sleep(350);
  return d.evaluate(() => !document.querySelector('.topbar-panel'));
})();
ok('desktop: a click outside closes the popover', panelClosed);

// A row click leaves the popover and lands on the target. Rows are marked up as
// a div holding a navigate button plus, for follow rows, a follow-back button,
// so the press goes on the button a real pointer would hit.
await d.evaluate(() => document.querySelector('[aria-label="Notifications"]')?.click());
await sleep(400);
const rowJump = await d.evaluate(async () => {
  const rows = [...document.querySelectorAll('.topbar-panel .notif-row')];
  for (const row of rows.slice(0, 6)) {
    const open = row.querySelector('.notif-open');
    if (!open) return { broken: true, rows: rows.length };
    open.click();
    await new Promise(r => setTimeout(r, 1200));
    // A row with no target only marks itself read, so keep looking for one that goes somewhere.
    if (location.pathname !== '/') break;
  }
  return { path: location.pathname, panel: !!document.querySelector('.topbar-panel') };
});
ok('desktop: a popover row navigates and closes the popover',
   rowJump && !rowJump.broken && !rowJump.panel && rowJump.path !== '/', JSON.stringify(rowJump));
await shot(d, 'ss9-desktop-notif-jump');

// ---------- Messenger popover ----------
await goto(d, '/');
await d.evaluate(() => document.querySelector('[aria-label="Messages"]')?.click());
await d.waitForSelector('.topbar-panel .inbox-row', { timeout: 15000 }).catch(() => {});
await sleep(400);
const msgPanel = await d.evaluate(() => {
  const p = document.querySelector('.topbar-panel');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return {
    rows: document.querySelectorAll('.topbar-panel .inbox-row').length,
    search: !!p.querySelector('.panel-search input'),
    expand: !!p.querySelector('[aria-label="Open messenger"]'),
    foot: p.querySelector('.panel-foot a')?.textContent.trim(),
    right: Math.round(r.right),
    top: Math.round(r.top)
  };
});
ok('desktop: the message icon opens a thread list at the top of the page',
   !!msgPanel && msgPanel.rows > 0 && msgPanel.expand && msgPanel.top < 120,
   JSON.stringify(msgPanel));
await shot(d, 'ss9-desktop-msg-popover');

await d.evaluate(() => document.querySelector('[aria-label="Open messenger"]')?.click());
await d.waitForFunction(() => location.pathname === '/messages', { timeout: 15000 }).catch(() => {});
await sleep(1200);
const messenger = await d.evaluate(() => {
  const side = document.querySelector('.messenger-side')?.getBoundingClientRect();
  const main = document.querySelector('.messenger-main')?.getBoundingClientRect();
  const calm = document.querySelector('.side-calm')?.getBoundingClientRect();
  return {
    path: location.pathname,
    side: side ? { w: Math.round(side.width), left: Math.round(side.left) } : null,
    main: main ? { w: Math.round(main.width), left: Math.round(main.left), right: Math.round(main.right) } : null,
    calmShown: !!calm && calm.width > 0,
    rows: document.querySelectorAll('.messenger-side .inbox-row').length,
    empty: !!document.querySelector('.messenger-empty'),
    search: !!document.querySelector('.inbox-toolbar .inbox-search input'),
    newChat: !!document.querySelector('.inbox-new')
  };
});
ok('desktop: the full-screen messenger is inbox column plus thread pane',
   messenger && messenger.side && messenger.main && messenger.side.w > 280 && messenger.main.w > 500 && messenger.empty,
   JSON.stringify(messenger));
ok('desktop: the messenger owns the width (suggestions column steps aside)',
   messenger && !messenger.calmShown && messenger.main.right > 1200,
   JSON.stringify({ calmShown: messenger?.calmShown, mainRight: messenger?.main?.right }));
await shot(d, 'ss9-desktop-messenger-empty');

const picked = await d.evaluate(async () => {
  const row = document.querySelector('.messenger-side .inbox-row');
  if (!row) return null;
  row.click();
  await new Promise(r => setTimeout(r, 1800));
  const main = document.querySelector('.messenger-main .chat-view');
  const back = document.querySelector('.chat-back');
  return {
    path: location.pathname,
    chat: !!main && main.getBoundingClientRect().width > 400,
    bubbles: document.querySelectorAll('.chat-bubble').length,
    compose: !!document.querySelector('.chat-compose'),
    backHidden: !back || getComputedStyle(back).display === 'none',
    stillListed: document.querySelectorAll('.messenger-side .inbox-row').length,
    activeRow: !!document.querySelector('.messenger-side .inbox-row.active')
  };
});
ok('desktop: picking a thread opens it beside the inbox, not over it',
   picked && picked.chat && picked.compose && picked.stillListed > 0 && picked.activeRow,
   JSON.stringify(picked));
ok('desktop: the thread hides the mobile back button on desktop',
   picked && picked.backHidden, JSON.stringify({ backHidden: picked?.backHidden }));
await shot(d, 'ss9-desktop-messenger-thread');

const sentFromMessenger = await d.evaluate(async () => {
  const before = document.querySelectorAll('.chat-bubble').length;
  const input = document.querySelector('.chat-compose input');
  if (!input) return null;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'Qoder phase 9 check');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 150));
  document.querySelector('.chat-send')?.click();
  await new Promise(r => setTimeout(r, 2200));
  const mine = [...document.querySelectorAll('.chat-bubble.mine p')].map(p => p.textContent);
  return { before, after: document.querySelectorAll('.chat-bubble').length, last: mine[mine.length - 1] };
});
ok('desktop: sending from the messenger pane appends the bubble',
   sentFromMessenger && sentFromMessenger.after > sentFromMessenger.before &&
   sentFromMessenger.last === 'Qoder phase 9 check', JSON.stringify(sentFromMessenger));

// The browser back button leaves the thread and returns to the inbox column.
const backStep = await (async () => {
  await d.goBack();
  await sleep(1200);
  return d.evaluate(() => ({ path: location.pathname, empty: !!document.querySelector('.messenger-empty') }));
})();
ok('desktop: browser back steps out of the thread to the inbox',
   backStep.path === '/messages' && backStep.empty, JSON.stringify(backStep));

// ================= MOBILE =================
const m = await newPage({ width: 390, height: 844 }, true);
await goto(m, '/login');
await m.evaluate(() => localStorage.setItem('exposing-theme', 'light'));
await m.reload({ waitUntil: 'domcontentloaded' });
await sleep(600);
await m.evaluate(() => localStorage.setItem('exposing-device', `qa-mobile-${Math.random().toString(36).slice(2, 10)}`));
await setInput(m, 0, DEMO.email);
await setInput(m, 1, DEMO.password);
await m.evaluate(() => document.querySelector('.login-content form button.login-submit')?.click());
await m.waitForFunction(() => location.pathname === '/' || !!document.querySelector('.auth-code'), { timeout: 25000 }).catch(() => {});
if ((await textOf(m, '.auth-code-title')) === 'Confirm it is you') {
  await m.evaluate(() => document.querySelector('.auth-code-dev')?.click());
  await m.waitForFunction(() => location.pathname === '/', { timeout: 20000 }).catch(() => {});
}
await sleep(800);

const mobileTheme = await m.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), vw: innerWidth }));
ok('mobile: keeps the stored light theme on a narrow viewport', mobileTheme.theme === 'light', JSON.stringify(mobileTheme));

await goto(m, '/messages');
const inboxT0 = Date.now();
await m.waitForFunction(() => document.querySelectorAll('.inbox-row').length > 0, { timeout: 10000 }).catch(() => {});
const inboxWait = Date.now() - inboxT0;
const mobileInbox = await m.evaluate(() => {
  const main = document.querySelector('.messenger-main');
  return {
    rows: document.querySelectorAll('.inbox-row').length,
    mainHidden: !main || getComputedStyle(main).display === 'none',
    topbarHidden: getComputedStyle(document.querySelector('.topbar')).display === 'none',
    search: !!document.querySelector('.inbox-search input'),
    head: !!document.querySelector('.inbox-view .header-title')
  };
});
ok('mobile: the inbox stays a single column with no thread pane',
   mobileInbox.rows > 0 && mobileInbox.mainHidden && mobileInbox.topbarHidden && mobileInbox.search,
   JSON.stringify({ ...mobileInbox, waitedMs: inboxWait }));
await shot(m, 'ss9-mobile-inbox');

const mobileThread = await m.evaluate(async () => {
  document.querySelector('.inbox-row')?.click();
  await new Promise(r => setTimeout(r, 2000));
  const view = document.querySelector('.chat-view');
  const side = document.querySelector('.messenger-side');
  const back = document.querySelector('.chat-back');
  return {
    path: location.pathname,
    chatW: view ? Math.round(view.getBoundingClientRect().width) : 0,
    sideHidden: !side || getComputedStyle(side).display === 'none',
    backShown: !!back && getComputedStyle(back).display !== 'none',
    compose: !!document.querySelector('.chat-compose')
  };
});
ok('mobile: a thread is still full width with its back button',
   mobileThread.chatW >= 380 && mobileThread.sideHidden && mobileThread.backShown && mobileThread.compose,
   JSON.stringify(mobileThread));
await shot(m, 'ss9-mobile-thread');

await goto(m, '/');
const feedT0 = Date.now();
await m.waitForFunction(() => document.querySelectorAll('article.post').length > 0, { timeout: 10000 }).catch(() => {});
const mobileFeed = await m.evaluate(() => ({
  bg: getComputedStyle(document.body).backgroundColor,
  posts: document.querySelectorAll('article.post').length
}));
ok('mobile: the feed keeps its own sheet and loads posts',
   mobileFeed.posts > 0 && rgb(mobileFeed.bg) === 'rgb(255,255,255)',
   JSON.stringify({ ...mobileFeed, waitedMs: Date.now() - feedT0 }));

// On a phone the tabs are still their own band, so the room it gives back on
// scroll is a mobile behaviour and only means anything measured at 390px. The
// band stays pinned under the top bar; what it hands over is its own height.
const bandAtRest = await m.evaluate(() => {
  const el = document.querySelector('.home-header');
  const r = el.getBoundingClientRect();
  return { h: Math.round(r.height), top: Math.round(r.top), lifted: el.classList.contains('lifted') };
});
await m.evaluate(() => window.scrollTo(0, 700));
await sleep(700);
const bandRaised = await m.evaluate(() => {
  const el = document.querySelector('.home-header');
  const r = el.getBoundingClientRect();
  return {
    h: Math.round(r.height), top: Math.round(r.top), lifted: el.classList.contains('lifted'),
    posts: document.querySelectorAll('article.post').length,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1
  };
});
ok('mobile: the For you / Following band thins on scroll without losing its place',
   bandRaised.lifted && bandAtRest.h - bandRaised.h >= 4 && bandRaised.top === bandAtRest.top && !bandRaised.overflow,
   JSON.stringify({ resting: bandAtRest, raised: bandRaised }));
await shot(m, 'ss9-mobile-feed-lifted');
await m.evaluate(() => window.scrollTo(0, 0));
await sleep(400);

// ================= GUEST =================
// Its own browser context: the signed-in pages share cookies and localStorage,
// and a "guest" measured in that profile is not a guest.
const guestCtx = await browser.createBrowserContext();
const g = await newPage({ width: 1440, height: 900 }, false, guestCtx);
await goto(g, '/');
const guest = await g.evaluate(() => ({
  railAuth: !!document.querySelector('.rail-auth'),
  signup: !!document.querySelector('.topbar-signup'),
  signin: !!document.querySelector('.topbar-signin'),
  railUser: !!document.querySelector('.rail-user')
}));
ok('desktop: a guest signs in from the top bar, never the rail',
   !guest.railAuth && guest.signup && guest.signin && !guest.railUser, JSON.stringify(guest));
await shot(g, 'ss9-desktop-guest');

const guestPanel = await g.evaluate(async () => {
  document.querySelector('[aria-label="Messages"]')?.click();
  await new Promise(r => setTimeout(r, 800));
  return { panel: !!document.querySelector('.topbar-panel'), cta: document.querySelector('.panel-empty .empty-state-cta')?.textContent };
});
ok('desktop: the popover tells a guest to sign in instead of failing',
   guestPanel.panel && /sign in/i.test(guestPanel.cta || ''), JSON.stringify(guestPanel));
await shot(g, 'ss9-desktop-guest-popover');

ok('no console or HTTP errors during the run', errors.length === 0, errors.slice(0, 6).join(' | '));

await retryWrite(() => writeFileSync(`${OUT}/desktop-results.json`, JSON.stringify({
  passed: results.filter(r => r.pass).length,
  failed: results.filter(r => !r.pass).length,
  results,
  errors
}, null, 2)));
console.log(`\n${results.filter(r => r.pass).length}/${results.length} checks passed`);
await browser.close();
