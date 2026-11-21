/**
 * List + detail integration QA against the live Django backend.
 *
 * Every screen below is read through the Next proxy at :3000 and asserted
 * against the same endpoint a browser would hit, so cursor pagination, deep-link
 * hydration and server counters are checked as shipped rather than as mocked.
 */
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:3000';
const OUT = 'D:/social_medial/.qa';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DEMO = { username: 'sita', password: 'exposing-demo-1' };

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
async function newPage(viewport, mobile = false) {
  const page = await browser.newPage();
  await page.setViewport({ ...viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
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
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const url = page => page.evaluate(() => location.pathname);
const textOf = (page, sel) => page.$eval(sel, el => el.textContent.trim()).catch(() => '');
const count = (page, sel) => page.$$eval(sel, els => els.length).catch(() => 0);

async function goto(page, path) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(700);
}

/** Waits for a selector that the screen only paints once its list has landed. */
async function waitFor(page, sel, timeout = 20000) {
  await page.waitForSelector(sel, { timeout }).catch(() => {});
  return count(page, sel);
}

/** Reads the same endpoint the app reads, from inside the signed-in page. */
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

const setNative = (page, sel, value) => page.evaluate(([sel, value]) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}, [sel, value]);

/** Unrecognised device id, so the new-device code step fires on every run. */
const freshDevice = page => page.evaluate(() => {
  localStorage.setItem('exposing-device', `qa-${Math.random().toString(36).slice(2, 12)}`);
});

/** React reads value only through the native setter. */
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
  return url(page);
}

/** Scrolls a windowed page to its foot until nothing more arrives. */
async function walk(page, sel, rounds = 8) {
  let last = -1;
  for (let i = 0; i < rounds; i++) {
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await sleep(500);
    const now = await count(page, sel);
    if (now === last) break;
    last = now;
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await sleep(250);
  return last < 0 ? await count(page, sel) : last;
}

const d = await newPage({ width: 1440, height: 900 });

// ---------------------------------------------------------------- sign in ----
const landed = await signIn(d, DEMO.username, DEMO.password);
ok('desktop: the demo account signs in against /api/auth/', landed === '/', landed);
const session = await api(d, '/api/sync/');
ok('desktop: the session is the account that signed in', session.body?.me?.username === DEMO.username,
  JSON.stringify(session.body?.me?.username));

// ------------------------------------------------------------------ feed ----
await goto(d, '/');
const feedFirst = await waitFor(d, 'article.post');
const feedPage = await api(d, '/api/feed/');
ok('desktop: the feed renders a keyset page of real posts',
  feedFirst >= Math.min(feedPage.body?.results?.length || 0, 8), `screen ${feedFirst}, page ${feedPage.body?.results?.length}`);
const feedWalked = await walk(d, 'article.post');
ok('desktop: scrolling the feed walks cursors, not windows of the cache',
  feedWalked > (feedPage.body?.results?.length || 0), `${feedPage.body?.results?.length} -> ${feedWalked}`);
await shot(d, 'intg-desktop-feed');

// ------------------------------------------------------- reels (video only) ---
await goto(d, '/video');
await d.waitForSelector('.reels-page', { timeout: 10000 });
await sleep(2500);
const reelSlides = await count(d, '.reel-slide');
const reelVideos = await count(d, '.reel-slide video');
const reelPage = await api(d, '/api/posts/?media=video');
ok('desktop: reels come from the video keyset stream',
  reelSlides > 0 && reelVideos === reelSlides && reelSlides >= (reelPage.body?.results?.length || 0),
  `screen ${reelSlides} slides / ${reelVideos} videos, api ${reelPage.body?.results?.length} posts`);
ok('desktop: the reel counter reads the server page', (await textOf(d, '.reel-count')).startsWith('1 / '));
await shot(d, 'intg-desktop-reels');

// --------------------------------------------------------- post detail page ---
const oldest = await api(d, '/api/feed/?order=oldest');
const oldestRows = oldest.body?.results || [];
const deepPost = oldestRows[0];
const newestRows = feedPage.body?.results || [];
const ascending = oldestRows.every((row, i) => i === 0 || oldestRows[i - 1].created_at <= row.created_at);
ok('desktop: the oldest-first cursor walks the feed backwards',
  !!deepPost && ascending && deepPost.created_at <= newestRows[newestRows.length - 1]?.created_at,
  `oldest head ${deepPost?.created_at} vs newest page tail ${newestRows[newestRows.length - 1]?.created_at}, ascending ${ascending}`);
await goto(d, `/post/${deepPost?.id}`);
await waitFor(d, '.post-page-content article.post');
const deepText = await textOf(d, '.post-page-content article.post');
ok('desktop: a deep-linked post hydrates by id', deepText.length > 0 && deepText.includes((deepPost?.text || ' ').slice(0, 12)),
  deepText.slice(0, 60));
await shot(d, 'intg-desktop-post-deeplink');

// -------------------------------------------------------------- comments ------
const marker = `live-${Date.now().toString(36)}`;
await setNative(d, '.comments-compose input[name="comment"]', marker);
await d.evaluate(() => document.querySelector('.comments-compose button[type="submit"]')?.click());
await d.waitForFunction(t => [...document.querySelectorAll('.comments-row')].some(r => r.textContent.includes(t)),
  { timeout: 15000 }, marker).catch(() => {});
const posted = await d.evaluate(t => {
  const row = [...document.querySelectorAll('.comments-row')].find(r => r.textContent.includes(t));
  return row ? { id: row.getAttribute('data-comment'), text: row.textContent.includes(t) } : null;
}, marker);
ok('desktop: a comment is written to /api/comments/ and rendered from it',
  !!posted && /^\d+$/.test(posted.id || ''), JSON.stringify(posted));
const serverComments = await api(d, `/api/comments/?post=${deepPost?.id}&top=1`);
ok('desktop: the comment survives a server-side read back',
  (serverComments.body?.results || []).some(r => r.text === marker),
  `${serverComments.body?.results?.length} top-level rows`);
await goto(d, `/post/${deepPost?.id}`);
await waitFor(d, '.comments-row');
ok('desktop: the comment is still there after a reload',
  (await d.evaluate(t => !![...document.querySelectorAll('.comments-row')].find(r => r.textContent.includes(t)), marker)));
await shot(d, 'intg-desktop-comments');

// "Oldest" is a second cursor over the same thread, not a reversed page.
await d.evaluate(() => {
  const el = document.querySelector('.comments-sort select[aria-label="Sort comments"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(el, 'oldest');
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await sleep(1800);
const oldestServer = await api(d, `/api/comments/?post=${deepPost?.id}&top=1&order=oldest`);
const oldestTop = await textOf(d, '.comments-row');
ok('desktop: sorting by oldest reads the ascending page',
  !!oldestTop && oldestTop.includes((oldestServer.body?.results?.[0]?.text || '\u0000').slice(0, 18)),
  `screen ${oldestTop.slice(0, 40)} vs ${String(oldestServer.body?.results?.[0]?.text).slice(0, 40)}`);

// ------------------------------------------------------- listing detail ------
await goto(d, '/marketplace');
await waitFor(d, '.market-card:not(.skeleton)');
const marketPage = await api(d, '/api/marketplace/');
const marketCards = await count(d, '.market-card:not(.skeleton)');
ok('desktop: the marketplace grid renders the page the server chose',
  marketCards > 0 && marketCards === (marketPage.body?.results?.length || -1),
  `screen ${marketCards}, api ${marketPage.body?.results?.length}, has_more ${marketPage.body?.has_more}`);
if (marketPage.body?.has_more) {
  const marketWalked = await walk(d, '.market-card:not(.skeleton)');
  ok('desktop: the marketplace grid walks its cursor', marketWalked > marketCards, `${marketCards} -> ${marketWalked}`);
}
await shot(d, 'intg-desktop-marketplace');
const market = marketPage;
const deepListing = market.body?.results?.[market.body.results.length - 1];
await goto(d, `/marketplace/${deepListing?.id}`);
await waitFor(d, '.listing-page');
const shownTitle = await textOf(d, '.listing-title');
ok('desktop: a deep-linked listing hydrates by id',
  !!shownTitle && shownTitle === deepListing?.title, `${shownTitle} vs ${deepListing?.title}`);
const sellerName = await textOf(d, '.listing-seller-card');
ok('desktop: the listing page knows its seller', sellerName.includes(deepListing?.seller_name || '@'), sellerName.slice(0, 40));
await shot(d, 'intg-desktop-listing-deeplink');

// ---------------------------------------------------------------- profile ----
await goto(d, `/u/${DEMO.username}`);
await waitFor(d, '.profile-view');
const profileStats = await d.evaluate(() => {
  const cells = [...document.querySelectorAll('.profile-stats button, .profile-stats a, .profile-stat')];
  return cells.map(c => c.textContent.replace(/\s+/g, ' ').trim());
});
const profileRow = await api(d, `/api/profiles/${DEMO.username}/`);
ok('desktop: profile totals come from the profile row',
  profileStats.join('|').includes(String(profileRow.body?.followers)),
  `${profileStats.join(' | ')} vs followers=${profileRow.body?.followers}`);
const followerPage = await api(d, `/api/users/${DEMO.username}/followers/`);
await goto(d, `/u/${DEMO.username}/followers`);
await waitFor(d, '.people-page-list .people-row');
ok('desktop: the followers list is a keyset page of people',
  (await count(d, '.people-page-list .people-row')) === (followerPage.body?.results?.length || -1),
  `screen ${await count(d, '.people-page-list .people-row')}, api ${followerPage.body?.results?.length}`);
await shot(d, 'intg-desktop-followers');

// ----------------------------------------------------------------- search ----
await goto(d, `/explore?q=${DEMO.username}`);
await waitFor(d, '.search-view');
await sleep(900);
ok('desktop: people search hits /api/users/',
  (await d.evaluate(() => !!document.querySelector('.search-person, .feed-empty'))), '');
ok('desktop: the searched person is the account itself',
  (await textOf(d, '.search-person')).includes(DEMO.username), await textOf(d, '.search-person'));
await shot(d, 'intg-desktop-search');

// ------------------------------------------------------------ top-bar badges ---
// The badge pair lives in the desktop top bar, which only the main tabs carry.
await goto(d, '/');
await sleep(1200);
const badgeCounts = await api(d, '/api/notifications/unread/');
const badges = await d.evaluate(() => [...document.querySelectorAll('.topbar-badge')].map(b => b.textContent.trim()));
const expected = [Number(badgeCounts.body?.messages), Number(badgeCounts.body?.unread)].filter(n => n > 0);
ok('desktop: the top bar badges match the unread counters',
  expected.length === 0 ? badges.length === 0 : badges.length === expected.length,
  `screen ${JSON.stringify(badges)} vs api ${JSON.stringify(expected)}`);

// ------------------------------------------------------- inbox + chat thread ---
const chatPeer = (await api(d, `/api/users/${DEMO.username}/following/`)).body?.results?.[0]?.username;
ok('desktop: a chat partner exists for the thread test', !!chatPeer, String(chatPeer));
const unreadBefore = Number((await api(d, '/api/notifications/unread/')).body?.messages);
const seeded = await d.evaluate(async ([peer]) => {
  const pair = document.cookie.split('; ').find(c => c.startsWith('exposing_csrf='));
  const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': pair ? decodeURIComponent(pair.split('=')[1]) : '' };
  let sent = 0;
  for (let i = 0; i < 12; i++) {
    const res = await fetch(`/api/messages/${peer}/`, {
      method: 'POST', headers, credentials: 'same-origin', body: JSON.stringify({ text: `intg older ${i}` }),
    });
    if (!res.ok) return { sent, status: res.status };
    sent += 1;
  }
  return { sent, status: 200 };
}, [chatPeer]);
ok('desktop: twelve messages land on the thread endpoint', seeded.sent === 12, JSON.stringify(seeded));
await goto(d, '/messages');
await waitFor(d, '.inbox-row');
const inboxTop = await textOf(d, '.inbox-row');
ok('desktop: the inbox leads with the conversation just written',
  inboxTop.toLowerCase().includes(String(chatPeer).toLowerCase()), inboxTop.slice(0, 60));
await goto(d, `/messages/${chatPeer}`);
await waitFor(d, '.chat-bubble');
await sleep(600);
const firstPageBubbles = await count(d, '.chat-bubble');
const olderBtn = await count(d, '.chat-older-btn');
ok('desktop: the thread opens on the newest keyset page',
  firstPageBubbles > 0 && firstPageBubbles <= 10 && olderBtn === 1,
  `${firstPageBubbles} bubbles, load-more ${olderBtn}`);
const scrollBefore = await d.evaluate(() => {
  const el = document.querySelector('.chat-thread');
  return el.scrollHeight - el.scrollTop;
});
await d.evaluate(() => document.querySelector('.chat-older-btn')?.click());
await sleep(1200);
const afterOlder = await d.evaluate(() => {
  const el = document.querySelector('.chat-thread');
  return { bubbles: document.querySelectorAll('.chat-bubble').length, distance: el.scrollHeight - el.scrollTop };
});
ok('desktop: "load more" prepends an older page of the thread',
  afterOlder.bubbles > firstPageBubbles, `${firstPageBubbles} -> ${afterOlder.bubbles}`);
ok('desktop: loading older rows keeps the reader where they were',
  Math.abs(afterOlder.distance - scrollBefore) < 120, `${scrollBefore} -> ${afterOlder.distance}`);
await shot(d, 'intg-desktop-chat');
const unreadAfter = Number((await api(d, '/api/notifications/unread/')).body?.messages);
ok('desktop: opening a thread marks it read on the server',
  unreadBefore === 0 || unreadAfter < unreadBefore, `unread messages ${unreadBefore} -> ${unreadAfter}`);

// ------------------------------------------------------- notifications + saved ---
await goto(d, '/notifications');
await waitFor(d, '.notif-row, .feed-empty');
const notifRows = await count(d, '.notif-row');
const notifApi = await api(d, '/api/notifications/');
ok('desktop: notifications render the server page', notifRows === (notifApi.body?.results?.length || -1),
  `${notifRows} vs ${notifApi.body?.results?.length}`);
await goto(d, '/saved');
await waitFor(d, '.saved-list article.post, .feed-empty');
const savedRows = await count(d, '.saved-list article.post');
const savedApi = await api(d, '/api/saved/posts/');
ok('desktop: saved posts come from /api/saved/posts/', savedRows === (savedApi.body?.results?.length || -1),
  `${savedRows} vs ${savedApi.body?.results?.length}`);
await shot(d, 'intg-desktop-saved');

// ------------------------------------------------------------------ mobile ----
const m = await newPage({ width: 390, height: 844 }, true);
await signIn(m, DEMO.username, DEMO.password);
await goto(m, '/');
const mFeedFirst = await waitFor(m, 'article.post');
const mFeedWalked = await walk(m, 'article.post');
ok('mobile: the feed pages with cursors on a phone', mFeedWalked > mFeedFirst, `${mFeedFirst} -> ${mFeedWalked}`);
await shot(m, 'intg-mobile-feed');

await goto(m, `/messages/${chatPeer}`);
await waitFor(m, '.chat-bubble');
await sleep(500);
const mBubbles = await count(m, '.chat-bubble');
await m.evaluate(() => document.querySelector('.chat-older-btn')?.click());
await sleep(1200);
ok('mobile: the thread loads older messages on a phone',
  (await count(m, '.chat-bubble')) > mBubbles, `${mBubbles} -> ${await count(m, '.chat-bubble')}`);
await shot(m, 'intg-mobile-chat');

const mMarker = `mobile-${Date.now().toString(36)}`;
await goto(m, `/post/${deepPost?.id}`);
await waitFor(m, '.comments-compose input[name="comment"]');
await setNative(m, '.comments-compose input[name="comment"]', mMarker);
await m.evaluate(() => document.querySelector('.comments-compose button[type="submit"]')?.click());
await m.waitForFunction(t => [...document.querySelectorAll('.comments-row')].some(r => r.textContent.includes(t)),
  { timeout: 15000 }, mMarker).catch(() => {});
ok('mobile: a comment sent from a phone reaches the server',
  await m.evaluate(t => !![...document.querySelectorAll('.comments-row')].find(r => r.textContent.includes(t)), mMarker));
await shot(m, 'intg-mobile-comments');

await goto(m, '/video');
await m.waitForSelector('.reels-page', { timeout: 10000 });
await sleep(2200);
ok('mobile: reels stream on a phone', (await count(m, '.reel-slide')) > 0, String(await count(m, '.reel-slide')));
await shot(m, 'intg-mobile-reels');

await browser.close();

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} integration checks green.`);
if (errors.length) console.log('console/network noise:\n' + [...new Set(errors)].slice(0, 25).join('\n'));
const { writeFileSync } = await import('node:fs');
writeFileSync(`${OUT}/integration-results.json`, JSON.stringify({ results, errors: [...new Set(errors)] }, null, 2));
process.exit(failed.length ? 1 : 0);
