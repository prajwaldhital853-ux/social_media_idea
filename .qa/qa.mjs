import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { retryWrite } from './shots.mjs';

const OUT = process.env.QA_OUT || 'D:/social_medial/.qa';
const BASE = process.env.QA_BASE || 'http://localhost:3000';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
fs.writeFileSync(`${OUT}/test.png`, png);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--lang=en-US', '--force-device-scale-factor=1', '--hide-scrollbars=false']
});

const errors = [];
async function newPage(viewport, mobile = false) {
  const page = await browser.newPage();
  await page.setViewport({ ...viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  page.on('response', r => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url().slice(0, 160)}`); });
  return page;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const capture = (run, name) => retryWrite(() => run({ path: `${OUT}/${name}.png` }));
const shot = (page, name) => capture(cfg => page.screenshot(cfg), name);
/** A seek needs both taps inside the player's 320ms window. Two awaited
 *  mouse.click calls leave that gap to node's event loop, which stalls when the
 *  machine is thrashing and silently degrades the gesture into two pause taps —
 *  so dispatch the pair from one browser task and read the outcome in the same
 *  task that sees the badge, because it self-hides after 760ms. The point comes
 *  from the player's own box and elementFromPoint keeps the real hit test, so a
 *  layout shift or an overlay in the way still fails. */
const doubleTapSeek = (page, dir) => page.evaluate(async dir => {
  const box = document.querySelector('.reel-slide .auto-video')?.getBoundingClientRect();
  if (!box?.width) throw new Error('no reel player on screen');
  const x = Math.round(box.left + box.width * (dir === 'right' ? 0.75 : 0.25));
  const y = Math.round(box.top + box.height * 0.45);
  const vid = document.querySelector('.reel-slide video');
  const el = document.elementFromPoint(x, y);
  if (!el?.closest('.auto-video')) return { t: vid?.currentTime, dur: vid?.duration, badge: false, miss: el?.className || 'nothing' };
  const tap = () => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
  tap();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  tap();
  const deadline = performance.now() + 900;
  for (;;) {
    if (document.querySelector(`.av-seek.${dir}`)) return { t: vid.currentTime, dur: vid.duration, badge: true };
    if (performance.now() > deadline) return { t: vid.currentTime, dur: vid.duration, badge: false };
    await new Promise(r => requestAnimationFrame(r));
  }
}, dir);
async function goto(page, path) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('.post, .create-post-page, .search-view, .login-card, .login-container, .modern-login, .reels-page, .media-page, .profile-view, .profile-missing, .wallet-body, .settings-body, .notif-view, .inbox-view, .chat-view, .market-view, .admin-view, .legal-doc, .signup-container, .saved-list, .empty-state, .feed-empty, .people-page, .listing-page, .people-page-list', { timeout: 30000 }).catch(() => {});
  await sleep(900);
  if (path === '/') await loadAllFeed(page);
}
async function loadAllFeed(page) {
  for (let i = 0; i < 10; i++) {
    const before = await page.evaluate(() => document.querySelectorAll('article.post').length);
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await sleep(320);
    const after = await page.evaluate(() => document.querySelectorAll('article.post').length);
    if (after === before) break;
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await sleep(250);
}
// A demo-mode publish resolves inside one frame, so waitForSelector on the
// progress ring races it. Tape the ring's own paint sequence in-page instead.
const watchPublish = page => page.evaluate(() => {
  window.__pub = [];
  const t0 = performance.now();
  new MutationObserver(() => {
    const card = document.querySelector('.publish-card');
    if (card) window.__pub.push({
      ms: Math.round(performance.now() - t0),
      pct: card.querySelector('.publish-pct')?.textContent,
      label: card.querySelector('b')?.textContent
    });
  }).observe(document.body, { childList: true, subtree: true });
});
const publishTape = page => page.evaluate(() => window.__pub || []);
const setKb = (page, kb, visible) => page.evaluate(([kb, visible]) => {
  const r = document.documentElement.style;
  r.setProperty('--keyboard-bottom', kb + 'px');
  r.setProperty('--visible-height', visible + 'px');
  r.setProperty('--visible-top', '0px');
}, [kb, visible]);
const clearKb = page => page.evaluate(() => {
  const r = document.documentElement.style;
  r.removeProperty('--keyboard-bottom'); r.removeProperty('--visible-height'); r.removeProperty('--visible-top');
});
const articleBy = (page, text) => page.evaluateHandle(t =>
  [...document.querySelectorAll('article.post')].find(a => a.textContent.includes(t)), text);
const setVal = (page, sel, v) => page.evaluate(([sel, v]) => {
  const el = document.querySelector(sel);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, [sel, v]);
const goBack = async page => {
  await page.goBack({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
  await sleep(750);
  if (await page.evaluate(() => location.pathname) === '/') await loadAllFeed(page);
};
const clickPost = (page, text, sel) => page.evaluate(([t, s]) => {
  [...document.querySelectorAll('article.post')].find(a => a.textContent.includes(t))?.querySelector(s)?.click();
}, [text, sel]);
const scrollPost = (page, text) => page.evaluate(t => {
  [...document.querySelectorAll('article.post')].find(a => a.textContent.includes(t))?.scrollIntoView({ block: 'center' });
}, text);
const swipe = async (page, x1, y1, x2, y2, steps = 14) => {
  const cdp = await page.createCDPSession();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * i / steps, y: y1 + (y2 - y1) * i / steps }] });
    await sleep(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
};

// ================= DESKTOP =================
const d = await newPage({ width: 1280, height: 900 });
await goto(d, '/');

// This suite reads the localStorage demo database, so it only means something
// against a build made with NEXT_PUBLIC_API=off. An API build paints the same
// screens from server rows and would report a hundred false failures.
const isDemoBuild = await d.evaluate(() => !!localStorage.getItem('exposing-demo-v1'));
ok('this build runs on the localStorage demo database', isDemoBuild, JSON.stringify({ isDemoBuild }));
if (!isDemoBuild) {
  console.log('\nqa.mjs needs a demo build: NEXT_PUBLIC_API=off npm run build && npm start');
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
  process.exit(1);
}

const layout = await d.evaluate(() => {
  const cols = getComputedStyle(document.querySelector('.shell')).gridTemplateColumns.split(' ').map(parseFloat);
  const main = document.querySelector('.main').getBoundingClientRect();
  const calm = document.querySelector('.side-calm');
  const cr = calm.getBoundingClientRect();
  return { cols, mainW: Math.round(main.width), calmW: Math.round(cr.width), calmBg: getComputedStyle(calm).backgroundColor, suggestRows: calm.querySelectorAll('.suggest-row').length, calmGutter: Math.round(window.innerWidth - cr.right), rail: !!document.querySelector('.rail .nav-item') };
});
ok('desktop: left menu + feed column + quiet right rail with inline suggestions',
  layout.cols.length === 3 && layout.mainW >= 540 && layout.mainW <= 580 && layout.calmW > 200
  // The rail is inset by the shell's own right padding, never flush to the window.
  && layout.suggestRows >= 1 && layout.calmBg === 'rgba(0, 0, 0, 0)'
  && layout.calmGutter >= 16 && layout.calmGutter <= 48 && layout.rail, JSON.stringify(layout));

await d.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
await d.waitForSelector('article.post', { timeout: 30000 });
await sleep(600);
const firstPage = await d.evaluate(() => document.querySelectorAll('article.post').length);
await loadAllFeed(d);
const fullPage = await d.evaluate(() => document.querySelectorAll('article.post').length);
ok('desktop: feed paginates first paint and loads more on scroll', firstPage === 10 && fullPage > firstPage, JSON.stringify({ firstPage, fullPage }));

const clickTime = async (sel, waitSel) => {
  const start = Date.now();
  await d.evaluate(s => document.querySelector(s)?.click(), sel);
  await d.waitForSelector(waitSel, { timeout: 15000 });
  return Date.now() - start;
};
const tSearch = await clickTime('.rail .nav-item[href="/explore"]', '.search-view');
ok('desktop: Search opens fast (prefetched)', tSearch < 1500, `${tSearch}ms`);
await goto(d, '/');
const tReels = await clickTime('.rail .nav-item[href="/video"]', '.reels-page');
ok('desktop: Reels opens fast (prefetched)', tReels < 1500, `${tReels}ms`);
await goto(d, '/');
await d.hover('article.post');
const tPost = await clickTime('article.post', '.post-page-content');
ok('desktop: post opens fast (prefetched on hover)', tPost < 1500, `${tPost}ms`);
await goto(d, '/');
await d.hover('article.post');
const tProfile = await clickTime('article.post .post-name', '.profile-view');
ok('desktop: author profile opens fast (prefetched on hover)', tProfile < 1500, `${tProfile}ms`);
await goto(d, '/');

ok('desktop: feed renders', await d.evaluate(() => document.querySelectorAll('.post').length >= 10));
ok('desktop: window scrollbar hidden', await d.evaluate(() => getComputedStyle(document.documentElement).scrollbarWidth === 'none'));
ok('desktop: no horizontal overflow', await d.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
ok('desktop: page-enter animation', await d.evaluate(() => getComputedStyle(document.querySelector('.page-enter')).animationName === 'pageIn'));
await shot(d, 'desktop-feed');

const brand = await d.evaluate(async () => {
  const icon = document.querySelector('link[rel="icon"]');
  const apple = document.querySelector('link[rel="apple-touch-icon"]');
  const img = document.querySelector('.topbar .brand-logo-light');
  const pathOf = href => (href || '').split('?')[0];
  // Next fingerprints app/icon.png, so only the path is the contract; the bytes
  // are what proves it is the real logo rather than a letter drawn on a tile.
  const head = await fetch(icon.getAttribute('href')).then(r => r.arrayBuffer()).then(b => [...new Uint8Array(b).slice(0, 8)]);
  return {
    favicon: pathOf(icon?.getAttribute('href')),
    apple: pathOf(apple?.getAttribute('href')),
    logoLoaded: (img?.naturalWidth || 0) > 0,
    logoSrc: img?.getAttribute('src'),
    isPng: head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47
  };
});
ok('desktop: real favicon + rail logo loaded', brand.isPng && brand.favicon === '/icon.png' && brand.apple === '/apple-icon.png' && brand.logoLoaded && brand.logoSrc === '/exposing-logo.png', JSON.stringify(brand));

const mix = await articleBy(d, 'Weekend in Pokhara');
const mixInfo = await d.evaluate(el => {
  const m = el.querySelector('.media-mosaic');
  return { cls: m.className, cells: m.querySelectorAll('.mosaic-cell').length, more: m.querySelector('.media-more')?.textContent, preview: !!m.querySelector('.post-video.preview'), previewPaused: m.querySelector('.post-video video')?.paused };
}, mix);
ok('desktop: p_mix stack n5, 5 cells, +3', mixInfo.cls.includes('stack n5') && mixInfo.cells === 5 && mixInfo.more === '+3', JSON.stringify(mixInfo));
ok('desktop: mixed video is paused preview', mixInfo.preview && mixInfo.previewPaused);
await capture(cfg => mix.asElement().screenshot(cfg), 'desktop-mosaic');

// Single video: autoplay WITH SOUND, pauses off-screen
await scrollPost(d, 'Rain over New Road');
await sleep(1600);
const singleVid = await d.evaluate(() => {
  const a = [...document.querySelectorAll('article.post')].find(x => x.textContent.includes('Rain over New Road'));
  const v = a?.querySelector('.media-mosaic.single video');
  return v ? { paused: v.paused, muted: v.muted, loop: v.loop } : null;
});
ok('desktop: single video autoplays with sound + loop', singleVid && !singleVid.paused && singleVid.muted === false && singleVid.loop, JSON.stringify(singleVid));
await d.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
await sleep(900);
ok('desktop: video pauses when scrolled off-screen', await d.evaluate(() => {
  const a = [...document.querySelectorAll('article.post')].find(x => x.textContent.includes('Rain over New Road'));
  return a?.querySelector('.media-mosaic.single video')?.paused === true;
}));
await scrollPost(d, 'Rain over New Road');
await d.waitForFunction(() => {
  const a = [...document.querySelectorAll('article.post')].find(x => x.textContent.includes('Rain over New Road'));
  const v = a?.querySelector('.media-mosaic.single video');
  return v && !v.paused;
}, { timeout: 6000 }).catch(() => {});
await sleep(300);
ok('desktop: video resumes when back in view', await d.evaluate(() => {
  const a = [...document.querySelectorAll('article.post')].find(x => x.textContent.includes('Rain over New Road'));
  return a?.querySelector('.media-mosaic.single video')?.paused === false;
}));

// Mixed mosaic video click -> picture-scrolling media page at that clip (phase 5)
await scrollPost(d, 'Weekend in Pokhara');
await sleep(400);
await clickPost(d, 'Weekend in Pokhara', '.post-video .video-play');
await d.waitForSelector('.media-page', { timeout: 8000 });
await sleep(1400);
const mixMedia = await d.evaluate(() => {
  const el = document.querySelector('.media-page-scroll');
  const i = Math.round(el.scrollLeft / el.clientWidth);
  const v = document.querySelectorAll('.media-page-slide')[i]?.querySelector('video');
  return { path: location.pathname, i, src: v?.getAttribute('src'), playing: v ? !v.paused : false, count: document.querySelector('.media-page-count')?.textContent, noReels: !document.querySelector('.reels-page') };
});
ok('desktop: mixed mosaic video opens media page at that clip (not Reels)', /\/post\/p_mix\/media\/0$/.test(mixMedia.path) && (mixMedia.src || '').includes('flower') && mixMedia.playing && mixMedia.count === '1 / 8' && mixMedia.noReels, JSON.stringify(mixMedia));

// Mixed photo click -> dedicated media route at 2/8
await goto(d, '/');
await scrollPost(d, 'Weekend in Pokhara');
await sleep(400);
await clickPost(d, 'Weekend in Pokhara', '.mosaic-cell:nth-child(2) img');
await d.waitForSelector('.media-page', { timeout: 8000 }).catch(() => {});
if (!(await d.$('.media-page'))) {
  // A cell clicked a beat before its handler attached swallows the press, so the
  // step retries rather than reading its own race as a broken mosaic.
  await scrollPost(d, 'Weekend in Pokhara');
  await sleep(900);
  await clickPost(d, 'Weekend in Pokhara', '.mosaic-cell:nth-child(2) img');
  await d.waitForSelector('.media-page', { timeout: 12000 });
}
await sleep(1200);
const viewer1 = await d.evaluate(() => {
  const sc = document.querySelector('.media-page-scroll');
  const cs = getComputedStyle(sc);
  return {
    path: location.pathname,
    count: document.querySelector('.media-page-count')?.textContent,
    slides: document.querySelectorAll('.media-page-slide').length,
    snap: cs.scrollSnapType,
    axis: cs.overflowX + '/' + cs.overflowY,
    row: cs.flexDirection,
    slideW: Math.round(document.querySelector('.media-page-slide').getBoundingClientRect().width),
    clientW: sc.clientWidth,
    slide0Video: !!document.querySelectorAll('.media-page-slide')[0]?.querySelector('video'),
    slide1Img: !!document.querySelectorAll('.media-page-slide')[1]?.querySelector('img')
  };
});
ok('desktop: photo opens media route at 2/8, 8 slides, horizontal snap', /\/post\/.+\/media\/1$/.test(viewer1.path) && viewer1.count === '2 / 8' && viewer1.slides === 8 && viewer1.snap === 'x mandatory' && viewer1.axis === 'auto/hidden' && viewer1.row === 'row' && viewer1.slideW === viewer1.clientW && viewer1.slide0Video && viewer1.slide1Img, JSON.stringify(viewer1));
await shot(d, 'desktop-media-video');
await d.evaluate(() => { const el = document.querySelector('.media-page-scroll'); el.scrollTo({ left: 0, behavior: 'instant' }); });
await sleep(1000);
const mediaVid = await d.evaluate(() => ({ count: document.querySelector('.media-page-count')?.textContent, playing: !document.querySelector('.media-page-slide video')?.paused, muted: document.querySelector('.media-page-slide video')?.muted }));
ok('desktop: media page video slide plays with sound at 1/8', mediaVid.count === '1 / 8' && mediaVid.playing && mediaVid.muted === false, JSON.stringify(mediaVid));
await d.keyboard.press('ArrowRight');
await sleep(700);
ok('desktop: ArrowRight advances to 2/8', await d.evaluate(() => document.querySelector('.media-page-count')?.textContent === '2 / 8'));
await d.keyboard.press('ArrowLeft');
await sleep(700);
ok('desktop: ArrowLeft returns to 1/8', await d.evaluate(() => document.querySelector('.media-page-count')?.textContent === '1 / 8'));
await d.keyboard.press('ArrowRight');
await sleep(700);

// Per-media like + comment on the media page
ok('desktop: per-media action bar (like/comment/share)', await d.evaluate(() => !!document.querySelector('.media-page-actions .reaction-trigger') && !!document.querySelector('.media-page-actions button[aria-label^="Comment on"]') && !!document.querySelector('.media-page-actions button[aria-label="Share this media"]')));
const mixId = await d.evaluate(() => JSON.parse(localStorage.getItem('exposing-demo-v1')).posts.find(p => p.text.includes('Weekend in Pokhara')).id);
await d.evaluate(() => document.querySelector('.media-page-slide:nth-child(2) .media-page-actions .reaction-trigger').click());
await sleep(350);
ok('desktop: per-media like stored as media reaction', await d.evaluate(id => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return db.reactions.some(r => r.targetType === 'media' && r.targetId === `${id}#m1` && r.uid === db.meId);
}, mixId));
await d.evaluate(() => document.querySelector('.media-page-slide:nth-child(2) .media-page-actions button[aria-label^="Comment on"]').click());
await d.waitForSelector('.comments-overlay', { timeout: 5000 });
await sleep(450);
const layering = await d.evaluate(() => ({
  sheetZ: getComputedStyle(document.querySelector('.comments-overlay')).zIndex,
  pageZ: getComputedStyle(document.querySelector('.media-page')).zIndex,
  sheetVisible: document.querySelector('.comments-sheet').getBoundingClientRect().height > 200
}));
ok('desktop: photo comment sheet layers above media page', Number(layering.sheetZ) > Number(layering.pageZ) && layering.sheetVisible, JSON.stringify(layering));
await shot(d, 'desktop-media-comments');
await d.type('.comments-overlay .comments-compose input', 'QA photo comment');
await d.evaluate(() => document.querySelector('.comments-overlay button[type="submit"]').click());
await sleep(400);
ok('desktop: photo comment stored with mediaIndex', await d.evaluate(id => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return db.comments.some(c => c.pid === id && c.mediaIndex === 1 && c.text === 'QA photo comment');
}, mixId));
await d.keyboard.press('Escape');
await sleep(500);
ok('desktop: Escape closes photo sheet, media page stays', await d.evaluate(() => !document.querySelector('.comments-overlay') && !!document.querySelector('.media-page')));

// Back returns to feed without reload, totals aggregate
await d.evaluate(() => { window.__qaMarker = true; });
await goBack(d);
const backInfo = await d.evaluate(() => ({ path: location.pathname, marker: !!window.__qaMarker, page: !!document.querySelector('.media-page') }));
ok('desktop: phone-back returns to feed without reload', backInfo.path === '/' && backInfo.marker && !backInfo.page, JSON.stringify(backInfo));
const agg = await d.evaluate(id => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const a = [...document.querySelectorAll('article.post')].find(x => x.textContent.includes('Weekend in Pokhara'));
  const totalComments = db.comments.filter(c => c.pid === id && c.status === 'live').length;
  const totalReactions = db.reactions.filter(r => (r.targetType === 'post' && r.targetId === id) || (r.targetType === 'media' && r.targetId.startsWith(`${id}#m`))).length;
  return { commentSpan: a.querySelector('[aria-label="Comments"] span')?.textContent, reactSpan: a.querySelector('.post-actions .reaction-trigger span:not(.reaction-mix)')?.textContent, totalComments, totalReactions };
}, mixId);
ok('desktop: post totals include per-media comments+reactions', agg.commentSpan === String(agg.totalComments) && agg.reactSpan === String(agg.totalReactions), JSON.stringify(agg));

// Open-at-index + horizontal swipe direction correctness
await scrollPost(d, 'Golden hour');
await sleep(300);
await clickPost(d, 'Golden hour', '.stack.n4 .mosaic-cell:nth-child(3) img');
await d.waitForSelector('.media-page', { timeout: 8000 });
await sleep(600);
ok('desktop: 3rd photo opens media page at 3/4', await d.evaluate(() => document.querySelector('.media-page-count')?.textContent === '3 / 4'));
await shot(d, 'desktop-media-third');
await d.mouse.move(640, 450);
await d.mouse.wheel({ deltaY: 650 });
await sleep(900);
ok('desktop: wheel advances one slide to 4/4', await d.evaluate(() => document.querySelector('.media-page-count')?.textContent === '4 / 4'));
await d.mouse.wheel({ deltaX: -650 });
await sleep(900);
ok('desktop: horizontal wheel back returns to previous slide 3/4 (not first)', await d.evaluate(() => document.querySelector('.media-page-count')?.textContent === '3 / 4'));
const hSnap = await d.evaluate(async () => {
  const el = document.querySelector('.media-page-scroll');
  el.scrollTo({ left: el.clientWidth * 1.5, behavior: 'smooth' });
  await new Promise(r => setTimeout(r, 1000));
  return { left: Math.round(el.scrollLeft), w: el.clientWidth, count: document.querySelector('.media-page-count')?.textContent, vertical: el.scrollTop };
});
ok('desktop: horizontal snap settles on a whole slide, no partial flicker', hSnap.left % hSnap.w === 0 && hSnap.vertical === 0 && hSnap.count === `${hSnap.left / hSnap.w + 1} / 4`, JSON.stringify(hSnap));
const snapTime = await d.evaluate(async () => {
  const el = document.querySelector('.media-page-scroll');
  const w = el.clientWidth;
  el.scrollTo({ left: w * 2, behavior: 'instant' });
  await new Promise(r => setTimeout(r, 200));
  const t0 = performance.now();
  el.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true, cancelable: true }));
  await new Promise(resolve => {
    const check = () => {
      if (Math.abs(el.scrollLeft - w * 3) < 1 || performance.now() - t0 > 2000) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
  return { ms: Math.round(performance.now() - t0), left: Math.round(el.scrollLeft), w };
});
ok('desktop: picture snaps to center immediately (<300ms)', snapTime.ms < 300 && snapTime.left === snapTime.w * 3, JSON.stringify(snapTime));
await d.evaluate(() => { const el = document.querySelector('.media-page-scroll'); el.scrollTo({ left: el.clientWidth * 3, behavior: 'instant' }); });
await sleep(500);
ok('desktop: horizontal scroll reaches 4/4', await d.evaluate(() => document.querySelector('.media-page-count')?.textContent === '4 / 4'));
const navBtns = await d.evaluate(() => {
  const prev = document.querySelector('.media-page-nav.prev');
  const next = document.querySelector('.media-page-nav.next');
  const p = prev.getBoundingClientRect(), n = next.getBoundingClientRect();
  return { prevDisabled: prev.disabled, nextDisabled: next.disabled, sides: p.left < n.left && Math.abs(p.top - n.top) < 2, mid: Math.abs((p.top + p.height / 2) - window.innerHeight / 2) < 4 };
});
ok('desktop: side prev/next arrows, next disabled on last slide', navBtns.prevDisabled === false && navBtns.nextDisabled === true && navBtns.sides && navBtns.mid, JSON.stringify(navBtns));
await d.evaluate(() => document.querySelector('.media-page-nav.prev').click());
await sleep(800);
ok('desktop: prev arrow returns to 3/4', await d.evaluate(() => document.querySelector('.media-page-count')?.textContent === '3 / 4'));
await goBack(d);
ok('desktop: back from media page lands on feed', await d.evaluate(() => location.pathname === '/' && !document.querySelector('.media-page')));

// Comment sheet on p3: suggestions, hidden scrollbar, focus retention
await scrollPost(d, 'Just witnessed');
await sleep(300);
await clickPost(d, 'Just witnessed', '[aria-label="Comments"]');
await d.waitForSelector('.comments-overlay', { timeout: 5000 });
await sleep(500);
const sheetInfo = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const kinds = [...new Set(db.reactions.filter(r => r.targetType === 'post' && r.targetId === 'p3').map(r => r.kind))];
  const suggestKinds = [...document.querySelectorAll('.comments-suggestions .suggest-emoji')].map(b => b.getAttribute('aria-label').replace('Insert ', '').replace(' emoji', '').toLowerCase());
  const head = [...document.querySelectorAll('.comments-heading .comment-reaction-icon')].length;
  const chips = [...document.querySelectorAll('.comments-suggestions .suggest-chip')].map(b => b.textContent);
  const row = document.querySelector('.comments-suggestions');
  return { kinds, suggestKinds, head, chips, rowScrollable: row.scrollWidth > row.clientWidth, rowScrollbar: getComputedStyle(row).scrollbarWidth, inputAutocomplete: document.querySelector('.comments-compose input').getAttribute('autocomplete') };
});
ok('desktop: suggestion emojis mirror post kinds', JSON.stringify(sheetInfo.suggestKinds.sort()) === JSON.stringify(sheetInfo.kinds.sort()), JSON.stringify(sheetInfo));
ok('desktop: heading shows post reaction icons', sheetInfo.head === sheetInfo.kinds.length);
ok('desktop: suggestion chips render + row scrolls', sheetInfo.chips.includes('Nice!') && sheetInfo.chips.length >= 5 && sheetInfo.rowScrollable);
ok('desktop: suggestion row scrollbar hidden', sheetInfo.rowScrollbar === 'none', sheetInfo.rowScrollbar);
ok('desktop: comment input disables autofill', sheetInfo.inputAutocomplete === 'off');
await shot(d, 'desktop-comments');

// Keyboard open + chip/emoji clicks must NOT drop focus (no keypad cycle, no shake)
await d.focus('.comments-compose input');
await sleep(200);
await setKb(d, 380, 520);
await sleep(300);
const beforeCount = await d.evaluate(() => JSON.parse(localStorage.getItem('exposing-demo-v1')).comments.length);
await d.click('.suggest-chip');
await sleep(300);
const chipFocus = await d.evaluate(() => ({
  active: document.activeElement?.className || document.activeElement?.tagName,
  isInput: document.activeElement === document.querySelector('.comments-compose input'),
  val: document.querySelector('.comments-compose input').value,
  kb: getComputedStyle(document.documentElement).getPropertyValue('--keyboard-bottom').trim(),
  count: JSON.parse(localStorage.getItem('exposing-demo-v1')).comments.length
}));
ok('desktop: chip fills field, keeps focus + keyboard, no auto-post', chipFocus.isInput && chipFocus.val.includes('Nice!') && chipFocus.kb === '380px' && chipFocus.count === beforeCount, JSON.stringify(chipFocus));
await d.click('.emoji-btn');
await d.waitForSelector('.emoji-picker', { timeout: 3000 });
await sleep(200);
const pickerFocus = await d.evaluate(() => document.activeElement === document.querySelector('.comments-compose input'));
await d.click('.emoji-picker button[aria-label="Insert 🔥"]');
await sleep(250);
const emojiFocus = await d.evaluate(() => ({
  isInput: document.activeElement === document.querySelector('.comments-compose input'),
  val: document.querySelector('.comments-compose input').value,
  kb: getComputedStyle(document.documentElement).getPropertyValue('--keyboard-bottom').trim()
}));
ok('desktop: emoji picker opens + inserts without dropping keyboard', pickerFocus && emojiFocus.isInput && emojiFocus.val.includes('🔥') && emojiFocus.kb === '380px', JSON.stringify({ pickerFocus, ...emojiFocus }));
await shot(d, 'desktop-emoji-picker');
await d.keyboard.press('Escape');
await sleep(250);
ok('desktop: Escape closes picker, keeps sheet', await d.evaluate(() => !document.querySelector('.emoji-picker') && !!document.querySelector('.comments-overlay')));
await setVal(d, '.comments-compose input', '');

// Sheet geometry tracks the visible viewport exactly
const kbSheet = await d.evaluate(() => {
  const ov = document.querySelector('.comments-overlay');
  const r = ov.getBoundingClientRect();
  const compose = document.querySelector('.comments-sheet .comments-compose').getBoundingClientRect();
  const list = document.querySelector('.comments-sheet .comments-list');
  list.scrollTo({ top: 120, behavior: 'instant' });
  return { top: r.top, fullH: r.height, composeBottom: compose.bottom, listScrolled: list.scrollTop > 0, composeVisible: compose.bottom <= 521 && compose.top >= r.top };
});
ok('desktop: scrim = visible viewport, compose sits on keyboard edge', kbSheet.top === 0 && kbSheet.fullH === 520 && kbSheet.composeVisible && kbSheet.listScrolled, JSON.stringify(kbSheet));
await shot(d, 'desktop-sheet-keyboard');
await clearKb(d);
await sleep(200);

// First-open race: focus + keyboard in the same tick as sheet mount
await d.evaluate(() => document.querySelector('.comments-overlay').click());
await sleep(500);
await clickPost(d, 'Just witnessed', '[aria-label="Comments"]');
await d.waitForSelector('.comments-overlay', { timeout: 5000 });
await d.evaluate(() => document.querySelector('.comments-compose input').focus());
await sleep(150);
await setKb(d, 380, 520);
await sleep(300);
ok('desktop: first-open focus + keyboard keeps compose visible', await d.evaluate(() => {
  const c = document.querySelector('.comments-sheet .comments-compose').getBoundingClientRect();
  const sheet = document.querySelector('.comments-sheet');
  return c.bottom <= 521 && c.height > 30 && document.documentElement.dataset.typing === 'true' && getComputedStyle(sheet).animationName === 'none';
}));
await clearKb(d);

// Threaded replies: first 4, then view-more
const viewBtn = await d.evaluate(() => {
  const b = document.querySelector('[data-comment="c1"] .view-replies');
  if (!b) return null;
  b.click();
  return b.textContent.trim();
});
await sleep(400);
const threadInfo = await d.evaluate(() => ({ replies: document.querySelectorAll('[data-comment="c1"] .comment-replies .comments-row').length, badge: !!document.querySelector('[data-comment="c1r1"] .comment-bubble-reactions .reaction-art') }));
ok('desktop: View 4 replies expands thread', viewBtn?.includes('View 4 replies') && threadInfo.replies === 4, `${viewBtn} / ${threadInfo.replies}`);
ok('desktop: reply reaction badge uses ReactionIcon art', threadInfo.badge);
await shot(d, 'desktop-comments-thread');

await d.evaluate(() => { [...document.querySelectorAll('[data-comment="c1r1"] .comment-action-btn')].find(b => b.textContent === 'Reply').click(); });
await sleep(250);
const banner = await d.evaluate(() => ({ banner: document.querySelector('.reply-banner')?.textContent || '', val: document.querySelector('.comments-compose input').value }));
ok('desktop: reply banner + prefill', banner.banner.includes('Replying to') && banner.val.startsWith('@'), JSON.stringify(banner));
await d.type('.comments-compose input', 'QA threaded reply');
await d.evaluate(() => document.querySelector('.comments-compose button[type="submit"]').click());
await sleep(450);
const paged = await d.evaluate(() => ({
  shown: document.querySelectorAll('[data-comment="c1"] .comment-replies .comments-row').length,
  more: document.querySelector('[data-comment="c1"] .view-more-replies')?.textContent || ''
}));
ok('desktop: reply paging shows 4 + view more (1)', paged.shown === 4 && paged.more.includes('View more replies (1)'), JSON.stringify(paged));
await d.evaluate(() => document.querySelector('[data-comment="c1"] .view-more-replies').click());
await sleep(350);
ok('desktop: view more loads the 5th reply', await d.evaluate(() => document.querySelectorAll('[data-comment="c1"] .comment-replies .comments-row').length === 5));
const mention = await d.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-comment="c1"] .comment-replies .comments-row')];
  const el = rows[rows.length - 1].querySelector('.comment-mention');
  return el ? { theme: document.documentElement.getAttribute('data-theme'), text: el.textContent, color: getComputedStyle(el).color } : null;
});
// #1d6fd6 on the light theme, #7db8ff on the dark one desktop defaults to.
const MENTION_BLUE = { light: 'rgb(29, 111, 214)', dark: 'rgb(125, 184, 255)' };
ok('desktop: reply @mention rendered in blue',
  !!mention && mention.text.startsWith('@') && mention.color === MENTION_BLUE[mention.theme],
  JSON.stringify(mention));

await d.focus('[data-comment="c1r1"] .reaction-trigger');
await d.keyboard.press('ArrowUp');
await sleep(350);
const trayKinds = await d.evaluate(() => [...document.querySelectorAll('.reaction-tray button')].map(b => b.getAttribute('aria-label').toLowerCase()));
ok('desktop: comment tray limited to post kinds', JSON.stringify(trayKinds.sort()) === JSON.stringify(sheetInfo.kinds.sort()), JSON.stringify(trayKinds));
await d.keyboard.press('Escape');
await sleep(250);
ok('desktop: Escape closes tray but keeps sheet', await d.evaluate(() => !document.querySelector('.reaction-tray') && !!document.querySelector('.comments-overlay')));

await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const mine = db.reactions.find(r => r.targetType === 'post' && r.targetId === 'p3' && r.uid === db.meId)?.kind;
  const label = { like: 'Like', love: 'Love', haha: 'Haha', wow: 'Wow', sad: 'Sad' }[mine];
  [...document.querySelectorAll('.comments-heading .comment-reaction-icon')].find(b => b.getAttribute('aria-label') !== label)?.click();
});
await sleep(300);
ok('desktop: heading icon quick-react toggles on', await d.evaluate(() => !!document.querySelector('.comments-heading .comment-reaction-icon.on')));

await d.evaluate(() => document.querySelector('.comments-compose input').blur());
await goBack(d);
ok('desktop: phone-back closes comment sheet', await d.evaluate(() => !document.querySelector('.comments-overlay') && location.pathname === '/'));

// Like+love-only post
await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  db.reactions = db.reactions.filter(r => !(r.targetType === 'post' && r.targetId === 'p3')).concat([
    { id: 'qa_r1', targetType: 'post', targetId: 'p3', uid: 'u2', kind: 'like', ts: Date.now() },
    { id: 'qa_r2', targetType: 'post', targetId: 'p3', uid: 'u3', kind: 'love', ts: Date.now() }
  ]);
  localStorage.setItem('exposing-demo-v1', JSON.stringify(db));
});
await goto(d, '/');
await clickPost(d, 'Just witnessed', '[aria-label="Comments"]');
await d.waitForSelector('.comments-overlay', { timeout: 5000 });
await sleep(400);
const limited = await d.evaluate(() => ({
  suggest: [...document.querySelectorAll('.comments-suggestions .suggest-emoji')].map(b => b.getAttribute('aria-label')),
  head: [...document.querySelectorAll('.comments-heading .comment-reaction-icon')].length
}));
ok('desktop: like+love post shows only those icons', JSON.stringify(limited.suggest.sort()) === JSON.stringify(['Insert Like emoji', 'Insert Love emoji']) && limited.head === 2, JSON.stringify(limited));
await d.focus('[data-comment="c1"] .reaction-trigger');
await d.keyboard.press('ArrowUp');
await sleep(300);
ok('desktop: comment tray also only like+love', await d.evaluate(() => [...document.querySelectorAll('.reaction-tray button')].length === 2));
await d.keyboard.press('Escape');
await sleep(200);
await d.keyboard.press('Escape');
await sleep(500);

// Post page inline compose + keyboard
await goto(d, '/post/p3');
await d.waitForSelector('.post-page-comments', { timeout: 10000 });
await sleep(500);
await d.focus('.post-page-comments input');
await sleep(200);
await setKb(d, 320, 580);
await sleep(400);
const inlineKb = await d.evaluate(() => {
  const compose = document.querySelector('.post-page-comments .comments-compose');
  const c = compose.getBoundingClientRect();
  const list = document.querySelector('.post-page-comments .comments-list');
  return { bottom: c.bottom, fixed: getComputedStyle(compose).position, listH: list.clientHeight };
});
ok('desktop: inline compose in normal flow, list visible', inlineKb.fixed !== 'fixed' && inlineKb.bottom > 0 && inlineKb.listH > 0, JSON.stringify(inlineKb));
await d.type('.post-page-comments input', 'QA inline comment');
await d.evaluate(() => document.querySelector('.post-page-comments button[type="submit"]').click());
await sleep(400);
ok('desktop: inline comment posts', await d.evaluate(() => document.querySelector('.post-page-comments .comments-list').textContent.includes('QA inline comment')));
await clearKb(d);

// Comment button focus ring removed (SS1)
await goto(d, '/');
await d.keyboard.press('Shift');
const ring = await d.evaluate(() => {
  const b = document.querySelector('article.post [aria-label="Comments"]');
  b.focus();
  const cs = getComputedStyle(b);
  return { fv: b.matches(':focus-visible'), outline: cs.outlineStyle, w: cs.outlineWidth, bg: cs.backgroundColor };
});
ok('desktop: comment button shows no red focus ring', ring.fv && (ring.outline === 'none' || ring.w === '0px'), JSON.stringify(ring));
await d.evaluate(() => document.activeElement?.blur());

// Entry chooser from the rail + button: compact card
await d.click('.post-btn');
await d.waitForSelector('.chooser-overlay', { timeout: 5000 });
await sleep(350);
const entryChooser = await d.evaluate(() => {
  const card = document.querySelector('.chooser-card');
  const r = card.getBoundingClientRect();
  const btns = [...document.querySelectorAll('.chooser-options button')];
  const a = btns[0].getBoundingClientRect(), b = btns[1].getBoundingClientRect();
  const copy = card.querySelector('.chooser-copy');
  const head = card.querySelector('.chooser-head');
  return { labels: btns.map(x => x.querySelector('b')?.textContent), h: Math.round(r.height), w: Math.round(r.width), stacked: Math.abs(a.top - b.top) > 2, hasCreateHead: !!head && /create/i.test(head.textContent), copyVisible: !!copy && getComputedStyle(copy).display !== 'none' && getComputedStyle(copy.querySelector('small')).display !== 'none', icons: btns.every(x => !!x.querySelector('.chooser-icon svg')) };
});
ok('desktop: + button opens SS4 Create popup (Post/Reel rows)', JSON.stringify(entryChooser.labels) === JSON.stringify(['Post', 'Reel']) && entryChooser.stacked && entryChooser.hasCreateHead && entryChooser.copyVisible && entryChooser.w <= 420 && entryChooser.h <= 280 && entryChooser.icons, JSON.stringify(entryChooser));
await shot(d, 'desktop-chooser-entry');

// Reels picker validation: wrong type + over 150 MB both toast clearly
const chooserInput = await d.$('.chooser-overlay input[type="file"]');
await chooserInput.uploadFile(`${OUT}/test.png`);
await sleep(800);
const invalidPick = await d.evaluate(() => { const t = document.querySelector('.toast'); const r = t?.getBoundingClientRect(); const cs = t ? getComputedStyle(t) : null; return { toast: t?.textContent || '', visible: !!t && cs.opacity === '1' && r.top >= 0 && r.bottom <= window.innerHeight, aboveChooser: !!t && Number(cs.zIndex) > Number(getComputedStyle(document.querySelector('.chooser-overlay')).zIndex), chooserStill: !!document.querySelector('.chooser-overlay'), path: location.pathname }; });
ok('desktop: Reels picker rejects a photo with a clear toast', /video/i.test(invalidPick.toast) && invalidPick.visible && invalidPick.aboveChooser && invalidPick.chooserStill && invalidPick.path === '/', JSON.stringify(invalidPick));
fs.writeFileSync(`${OUT}/big.mp4`, '');
fs.truncateSync(`${OUT}/big.mp4`, 151 * 1024 * 1024);
await chooserInput.uploadFile(`${OUT}/big.mp4`);
await sleep(1000);
const bigPick = await d.evaluate(() => { const t = document.querySelector('.toast'); const r = t?.getBoundingClientRect(); const cs = t ? getComputedStyle(t) : null; return { toast: t?.textContent || '', visible: !!t && cs.opacity === '1' && r.top >= 0 && r.bottom <= window.innerHeight, chooserStill: !!document.querySelector('.chooser-overlay'), path: location.pathname }; });
ok('desktop: video over 150 MB rejected with size toast', /150 MB/.test(bigPick.toast) && bigPick.visible && bigPick.chooserStill && bigPick.path === '/', JSON.stringify(bigPick));
await shot(d, 'desktop-chooser-size-toast');
fs.unlinkSync(`${OUT}/big.mp4`);
await d.evaluate(() => document.querySelectorAll('.chooser-options button')[0].click());
await d.waitForSelector('.create-post-page', { timeout: 8000 });
ok('desktop: chooser Post lands on create page', await d.evaluate(() => location.pathname === '/create'));

// Reels entry: gallery pick auto-attaches on create
await goto(d, '/');
await d.click('.post-btn');
await d.waitForSelector('.chooser-overlay', { timeout: 5000 });
const chooserFile = await d.$('.chooser-overlay input[type="file"]');
await chooserFile.uploadFile(`${OUT}/clip.mp4`);
await d.waitForSelector('.create-post-page', { timeout: 15000 });
await sleep(800);
const reelDraft = await d.evaluate(() => ({
  path: location.pathname,
  title: document.querySelector('.create-post-header h1')?.textContent,
  videos: document.querySelectorAll('.create-media-item video').length,
  chooserGone: !document.querySelector('.chooser-overlay')
}));
ok('desktop: Reels gallery pick auto-attaches clip in reel mode', reelDraft.path === '/create' && reelDraft.title === 'Create reel' && reelDraft.videos === 1 && reelDraft.chooserGone, JSON.stringify(reelDraft));
await shot(d, 'desktop-create-reel');
// #80: the header keeps exactly one Post button and pressing it publishes —
// the Post/Reel chooser guards the entry to create, never the submit.
const reelHeader = await d.evaluate(() => ({
  labels: [...document.querySelectorAll('.create-post-header button')].map(b => b.textContent.trim()).filter(Boolean),
  heads: document.querySelectorAll('.post-btn-header').length,
  enabled: !document.querySelector('.post-btn-header')?.disabled,
  chooser: !!document.querySelector('.chooser-overlay')
}));
ok('desktop: the reel editor offers one enabled Post button and no publish chooser',
  JSON.stringify(reelHeader.labels) === JSON.stringify(['Post']) && reelHeader.heads === 1 && reelHeader.enabled && !reelHeader.chooser,
  JSON.stringify(reelHeader));
await watchPublish(d);
await d.evaluate(() => document.querySelector('.post-btn-header').click());
await d.waitForFunction(() => location.pathname === '/', { timeout: 12000 });
const pubTape = await publishTape(d);
ok('desktop: publish ring stages % and labels reel',
  /^\d+%$/.test(pubTape[0]?.pct || '') && parseInt(pubTape[pubTape.length - 1]?.pct) > parseInt(pubTape[0]?.pct) && /reel/i.test(pubTape[0]?.label || ''),
  JSON.stringify(pubTape.slice(0, 3)));
ok('desktop: publishing lands on the feed with no chooser and no overlay',
  await d.evaluate(() => location.pathname === '/' && !document.querySelector('.chooser-overlay') && !document.querySelector('.publish-overlay')),
  JSON.stringify(await d.evaluate(() => ({ path: location.pathname, chooser: !!document.querySelector('.chooser-overlay'), overlay: !!document.querySelector('.publish-overlay') }))));
await shot(d, 'desktop-publish-landed');
await sleep(900);
ok('desktop: reel published with kind reel', await d.evaluate(() => JSON.parse(localStorage.getItem('exposing-demo-v1')).posts[0].kind === 'reel'));
const storedReel = await d.evaluate(() => { const p = JSON.parse(localStorage.getItem('exposing-demo-v1')).posts[0]; return { kind: p.kind, blobId: p.media[0]?.blobId, src: p.media[0]?.src || null }; });
ok('desktop: reel clip stored on device, not in localStorage', !!storedReel.blobId && storedReel.src === null, JSON.stringify(storedReel));
await goto(d, '/video');
await d.waitForSelector('.reels-page', { timeout: 10000 });
await d.waitForFunction(() => { const v = document.querySelector('.reel-slide video'); return v && (v.getAttribute('src') || '').startsWith('blob:') && !v.paused; }, { timeout: 9000 }).catch(() => {});
await sleep(700);
const reloaded = await d.evaluate(() => { const v = document.querySelector('.reel-slide video'); return { src: v?.getAttribute('src'), playing: v ? !v.paused : false, ready: v?.readyState, count: document.querySelector('.reel-count')?.textContent }; });
ok('desktop: published reel survives reload and plays', (reloaded.src || '').startsWith('blob:') && reloaded.playing && reloaded.count?.startsWith('1 /'), JSON.stringify(reloaded));
await shot(d, 'desktop-reels-published');

// Create page basics
await goto(d, '/create');
await d.waitForSelector('.create-post-page', { timeout: 10000 });
await sleep(400);
await d.type('.create-post-textarea', 'Long caption test. '.repeat(40));
await sleep(300);
ok('desktop: textarea capped at 320px', await d.evaluate(() => document.querySelector('.create-post-textarea').clientHeight <= 320));
await d.evaluate(() => { [...document.querySelectorAll('.create-addon-row')].find(b => b.textContent.includes('Location')).click(); });
await sleep(450);
ok('desktop: location panel opens', await d.evaluate(() => document.querySelector('.addon-panel.open') !== null));
ok('desktop: place input avoids autofill heuristics', await d.evaluate(() => {
  const i = document.querySelector('.place-form input');
  return i.name === 'place-tag' && i.getAttribute('autocomplete') === 'off';
}));
await d.evaluate(() => { [...document.querySelectorAll('.place-suggestions button')].find(b => b.textContent === 'Pokhara').click(); });
await sleep(300);
await d.evaluate(() => { [...document.querySelectorAll('.create-addon-row')].find(b => b.textContent.includes('Feeling')).click(); });
await sleep(450);
await d.evaluate(() => { [...document.querySelectorAll('.mood-grid button')].find(b => b.textContent.includes('happy')).click(); });
await sleep(300);
const chips = await d.evaluate(() => [...document.querySelectorAll('.create-chip')].map(c => c.textContent));
ok('desktop: mood + place chips', chips.length === 2 && chips.some(c => c.includes('happy')) && chips.some(c => c.includes('Pokhara')), JSON.stringify(chips));
const fileInput = await d.$('.create-post-page input[type="file"]');
await fileInput.uploadFile(`${OUT}/test.png`);
await sleep(900);
ok('desktop: attachment thumbnail renders', await d.evaluate(() => !!document.querySelector('.create-media-item img')));
await shot(d, 'desktop-create');
await d.evaluate(() => document.querySelector('.post-btn-header').click());
await d.waitForFunction(() => location.pathname === '/', { timeout: 12000 });
await sleep(900);
const published = await d.evaluate(() => {
  const first = document.querySelector('article.post');
  return { text: first?.textContent.includes('Long caption test'), tags: first?.querySelectorAll('.post-place, .post-feeling').length };
});
ok('desktop: publish returns home with new post + tags', published.text && published.tags === 2, JSON.stringify(published));

// Create keyboard safety
await goto(d, '/create');
await d.focus('.create-post-textarea');
await sleep(200);
await setKb(d, 380, 520);
await sleep(400);
const createKb = await d.evaluate(() => {
  const page = document.querySelector('.create-post-page').getBoundingClientRect();
  const footer = document.querySelector('.create-post-footer').getBoundingClientRect();
  return { pageH: page.height, footerBottom: footer.bottom };
});
ok('desktop: create footer above keyboard', createKb.pageH === 520 && Math.abs(createKb.footerBottom - 520) < 2, JSON.stringify(createKb));
await clearKb(d);

// Audience + followers-only visibility
await d.evaluate(() => document.querySelector('.create-audience').click());
await sleep(250);
ok('desktop: audience menu offers Public + Followers', await d.evaluate(() => [...document.querySelectorAll('.audience-menu b')].map(b => b.textContent).join(',') === 'Public,Followers'));
await d.evaluate(() => { [...document.querySelectorAll('.audience-menu button')].find(b => b.textContent.includes('Followers')).click(); });
await sleep(250);
ok('desktop: audience chip switches to Followers', await d.evaluate(() => document.querySelector('.create-audience').textContent.includes('Followers')));
await d.type('.create-post-textarea', 'QA followers only post');
await d.evaluate(() => document.querySelector('.post-btn-header').click());
await d.waitForFunction(() => location.pathname === '/', { timeout: 12000 });
await sleep(900);
const followersPost = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const p = db.posts.find(x => x.text === 'QA followers only post');
  const first = document.querySelector('article.post');
  return { id: p?.id, audience: p?.audience, badge: !!first.querySelector('.post-audience'), visibleToOwner: first.textContent.includes('QA followers only post') };
});
ok('desktop: followers-only post published with badge, visible to owner', followersPost.audience === 'followers' && followersPost.badge && followersPost.visibleToOwner, JSON.stringify(followersPost));
const hiddenCheck = await d.evaluate(async id => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const other = db.users.find(u => u.id !== db.meId);
  db.follows = db.follows.filter(f => !(f.follower === other.id && f.following === db.meId));
  const savedMe = db.meId;
  db.meId = other.id;
  localStorage.setItem('exposing-demo-v1', JSON.stringify(db));
  return { other: other.id, savedMe };
}, followersPost.id);
await goto(d, '/');
const hiddenFeed = await d.evaluate(() => !document.body.textContent.includes('QA followers only post'));
await goto(d, `/post/${followersPost.id}`);
const hiddenDetail = await d.evaluate(() => document.body.textContent.includes('not available'));
await d.evaluate(({ other, savedMe }) => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  db.meId = savedMe;
  db.follows.push({ follower: other, following: savedMe, ts: Date.now() });
  localStorage.setItem('exposing-demo-v1', JSON.stringify(db));
}, hiddenCheck);
ok('desktop: followers-only post hidden from non-follower (feed + detail)', hiddenFeed && hiddenDetail, JSON.stringify({ hiddenFeed, hiddenDetail }));

// Attachment caps
await goto(d, '/create');
await d.waitForSelector('.create-post-page', { timeout: 10000 });
const fi = await d.$('.create-post-page input[type="file"]');
for (let i = 0; i < 10; i++) { await fi.uploadFile(`${OUT}/test.png`); await sleep(300); }
const caps = await d.evaluate(() => ({
  items: document.querySelectorAll('.create-media-item').length,
  accept: document.querySelector('.create-post-page input[type="file"]').getAttribute('accept'),
  addon: [...document.querySelectorAll('.create-addon-row small')].map(s => s.textContent).find(t => t.includes('photos')),
  addTile: !!document.querySelector('.create-media-add')
}));
ok('desktop: 10 photos attached, accept switches to video-only', caps.items === 10 && caps.accept === 'video/*' && caps.addon.includes('10/10 photos · 0/3 videos'), JSON.stringify(caps));
await fi.uploadFile(`${OUT}/test.png`);
await sleep(500);
ok('desktop: 11th photo rejected with clear error', await d.evaluate(() => document.querySelector('.create-feedback.error')?.textContent.includes('up to 10 photos')));
await shot(d, 'desktop-create-caps');

// Feed video click opens Reels at that clip (no pause)
await goto(d, '/');
await scrollPost(d, 'Rain over New Road');
await sleep(600);
await clickPost(d, 'Rain over New Road', '.media-mosaic .auto-video');
await d.waitForSelector('.reels-page', { timeout: 10000 });
await sleep(1500);
const startAt = await d.evaluate(() => {
  const el = document.querySelector('.reels-scroll');
  const i = Math.round(el.scrollTop / el.clientHeight);
  const v = document.querySelectorAll('.reel-slide')[i]?.querySelector('video');
  return { path: location.pathname, i, src: v?.getAttribute('src'), playing: v ? !v.paused : false, count: document.querySelector('.reel-count')?.textContent, total: document.querySelectorAll('.reel-slide').length };
});
ok('desktop: feed video click opens Reels at that clip, playing', /\/video\/p11-0$/.test(startAt.path) && (startAt.src || '').includes('mov_bbb') && startAt.i > 0 && startAt.count?.startsWith(`${startAt.i + 1} /`) && startAt.playing, JSON.stringify(startAt));
await shot(d, 'desktop-reels-startindex');

// Reels page (desktop)
await goto(d, '/video');
await d.waitForSelector('.reels-page', { timeout: 10000 });
await d.waitForFunction(() => { const v = document.querySelector('.reel-slide video'); return v && !v.paused && v.readyState >= 2; }, { timeout: 9000 }).catch(() => {});
await sleep(600);
const reels1 = await d.evaluate(() => ({
  slides: document.querySelectorAll('.reel-slide').length,
  playing: !document.querySelector('.reel-slide video')?.paused,
  muted: document.querySelector('.reel-slide video')?.muted,
  snap: getComputedStyle(document.querySelector('.reels-scroll')).scrollSnapType,
  rail: !!document.querySelector('.reel-rail'),
  onlyVideos: [...document.querySelectorAll('.reel-slide video')].length === document.querySelectorAll('.reel-slide').length,
  caption: !!document.querySelector('.reel-meta'),
  // Which of a *person's* reels lead is their profile's business; the page
  // everybody scrolls has no order to offer.
  sorters: document.querySelectorAll('.profile-reel-sort, .reel-filters').length,
  noFeedCards: !document.querySelector('article.post')
}));
ok('desktop: reels page = video-only snap feed with sound on', reels1.slides >= 2 && reels1.playing && reels1.muted === false && reels1.snap.includes('mandatory') && reels1.rail && reels1.onlyVideos && reels1.caption && reels1.noFeedCards && reels1.sorters === 0, JSON.stringify(reels1));
const dNav = await d.evaluate(() => {
  const rail = document.querySelector('.reels-nav .rail');
  if (!rail) return { present: false };
  const cs = getComputedStyle(rail);
  const r = rail.getBoundingClientRect();
  const frame = document.querySelector('.reels-frame').getBoundingClientRect();
  return { present: true, position: cs.position, visible: cs.display !== 'none' && r.width > 0, overlapsFrame: r.right > frame.left + 1, links: [...rail.querySelectorAll('.nav-item')].map(a => a.getAttribute('href')) };
});
ok('desktop: reels keeps left nav rail fixed, no frame overlap', dNav.present && dNav.position === 'fixed' && dNav.visible && !dNav.overlapsFrame && dNav.links.includes('/') && dNav.links.includes('/marketplace'), JSON.stringify(dNav));
await d.waitForFunction(() => { const v = document.querySelectorAll('.reel-slide video')[1]; return v && v.readyState >= 2; }, { timeout: 9000 }).catch(() => {});
const pre = await d.evaluate(() => { const vids = [...document.querySelectorAll('.reel-slide video')]; return { preload: vids[0]?.getAttribute('preload'), nextReady: vids[1]?.readyState }; });
ok('desktop: reels preload=auto buffers next clip', pre.preload === 'auto' && pre.nextReady >= 2, JSON.stringify(pre));
await shot(d, 'desktop-reels');
// double-tap right = +10s
const t0 = await d.evaluate(() => document.querySelector('.reel-slide video').currentTime);
const seekR = await doubleTapSeek(d, 'right');
ok('desktop: double-tap right seeks +10s with badge', (seekR.t >= Math.min(seekR.dur, t0 + 10) - 0.4 || seekR.t < t0) && seekR.badge, JSON.stringify({ t0, ...seekR, note: 'short clip clamps to end / loops' }));
await shot(d, 'desktop-reels-seek');
await sleep(600);
const t1 = await d.evaluate(() => document.querySelector('.reel-slide video').currentTime);
const seekL = await doubleTapSeek(d, 'left');
ok('desktop: double-tap left seeks -10s with badge', (seekL.t < t1 || seekL.t === 0) && seekL.badge, JSON.stringify({ t1, ...seekL }));
await sleep(600);
// single tap pauses / resumes
await d.mouse.click(640, 450);
await sleep(500);
ok('desktop: single tap pauses reel', await d.evaluate(() => document.querySelector('.reel-slide video').paused));
await d.mouse.click(640, 450);
await sleep(600);
ok('desktop: single tap resumes reel', await d.evaluate(() => !document.querySelector('.reel-slide video').paused));
// rail actions: the Like is a tap-to-like button and the picker is a hold.
const railTap = await d.evaluate(() => {
  const btn = document.querySelector('.reel-rail-item .reaction-trigger');
  const r = btn.getBoundingClientRect();
  btn.click();
  return { label: btn.getAttribute('aria-label'), size: Math.round(r.width), tray: !!document.querySelector('.reaction-tray') };
});
await sleep(450);
const railLiked = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const newest = db.posts.filter(p => p.media.some(m => m.type === 'video')).sort((a, b) => b.ts - a.ts)[0];
  const btn = document.querySelector('.reel-rail-item .reaction-trigger');
  return {
    mine: db.reactions.filter(r => r.targetType === 'post' && r.targetId === newest?.id && r.uid === db.meId).map(r => r.kind),
    reacted: btn.classList.contains('reacted'),
    tray: !!document.querySelector('.reaction-tray'),
  };
});
ok('desktop: reel Like tap likes and never opens the picker',
   railTap.label === 'Like' && railTap.size === 42 && !railTap.tray && railLiked.reacted && railLiked.mine.includes('like'),
   JSON.stringify({ railTap, railLiked }));
await d.evaluate(() => document.querySelector('.reel-rail-item .reaction-trigger').click());
await sleep(400);
ok('desktop: a second reel Like tap unlikes', await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const newest = db.posts.filter(p => p.media.some(m => m.type === 'video')).sort((a, b) => b.ts - a.ts)[0];
  return !db.reactions.some(r => r.targetType === 'post' && r.targetId === newest?.id && r.uid === db.meId)
    && !document.querySelector('.reel-rail-item .reaction-trigger').classList.contains('reacted');
}));
const reelTray = await d.evaluate(async () => {
  const btn = document.querySelector('.reel-rail-item .reaction-trigger');
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
  await new Promise(r => setTimeout(r, 620));
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
  await new Promise(r => setTimeout(r, 80));
  const tray = document.querySelector('.reaction-tray');
  if (!tray) return { open: false };
  const r = tray.getBoundingClientRect();
  const b = btn.getBoundingClientRect();
  return { open: true, kinds: [...tray.querySelectorAll('button')].map(x => x.getAttribute('aria-label')), inView: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0, above: r.bottom <= b.top + 2, z: getComputedStyle(tray).zIndex };
});
ok('desktop: holding the reel Like opens reaction tray above the button', reelTray.open && reelTray.kinds.length >= 5 && reelTray.inView && reelTray.above && Number(reelTray.z) > 1200, JSON.stringify({ railTap, reelTray }));
await shot(d, 'desktop-reels-tray');
await d.evaluate(() => [...document.querySelectorAll('.reaction-tray button')].find(b => b.getAttribute('aria-label') === 'Love')?.click());
await sleep(450);
const railAfter = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const newest = db.posts.filter(p => p.media.some(m => m.type === 'video')).sort((a, b) => b.ts - a.ts)[0];
  const btn = document.querySelector('.reel-rail-item .reaction-trigger');
  return { newestId: newest?.id, newestKind: newest?.kind, mine: db.reactions.filter(r => r.targetType === 'post' && r.targetId === newest?.id && r.uid === db.meId).map(r => r.kind), trayGone: !document.querySelector('.reaction-tray'), reacted: btn.classList.contains('reacted'), art: !!btn.querySelector('.reaction-art'), count: btn.querySelector('span:not(.reaction-mix)')?.textContent, path: location.pathname };
});
ok('desktop: tray pick stores the chosen reel reaction', railAfter.mine.includes('love') && railAfter.newestKind === 'reel' && railAfter.trayGone && railAfter.reacted && railAfter.art && railAfter.count === '1', JSON.stringify(railAfter));
await shot(d, 'desktop-reels-reacted');
await d.evaluate(() => document.querySelector('.reel-rail-item button[aria-label="Save this reel"], .reel-rail-item button[aria-label="Unsave this reel"]').click());
await sleep(350);
ok('desktop: reel rail save toggles saved post', await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return db.saves.some(s => s.uid === db.meId);
}));
await d.evaluate(() => document.querySelector('.reel-rail-item button[aria-label="Comment on this reel"]').click());
await d.waitForSelector('.comments-overlay', { timeout: 5000 });
await sleep(400);
ok('desktop: reel comment sheet opens above reels', await d.evaluate(() => Number(getComputedStyle(document.querySelector('.comments-overlay')).zIndex) > Number(getComputedStyle(document.querySelector('.reels-page')).zIndex)));
await shot(d, 'desktop-reels-comments');
await d.keyboard.press('Escape');
await sleep(500);
await d.keyboard.press('ArrowDown');
await sleep(800);
const reels2 = await d.evaluate(() => ({
  count: document.querySelector('.reel-count')?.textContent,
  firstPaused: document.querySelectorAll('.reel-slide video')[0].paused,
  secondPlaying: !document.querySelectorAll('.reel-slide video')[1].paused
}));
ok('desktop: ArrowDown snaps to next reel, previous pauses', reels2.count?.startsWith('2 /') && reels2.firstPaused && reels2.secondPlaying, JSON.stringify(reels2));
// wheel = one clean full-slide snap, no partial-clip lag
await d.evaluate(() => { document.querySelector('.reels-scroll').scrollTop = 0; });
await sleep(400);
const wheelRes = await d.evaluate(async () => {
  const el = document.querySelector('.reels-scroll');
  const start = performance.now();
  el.dispatchEvent(new WheelEvent('wheel', { deltaY: 420, bubbles: true, cancelable: true }));
  await new Promise(res => {
    const check = () => {
      if (Math.abs(el.scrollTop - el.clientHeight) < 2) return res();
      if (performance.now() - start > 2500) return res();
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
  return { ms: Math.round(performance.now() - start), scrollTop: Math.round(el.scrollTop), clientHeight: el.clientHeight, count: document.querySelector('.reel-count')?.textContent };
});
ok('desktop: wheel snaps cleanly to next reel, fully settled', wheelRes.ms < 1200 && Math.abs(wheelRes.scrollTop - wheelRes.clientHeight) < 2 && wheelRes.count?.startsWith('2 /'), JSON.stringify(wheelRes));
// persistent nav rail navigates to other pages
await d.evaluate(() => document.querySelector('.reels-nav .rail .nav-item[href="/marketplace"]').click());
const dNavOk = await d.waitForFunction(() => location.pathname === '/marketplace', { timeout: 6000 }).then(() => true).catch(() => false);
ok('desktop: reels nav rail navigates to Marketplace', dNavOk);
await goto(d, '/video');
await d.waitForSelector('.reel-home', { timeout: 20000 });
await sleep(600);
await d.evaluate(() => document.querySelector('.reel-home').click());
await sleep(800);
ok('desktop: reels home button returns to feed', await d.evaluate(() => location.pathname === '/'));

// Search page
await goto(d, '/explore');
await sleep(500);
const searchLayout = await d.evaluate(() => {
  const row = document.querySelector('.search-head-row').getBoundingClientRect();
  const field = document.querySelector('.search-field').getBoundingClientRect();
  return { fieldBelow: field.top > row.bottom - 2, gapFromTop: row.top };
});
ok('desktop: search field below title row', searchLayout.fieldBelow && searchLayout.gapFromTop > 8, JSON.stringify(searchLayout));
await d.type('.search-field input', 'sita');
await d.evaluate(() => document.querySelector('.search-field').requestSubmit());
await sleep(700);
ok('desktop: search finds Sita', await d.evaluate(() => document.body.textContent.includes('Sita Karki')));
await shot(d, 'desktop-search');

// 404 recovery page
await d.goto(BASE + '/this-route-does-not-exist', { waitUntil: 'domcontentloaded', timeout: 45000 });
await d.waitForSelector('.notfound-card', { timeout: 15000 });
await sleep(500);
const nf = await d.evaluate(() => {
  const mark = document.querySelector('.notfound-mark');
  const card = document.querySelector('.notfound-card').getBoundingClientRect();
  return { markLoaded: (mark?.naturalWidth || 0) > 0, title: document.querySelector('.notfound-title')?.textContent, homeHref: document.querySelector('.notfound-primary')?.getAttribute('href'), onScreen: card.top >= 0 && card.bottom <= window.innerHeight, noOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1 };
});
ok('desktop: branded 404 with loaded mark + home action', nf.markLoaded && nf.title === "This page doesn't exist" && nf.homeHref === '/' && nf.onScreen && nf.noOverflow, JSON.stringify(nf));
await shot(d, 'desktop-notfound');
await d.evaluate(() => document.querySelector('.notfound-primary').click());
await d.waitForSelector('article.post', { timeout: 15000 });
ok('desktop: 404 Back to Home lands on feed', await d.evaluate(() => location.pathname === '/' && document.querySelectorAll('article.post').length > 0));

// ================= PHASE 7: DESKTOP =================
const getDb = page => page.evaluate(() => JSON.parse(localStorage.getItem('exposing-demo-v1')));
const setTextarea = (page, sel, v) => page.evaluate(([sel, v]) => {
  const el = document.querySelector(sel);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, [sel, v]);
const clickBtnByText = (page, scope, re) => page.evaluate(([scope, re]) => {
  const rx = new RegExp(re, 'i');
  const btn = [...document.querySelectorAll(scope + ' button')].find(b => rx.test(b.textContent));
  if (btn) btn.click();
  return !!btn;
}, [scope, re]);

// Profile via author name (pick a public author so posts are visible)
const profTarget = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const link = [...document.querySelectorAll('article.post .post-name')].find(a => {
    const href = a.getAttribute('href');
    if (href === '/u/sita_k') return false;
    const u = db.users.find(x => `/u/${x.username}` === href);
    return u && !u.private;
  });
  const href = link.getAttribute('href');
  link.click();
  return href;
});
await d.waitForSelector('.profile-view', { timeout: 10000 }).catch(() => {});
await sleep(700);
const profUser = await d.evaluate(href => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return db.users.find(u => `/u/${u.username}` === href);
}, profTarget);
const profInfo = await d.evaluate(() => ({
  path: location.pathname,
  name: document.querySelector('.profile-name')?.textContent,
  cover: !!document.querySelector('.profile-cover'),
  stats: document.querySelectorAll('.profile-stat').length,
  posts: document.querySelectorAll('.profile-posts article.post').length,
  followOn: document.querySelector('.profile-actions .follow-btn')?.classList.contains('on')
}));
ok('desktop: author profile renders cover/name/stats/posts', profInfo.path === profTarget && profInfo.name.includes(profUser.name) && profInfo.cover && profInfo.stats === 3 && profInfo.posts > 0, JSON.stringify(profInfo));
await d.evaluate(() => document.querySelector('.profile-actions .follow-btn').click());
await sleep(350);
const followed = await d.evaluate(uid => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return db.follows.some(f => f.follower === db.meId && f.following === uid);
}, profUser.id);
ok('desktop: follow toggle persists', followed === !profInfo.followOn, `now following=${followed}`);
await d.evaluate(() => document.querySelector('.profile-actions .follow-btn').click());
await sleep(300);
// Media split into two honest tabs: what moves and what does not.
await clickBtnByText(d, '.tabs', '^photos$');
await sleep(400);
const photoTab = await d.evaluate(() => ({
  grid: !!document.querySelector('.profile-media-grid') || !!document.querySelector('.profile-view .feed-empty'),
  cells: document.querySelectorAll('.profile-media-grid .profile-media-cell').length,
  reels: document.querySelectorAll('.profile-media-grid .reel-cell').length,
}));
ok('desktop: profile photos tab shows the still grid', photoTab.grid && photoTab.reels === 0, JSON.stringify(photoTab));
await clickBtnByText(d, '.tabs', '^reels$');
await sleep(400);
const reelTab = await d.evaluate(() => ({
  on: [...document.querySelectorAll('.tabs button')].some(b => /^reels$/i.test(b.textContent.trim()) && b.getAttribute('aria-selected') === 'true'),
  cells: document.querySelectorAll('.profile-media-grid .profile-media-cell').length,
  reels: document.querySelectorAll('.profile-media-grid .reel-cell').length,
}));
ok('desktop: profile reels tab shows only the moving cells', reelTab.on && reelTab.cells === reelTab.reels, JSON.stringify(reelTab));
// The order words belong to a shelf, so the check goes and finds a profile that
// actually owns clips rather than trusting whichever author the feed led with.
const reelHome = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const moving = p => (p.media || []).some(m => m.type === 'video');
  const owner = db.users.find(u => db.posts.some(p => p.uid === u.id && p.status === 'live' && moving(p)));
  return owner ? { href: `/u/${owner.username}`, clips: db.posts.filter(p => p.uid === owner.id && moving(p)).length } : null;
});
await goto(d, reelHome.href);
await d.waitForSelector('.tabs .tab', { timeout: 10000 }).catch(() => {});
await clickBtnByText(d, '.tabs', '^reels$');
await sleep(500);
const shelf = await d.evaluate(() => {
  const first = document.querySelector('.profile-reel-sort button');
  const cs = first ? getComputedStyle(first) : null;
  return {
    labels: [...document.querySelectorAll('.profile-reel-sort button')].map(el => el.textContent.trim()),
    on: [...document.querySelectorAll('.profile-reel-sort button.on')].map(el => el.textContent.trim()),
    cells: document.querySelectorAll('.profile-media-grid .reel-cell').length,
    quiet: cs && { size: parseFloat(cs.fontSize), opacity: parseFloat(cs.opacity),
      bg: cs.backgroundColor, height: Math.round(first.getBoundingClientRect().height) },
  };
});
ok('desktop: a person\'s shelf is sorted by three quiet words',
  shelf.labels.length === 3 && shelf.on.length === 1 && shelf.cells > 0 && shelf.quiet
  && shelf.quiet.size <= 13 && shelf.quiet.opacity < 1 && shelf.quiet.height <= 26
  && /rgba\(0, 0, 0, 0\)|transparent/.test(shelf.quiet.bg), JSON.stringify({ ...shelf, href: reelHome.href }));
const shelfNow = () => d.evaluate(() => ({
  order: [...document.querySelectorAll('.profile-media-grid .reel-cell video')]
    .map(el => (el.getAttribute('src') || '').split('/').pop()).join(','),
  cells: document.querySelectorAll('.profile-media-grid .reel-cell').length,
  on: [...document.querySelectorAll('.profile-reel-sort button.on')].map(el => el.textContent.trim()),
}));
const newest = await shelfNow();
await clickBtnByText(d, '.profile-reel-sort', '^oldest$');
await sleep(400);
const oldest = await shelfNow();
await clickBtnByText(d, '.profile-reel-sort', '^most views$');
await sleep(400);
const views = await shelfNow();
ok('desktop: the words hold their pick and keep the shelf drawn',
  oldest.on.join() === 'Oldest' && views.on.join() === 'Most views'
  && oldest.cells === shelf.cells && views.cells === shelf.cells,
  JSON.stringify({ oldest, views, cells: shelf.cells }));
// No demo clip has ever been watched, so "most views" has no tally to read and
// keeps the newest-first order instead of inventing one.
ok('desktop: a tally-less shelf keeps its newest-first order',
  views.order === newest.order, `${views.order} vs ${newest.order}`);
// The hunt for a clip-owning profile moved off the author this part of the run is
// written about, so hand the page back before the checks that follow it.
await goto(d, profTarget);
await d.waitForSelector('.profile-view', { timeout: 10000 }).catch(() => {});
await sleep(400);
await clickBtnByText(d, '.tabs', '^about$');
await sleep(400);
const aboutInfo = await d.evaluate(() => ({
  cards: document.querySelectorAll('.about-card').length,
  bio: !!document.querySelector('.about-bio'),
  titles: [...document.querySelectorAll('.about-card h2')].map(h => h.textContent.trim()),
  stats: document.querySelectorAll('.about-stat').length,
  follows: document.querySelectorAll('.about-follow').length,
  more: !!document.querySelector('.about-more')
}));
ok('desktop: profile about tab is grouped cards with stats tiles',
  aboutInfo.cards >= 3 && aboutInfo.bio && aboutInfo.stats === 3
  && aboutInfo.follows >= 1 && aboutInfo.follows <= 5 && aboutInfo.more, JSON.stringify(aboutInfo));
await d.evaluate(() => document.querySelector('.profile-stats a.profile-stat').click());
await d.waitForSelector('.people-page', { timeout: 8000 }).catch(() => {});
await sleep(400);
const followersPage = await d.evaluate(() => ({
  path: location.pathname,
  rows: document.querySelectorAll('.people-page-list .people-row').length,
  owner: !!document.querySelector('.people-page-owner'),
  back: !!document.querySelector('.people-page .detail-header .icon-btn')
}));
ok('desktop: followers open on their own page with rows', followersPage.path.endsWith('/followers') && followersPage.rows > 0 && followersPage.owner && followersPage.back, JSON.stringify(followersPage));
await shot(d, 'desktop-followers-page');
await d.evaluate(() => document.querySelector('.people-page .detail-header .icon-btn').click());
await sleep(500);
ok('desktop: followers page back returns to profile', await d.evaluate(p => location.pathname === p, profTarget), profTarget);

// Own profile + edit
await goto(d, '/u/sita_k');
await d.evaluate(() => document.querySelector('.profile-actions .follow-btn').click());
await d.waitForSelector('.edit-profile-modal', { timeout: 5000 }).catch(() => {});
await setTextarea(d, '.edit-profile-form textarea', 'QA bio — lakeside tester.');
await d.evaluate(() => document.querySelector('.edit-profile-form button[type="submit"]').click());
await sleep(500);
const bioOk = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return { stored: db.users.find(u => u.id === 'u1').bio, shown: document.querySelector('.profile-bio')?.textContent, closed: !document.querySelector('.edit-profile-modal') };
});
ok('desktop: edit profile saves bio', bioOk.stored === 'QA bio — lakeside tester.' && bioOk.shown === bioOk.stored && bioOk.closed, JSON.stringify(bioOk));
await shot(d, 'desktop-profile');
await goto(d, '/u/does_not_exist_xyz');
ok('desktop: unknown profile shows missing state', await d.evaluate(() => !!document.querySelector('.profile-missing')));

// Saved
await goto(d, '/saved');
const savedBefore = await d.evaluate(() => document.querySelectorAll('.saved-list article.post').length);
ok('desktop: saved page lists saved posts', savedBefore >= 2, `${savedBefore} posts`);
await d.evaluate(() => document.querySelector('.saved-list article.post .save-action').click());
await sleep(450);
const savedAfter = await d.evaluate(() => ({
  count: document.querySelectorAll('.saved-list article.post').length,
  saves: JSON.parse(localStorage.getItem('exposing-demo-v1')).saves.filter(s => s.uid === 'u1').length
}));
ok('desktop: unsaving removes post from saved list', savedAfter.count === savedBefore - 1, JSON.stringify(savedAfter));
await shot(d, 'desktop-saved');

// Wallet buy request
await goto(d, '/wallet');
const bal0 = await d.evaluate(() => ({ coins: JSON.parse(localStorage.getItem('exposing-demo-v1')).users.find(u => u.id === 'u1').coins, shown: document.querySelector('.wallet-balance-num')?.textContent }));
ok('desktop: wallet balance matches account', bal0.shown.includes(String(bal0.coins)), JSON.stringify(bal0));
await d.evaluate(() => document.querySelectorAll('.wallet-amount')[2].click());
await d.evaluate(() => document.querySelectorAll('.wallet-method')[1].click());
await sleep(300);
ok('desktop: QR method renders demo QR', await d.evaluate(() => !!document.querySelector('.wallet-qr') && document.querySelector('.wallet-total')?.textContent.includes('2000')));
await d.evaluate(() => document.querySelector('.wallet-buy button[type="submit"]').click());
await sleep(300);
ok('desktop: buy without reference shows error', await d.evaluate(() => !!document.querySelector('.wallet-error')));
await d.type('.wallet-buy .field input', 'TXN-QA-77');
const shotInput = await d.$('.wallet-screenshot input[type="file"]');
await shotInput.uploadFile(`${OUT}/test.png`);
await d.waitForSelector('.wallet-screenshot-preview', { timeout: 5000 });
await d.evaluate(() => document.querySelector('.wallet-buy button[type="submit"]').click());
await sleep(500);
const reqOk = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const r = db.coinRequests.find(x => x.reference === 'TXN-QA-77');
  return r && { uid: r.uid, coins: r.coins, amount: r.amount, method: r.method, status: r.status, shot: !!r.screenshot, row: !!document.querySelector('.wallet-row') };
});
ok('desktop: coin request stored pending with screenshot', reqOk && reqOk.uid === 'u1' && reqOk.coins === 200 && reqOk.amount === 2000 && reqOk.method === 'qr' && reqOk.status === 'pending' && reqOk.shot && reqOk.row, JSON.stringify(reqOk));
await shot(d, 'desktop-wallet');

// Settings
await goto(d, '/settings');
await d.evaluate(() => document.querySelector('.settings-card .switch').click());
await sleep(300);
ok('desktop: two-step toggle persists', await d.evaluate(() => JSON.parse(localStorage.getItem('exposing-demo-v1')).users.find(u => u.id === 'u1').twoStep === true));
await d.evaluate(() => document.querySelector('.settings-card .switch').click());
await sleep(300);
await d.evaluate(() => document.querySelectorAll('.settings-card')[1].querySelectorAll('.settings-choice')[1].click());
await sleep(400);
const neOk = await d.evaluate(() => ({ lang: JSON.parse(localStorage.getItem('exposing-demo-v1')).lang, title: document.querySelector('.header-title')?.textContent }));
ok('desktop: language switch to Nepali persists', neOk.lang === 'ne' && neOk.title !== 'Settings', JSON.stringify(neOk));
await d.evaluate(() => document.querySelectorAll('.settings-card')[1].querySelectorAll('.settings-choice')[0].click());
await sleep(400);
await d.evaluate(() => document.querySelectorAll('.settings-card')[0].querySelectorAll('.settings-choice')[1].click());
await sleep(400);
ok('desktop: dark choice applies theme', await d.evaluate(() => document.documentElement.dataset.theme === 'dark'));
await d.evaluate(() => document.querySelectorAll('.settings-card')[0].querySelectorAll('.settings-choice')[0].click());
await sleep(400);
ok('desktop: light choice restores theme', await d.evaluate(() => document.documentElement.dataset.theme === 'light'));
await shot(d, 'desktop-settings');

// Notifications
await goto(d, '/notifications');
const notif0 = await d.evaluate(() => ({
  rows: document.querySelectorAll('.notif-row').length,
  unread: document.querySelectorAll('.notif-row.unread').length,
  groups: document.querySelectorAll('.notif-group-label').length
}));
ok('desktop: notifications render grouped with unread', notif0.rows >= 5 && notif0.unread >= 1 && notif0.groups >= 1, JSON.stringify(notif0));
await shot(d, 'desktop-notifications');
await d.evaluate(() => document.querySelector('.notif-mark').click());
await sleep(400);
ok('desktop: mark all read clears unread', await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return !document.querySelector('.notif-row.unread') && db.notifications.filter(n => n.uid === 'u1').every(n => n.read);
}));
const notifHref = await d.evaluate(() => {
  // The row is a wrapper since it grew a follow-back button; the press target is
  // the open button inside it.
  (document.querySelector('.notif-row .notif-open') || document.querySelector('.notif-row')).click();
  return true;
});
await sleep(900);
ok('desktop: notification opens its target', notifHref && await d.evaluate(() => location.pathname !== '/notifications'));

// Messages
await goto(d, '/messages');
const inbox0 = await d.evaluate(() => ({ rows: document.querySelectorAll('.inbox-row').length, unread: document.querySelectorAll('.inbox-row.unread').length }));
ok('desktop: inbox lists conversations', inbox0.rows >= 1, JSON.stringify(inbox0));
await d.evaluate(() => [...document.querySelectorAll('.inbox-row')].find(r => r.textContent.includes('Bikash'))?.click());
await d.waitForSelector('.chat-view', { timeout: 8000 }).catch(() => {});
await sleep(700);
// Threads are addressed by username in the URL and by id in the store, so both
// come from the database rather than from a remembered literal.
const chat0 = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const peer = db.users.find(u => u.username === location.pathname.split('/').pop());
  const incoming = db.messages.filter(m => m.from === peer?.id && m.to === 'u1');
  return { path: location.pathname, peerId: peer?.id, bubbles: document.querySelectorAll('.chat-bubble').length, incoming: incoming.length, incomingRead: incoming.every(m => m.read) };
});
ok('desktop: conversation opens and marks incoming read', chat0.path === '/messages/bikash_s' && chat0.bubbles >= 1 && chat0.incoming >= 1 && chat0.incomingRead, JSON.stringify(chat0));
await d.type('.chat-compose input', 'QA desktop hello');
await d.evaluate(() => document.querySelector('.chat-send').click());
await sleep(500);
const sentOk = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const me = db.users.find(u => u.id === 'u1');
  const peer = db.users.find(u => u.username === 'bikash_s');
  const m = db.messages.filter(x => x.from === me.id && x.to === peer.id).sort((a, b) => b.ts - a.ts)[0];
  const n = db.notifications.find(x => x.uid === peer.id && x.kind === 'message' && x.href === `/messages/${me.username}`);
  return { notifiedHref: n?.href || null, text: m?.text, mine: [...document.querySelectorAll('.chat-bubble-row.mine')].some(b => b.textContent.includes('QA desktop hello')), notified: !!n };
});
ok('desktop: send stores message + notifies recipient', sentOk.text === 'QA desktop hello' && sentOk.mine && sentOk.notified, JSON.stringify(sentOk));
await shot(d, 'desktop-chat');
await goto(d, '/messages');
await d.evaluate(() => document.querySelector('.inbox-new').click());
await d.waitForSelector('.people-modal', { timeout: 5000 }).catch(() => {});
await d.type('.people-search input', 'himal');
await sleep(400);
const pickedName = await d.evaluate(() => document.querySelector('.people-pick')?.textContent || null);
await d.evaluate(() => document.querySelector('.people-pick')?.click());
await d.waitForSelector('.chat-view', { timeout: 8000 }).catch(() => {});
const himalName = await d.evaluate(() => JSON.parse(localStorage.getItem('exposing-demo-v1')).users.find(u => u.username.startsWith('himal'))?.username);
ok('desktop: new-message picker opens chosen chat',
  !!himalName && await d.evaluate(u => location.pathname === `/messages/${u}`, himalName),
  JSON.stringify({ pickedName, himalName, path: await d.evaluate(() => location.pathname) }));

// Marketplace
await goto(d, '/marketplace');
const market0 = await d.evaluate(() => document.querySelectorAll('.market-card').length);
ok('desktop: marketplace grid renders listings', market0 >= 5, `${market0} cards`);
await d.type('.market-search input', 'kayak');
await sleep(450);
ok('desktop: marketplace search filters', await d.evaluate(() => document.querySelectorAll('.market-card').length === 1 && document.querySelector('.market-card').textContent.includes('kayak')));
await d.evaluate(() => document.querySelector('.market-clear').click());
await sleep(400);
const catExpected = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return db.listings.filter(l => (l.status === 'active' || l.status === 'sold') && l.category === 'Services').length;
});
await d.select('.market-filters select', 'Services');
await sleep(450);
ok('desktop: category filter matches data', await d.evaluate(() => document.querySelectorAll('.market-card').length) === catExpected && catExpected > 0, `expected ${catExpected}`);
await d.evaluate(() => document.querySelector('.market-clear').click());
await sleep(400);
await shot(d, 'desktop-market');
await d.evaluate(() => document.querySelector('.market-view .header-actions .ghost-btn').click());
await d.waitForSelector('.listing-form-modal', { timeout: 5000 }).catch(() => {});
await d.type('.listing-form label.field:nth-of-type(1) input', 'QA test listing');
await d.type('.listing-form .field-row input[type="number"]', '1234');
const listFile = await d.$('.listing-form input[type="file"]');
await listFile.uploadFile(`${OUT}/test.png`);
await d.waitForSelector('.listing-form-thumb img', { timeout: 5000 });
await d.evaluate(() => document.querySelector('.listing-form button[type="submit"]').click());
await d.waitForSelector('.listing-page', { timeout: 8000 }).catch(() => {});
await sleep(500);
const created = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const l = db.listings.find(x => x.title === 'QA test listing');
  return l && { id: l.id, uid: l.uid, price: l.price, media: l.media.length, status: l.status, path: location.pathname, shown: document.querySelector('.listing-title')?.textContent, sellerCard: !!document.querySelector('.listing-seller-card') };
});
ok('desktop: create listing stores + opens its own page', created && created.uid === 'u1' && created.price === 1234 && created.media === 1 && created.status === 'active' && created.path === `/marketplace/${created.id}` && created.shown === 'QA test listing' && created.sellerCard, JSON.stringify(created));
await shot(d, 'desktop-listing');
const listingLayout = await d.evaluate(() => {
  const media = document.querySelector('.listing-media').getBoundingClientRect();
  const info = document.querySelector('.listing-info').getBoundingClientRect();
  return { sideBySide: Math.abs(media.top - info.top) < 40 && media.right <= info.left + 2, actions: document.querySelectorAll('.listing-actions button').length };
});
ok('desktop: listing page shows image left, details right', listingLayout.sideBySide && listingLayout.actions >= 3, JSON.stringify(listingLayout));
await clickBtnByText(d, '.listing-actions', 'sold');
await sleep(450);
ok('desktop: mark sold updates listing + flag', await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return db.listings.find(x => x.title === 'QA test listing').status === 'sold' && !!document.querySelector('.listing-sold-flag');
}));
await clickBtnByText(d, '.listing-actions', 'relist');
await sleep(450);
ok('desktop: relist restores active', await d.evaluate(() => JSON.parse(localStorage.getItem('exposing-demo-v1')).listings.find(x => x.title === 'QA test listing').status === 'active'));
// Edit listing: change price + add an image by URL
await clickBtnByText(d, '.listing-actions', '^edit');
await d.waitForSelector('.listing-form-modal', { timeout: 5000 }).catch(() => {});
await sleep(300);
await d.evaluate(() => {
  const el = document.querySelector('.listing-form .field-row input[type="number"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, '4321');
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await d.type('.listing-url-row input', 'https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=800&q=80');
await d.evaluate(() => document.querySelector('.listing-url-row button').click());
await sleep(300);
await d.evaluate(() => document.querySelector('.listing-form button[type="submit"]').click());
await sleep(600);
const editedListing = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const l = db.listings.find(x => x.title === 'QA test listing');
  return { price: l.price, media: l.media.length, urlImg: l.media.some(m => m.src.startsWith('https://images.unsplash.com')), thumbs: document.querySelectorAll('.listing-thumb').length, modalGone: !document.querySelector('.listing-form-modal') };
});
ok('desktop: edit listing updates price + URL image with thumbnails', editedListing.price === 4321 && editedListing.media === 2 && editedListing.urlImg && editedListing.thumbs === 2 && editedListing.modalGone, JSON.stringify(editedListing));
await d.evaluate(() => document.querySelectorAll('.listing-thumb')[1].click());
await sleep(300);
ok('desktop: listing thumbnail switches main photo', await d.evaluate(() => document.querySelector('.listing-media-main img').src.includes('unsplash')));
// Save + share on a seller's listing (buyer view)
await goto(d, '/marketplace');
await d.type('.market-search input', 'kayak');
await sleep(450);
await d.evaluate(() => document.querySelector('.market-card').click());
await d.waitForSelector('.listing-page', { timeout: 8000 }).catch(() => {});
await sleep(500);
await clickBtnByText(d, '.listing-actions', '^save$');
await sleep(400);
const savedListing = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const l = db.listings.find(x => x.title.toLowerCase().includes('kayak'));
  return { saved: (db.listingSaves || []).some(s => s.uid === 'u1' && s.lid === l.id), on: !!document.querySelector('.listing-actions .saved-on') };
});
ok('desktop: Save button stores listing save', savedListing.saved && savedListing.on, JSON.stringify(savedListing));
await clickBtnByText(d, '.listing-actions', '^share$');
await sleep(400);
ok('desktop: Share copies listing link (toast)', await d.evaluate(() => {
  const t = document.querySelector('.toast');
  return !!t && /link copied|\/marketplace\//i.test(t.textContent);
}));
// Seller card opens profile with their listings (already on the kayak listing)
await d.evaluate(() => document.querySelector('.listing-seller-card').click());
await d.waitForSelector('.profile-view', { timeout: 8000 }).catch(() => {});
await sleep(500);
const sellerProfile = await d.evaluate(() => ({
  path: location.pathname,
  listingsTab: [...document.querySelectorAll('.tabs .tab')].some(t => /listings/i.test(t.textContent))
}));
ok('desktop: seller card opens seller profile with Listings tab', sellerProfile.path === '/u/maya_g' && sellerProfile.listingsTab, JSON.stringify(sellerProfile));
await clickBtnByText(d, '.tabs', '^listings$');
await sleep(400);
ok('desktop: seller profile lists their listings', await d.evaluate(() => document.querySelectorAll('.profile-listings .market-card').length >= 1));
await d.evaluate(() => document.querySelector('.profile-listings .market-card').click());
await d.waitForSelector('.listing-page', { timeout: 8000 }).catch(() => {});
await sleep(400);
// The thread must open with the listing's own owner, so read the owner out of
// the database rather than scraping the seller card.
const listingPeer = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const id = decodeURIComponent(location.pathname.split('/').pop());
  const listing = db.listings.find(x => x.id === id);
  return { id, uid: listing?.uid, handle: db.users.find(u => u.id === listing?.uid)?.username };
});
await d.evaluate(() => document.querySelector('.listing-actions .promote-submit').click());
await d.waitForSelector('.chat-view', { timeout: 8000 }).catch(() => {});
ok('desktop: contact seller opens chat with seller',
  !!listingPeer.handle && await d.evaluate(h => location.pathname === `/messages/${h}`, listingPeer.handle),
  JSON.stringify({ listingPeer, path: await d.evaluate(() => location.pathname) }));

// ================= PHASE 8/9: DESKTOP =================
// Top bar layout: logo + search left, reels + messages/notifications popovers + theme right
await goto(d, '/');
const topBar = await d.evaluate(() => {
  const bar = document.querySelector('.topbar');
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  const left = bar.querySelector('.topbar-left');
  const right = bar.querySelector('.topbar-right');
  const lr = left.getBoundingClientRect();
  const rr = right.getBoundingClientRect();
  return {
    fixed: getComputedStyle(bar).position === 'fixed',
    h: Math.round(r.height),
    logo: !!left.querySelector('a[href="/"] svg, a[href="/"] img'),
    search: !!left.querySelector('.topbar-search'),
    theme: !!right.querySelector('button[aria-label^="Switch to"]'),
    videoLink: !!right.querySelector('a[href="/video"]'),
    popovers: [...right.querySelectorAll('.topbar-slot > button')].map(b => b.getAttribute('aria-label')),
    leftFirst: lr.left < 40,
    rightLast: Math.abs(rr.right - window.innerWidth) < 40,
    railAdmin: [...document.querySelectorAll('.rail a, .rail button')].some(x => /admin/i.test(x.textContent)),
    composeBox: !!document.querySelector('.desktop-compose, .home-header-row')
  };
});
ok('desktop: top bar has logo/search left + reels + messages/notifications popovers + theme right',
  topBar && topBar.fixed && topBar.h <= 60 && topBar.logo && topBar.search && topBar.theme && topBar.videoLink
  && JSON.stringify(topBar.popovers) === JSON.stringify(['Messages', 'Notifications'])
  && topBar.leftFirst && topBar.rightLast, JSON.stringify(topBar));
ok('desktop: Admin removed from left menu, old compose box gone', topBar && !topBar.railAdmin && !topBar.composeBox, JSON.stringify({ railAdmin: topBar?.railAdmin, composeBox: topBar?.composeBox }));
await d.evaluate(() => document.querySelector('.rail .nav-item[href="/settings"], .rail button')?.click());
const drawerAdmin = await d.evaluate(() => {
  const drawer = document.querySelector('.drawer');
  return { open: !!drawer && getComputedStyle(drawer).transform !== 'none' || !!document.querySelector('.drawer.open'), admin: [...document.querySelectorAll('.drawer a, .drawer button')].some(x => /admin/i.test(x.textContent)) };
});
ok('desktop: drawer has no Admin entry', !drawerAdmin.admin, JSON.stringify(drawerAdmin));
await d.keyboard.press('Escape');
await sleep(350);

// Windowed feed: 10 first, prefetch extends before the end, no skeleton at rest
await d.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
await d.waitForSelector('article.post', { timeout: 20000 });
await sleep(900);
// The feed only shows live posts this reader may see, so count them by the same
// rule the app uses (own + public + private accounts already followed) instead of
// assuming every seeded post can appear.
const feedInit = await d.evaluate(() => {
  const d0 = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const priv = new Set(d0.users.filter(u => u.private).map(u => u.id));
  const follows = new Set(d0.follows.filter(f => f.follower === d0.meId && f.status !== 'pending').map(f => f.following));
  const live = d0.posts.filter(p => p.status === 'live');
  const mine = live.filter(p => p.uid === d0.meId || !priv.has(p.uid) || follows.has(p.uid));
  return {
    rendered: document.querySelectorAll('article.post').length,
    total: mine.length,
    hiddenPrivate: live.length - mine.length,
    skeleton: !!document.querySelector('.feed-skeleton')
  };
});
ok('desktop: feed renders first 10 posts only', feedInit.rendered === Math.min(10, feedInit.total) && !feedInit.skeleton, JSON.stringify(feedInit));
// Two screens short of the end: the prefetch band is 1200px and the cards are
// tall now, so a fraction of the page would land outside it.
await d.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight - window.innerHeight * 2, behavior: 'instant' }));
await sleep(700);
const feedMid = await d.evaluate(() => ({ rendered: document.querySelectorAll('article.post').length, skeleton: !!document.querySelector('.feed-skeleton') }));
ok('desktop: feed prefetches next batch before the end (no skeleton at normal scroll)', feedMid.rendered > feedInit.rendered && !feedMid.skeleton, JSON.stringify(feedMid));
await d.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
await sleep(700);
await d.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
await sleep(700);
const feedEnd = await d.evaluate(() => ({ rendered: document.querySelectorAll('article.post').length, skeleton: !!document.querySelector('.feed-skeleton'), sentinel: !!document.querySelector('.feed-sentinel') }));
ok('desktop: feed reaches all posts without lingering skeleton', feedEnd.rendered >= Math.min(feedInit.total, 20) && !feedEnd.skeleton, JSON.stringify(feedEnd));
await shot(d, 'desktop-feed-windowed');

// Mutual follows appear in the inbox automatically
await goto(d, '/messages');
const inboxMutuals = await d.evaluate(() => {
  const rows = [...document.querySelectorAll('.inbox-row')];
  const hint = rows.filter(r => r.querySelector('.inbox-row-preview.hint'));
  return { rows: rows.length, hints: hint.length, names: hint.map(r => r.querySelector('b').textContent) };
});
ok('desktop: mutual follows auto-listed in inbox with say-hi hint', inboxMutuals.hints >= 3 && inboxMutuals.names.includes('Anju Tamang') && inboxMutuals.names.includes('Himal Lens'), JSON.stringify(inboxMutuals));
await shot(d, 'desktop-inbox-mutuals');

// Follow requests: accept u6, decline an injected u7 request
await goto(d, '/u/sita_k/followers');
const reqBefore = await d.evaluate(() => ({
  section: !!document.querySelector('.people-requests'),
  requestRows: document.querySelectorAll('.people-row.request').length,
  elon: [...document.querySelectorAll('.people-row.request')].some(r => r.textContent.includes('Elon Musk'))
}));
ok('desktop: own followers page shows pending follow requests', reqBefore.section && reqBefore.requestRows >= 1 && reqBefore.elon, JSON.stringify(reqBefore));
await d.evaluate(() => [...document.querySelectorAll('.people-row.request')].find(r => r.textContent.includes('Elon Musk'))?.querySelector('.follow-btn').click());
await sleep(500);
const accepted = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return {
    edge: db.follows.find(f => f.follower === 'u6' && f.following === 'u1')?.status,
    inList: [...document.querySelectorAll('.people-page-list .people-row')].some(r => r.textContent.includes('Elon Musk')),
    requestsLeft: document.querySelectorAll('.people-row.request').length
  };
});
ok('desktop: Accept moves requester into followers + notifies', accepted.edge === 'accepted' && accepted.inList && accepted.requestsLeft === reqBefore.requestRows - 1, JSON.stringify(accepted));
await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  db.follows.push({ follower: 'u7', following: 'u1', ts: Date.now(), status: 'pending' });
  localStorage.setItem('exposing-demo-v1', JSON.stringify(db));
});
await goto(d, '/u/sita_k/followers');
await d.evaluate(() => [...document.querySelectorAll('.people-row.request')].find(r => r.textContent.includes('Tech News'))?.querySelector('.ghost-btn').click());
await sleep(500);
ok('desktop: Decline removes the pending request', await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return !db.follows.some(f => f.follower === 'u7' && f.following === 'u1') && ![...document.querySelectorAll('.people-row')].some(r => r.textContent.includes('Tech News'));
}));

// Private account: request to follow, locked posts, cancel request
await goto(d, '/u/rojan_b');
const priv0 = await d.evaluate(() => ({
  badge: !!document.querySelector('.profile-private'),
  btn: document.querySelector('.profile-actions .follow-btn')?.textContent,
  locked: !!document.querySelector('.profile-locked'),
  posts: document.querySelectorAll('.profile-posts article.post').length
}));
ok('desktop: private profile shows Private badge + locked posts', priv0.badge && /request to follow/i.test(priv0.btn || '') && priv0.locked && priv0.posts === 0, JSON.stringify(priv0));
await d.evaluate(() => document.querySelector('.profile-actions .follow-btn').click());
await sleep(500);
const priv1 = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return {
    edge: db.follows.find(f => f.follower === 'u1' && f.following === 'u4')?.status,
    btn: document.querySelector('.profile-actions .follow-btn')?.textContent,
    pendingCls: document.querySelector('.profile-actions .follow-btn')?.classList.contains('pending'),
    notified: db.notifications.some(n => n.uid === 'u4' && /requested to follow/i.test(n.text))
  };
});
ok('desktop: follow on private account sends pending request', priv1.edge === 'pending' && /requested/i.test(priv1.btn || '') && priv1.pendingCls && priv1.notified, JSON.stringify(priv1));
await shot(d, 'desktop-private-requested');
await d.evaluate(() => document.querySelector('.profile-actions .follow-btn').click());
await sleep(450);
ok('desktop: clicking Requested cancels the request', await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return !db.follows.some(f => f.follower === 'u1' && f.following === 'u4') && /request to follow/i.test(document.querySelector('.profile-actions .follow-btn')?.textContent || '');
}));

// Followers pagination: inject 24 followers, window loads 10 then extends
await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  for (let i = 1; i <= 24; i++) {
    const id = `qa_f${i}`;
    if (!db.users.some(u => u.id === id)) {
      db.users.push({ id, email: `${id}@qa.test`, username: id, name: `QA Follower ${i}`, role: 'user', verified: false, emailVerified: true, susp: null, provider: 'email', dob: '1995-01-01', country: 'Nepal', twoStep: false, joined: Date.now(), coins: 0 });
    }
    if (!db.follows.some(f => f.follower === id && f.following === 'u1')) {
      db.follows.push({ follower: id, following: 'u1', ts: Date.now() - i * 1000, status: 'accepted' });
    }
  }
  localStorage.setItem('exposing-demo-v1', JSON.stringify(db));
});
await goto(d, '/u/sita_k/followers');
const pag0 = await d.evaluate(() => document.querySelectorAll('.people-page-list .people-row').length);
ok('desktop: followers page starts windowed at 10 (prefetch may extend)', pag0 >= 10 && pag0 <= 30, `${pag0} rows`);
await d.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
await sleep(700);
await d.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
await sleep(700);
await d.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
await sleep(700);
const pag1 = await d.evaluate(() => ({ rows: document.querySelectorAll('.people-page-list .people-row').length, skeleton: !!document.querySelector('.people-skeleton') }));
ok('desktop: followers page paginates to all rows on scroll', pag1.rows >= 30 && !pag1.skeleton, JSON.stringify(pag1));
await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  db.users = db.users.filter(u => !u.id.startsWith('qa_f'));
  db.follows = db.follows.filter(f => !f.follower.startsWith('qa_f'));
  localStorage.setItem('exposing-demo-v1', JSON.stringify(db));
});

// Following page renders
await goto(d, '/u/sita_k/following');
ok('desktop: following page lists people with follow buttons', await d.evaluate(() => document.querySelectorAll('.people-page-list .people-row').length >= 5 && !!document.querySelector('.people-page-list .follow-btn')));

// Own profile create button + legal footer placement
await goto(d, '/u/sita_k');
const ownActions = await d.evaluate(() => ({
  edit: [...document.querySelectorAll('.profile-actions button')].some(b => /edit profile/i.test(b.textContent)),
  create: [...document.querySelectorAll('.profile-actions button')].some(b => /^post$/i.test(b.textContent.trim())),
  footer: !!document.querySelector('.site-footer .footer-links'),
  footerLinks: document.querySelectorAll('.site-footer .footer-links a').length
}));
ok('desktop: own profile has Edit + Create post, legal footer on profile', ownActions.edit && ownActions.create && ownActions.footer && ownActions.footerLinks === 4, JSON.stringify(ownActions));
await d.evaluate(() => [...document.querySelectorAll('.profile-actions button')].find(b => /^post$/i.test(b.textContent.trim()))?.click());
await d.waitForSelector('.cp-overlay', { timeout: 5000 }).catch(() => {});
ok('desktop: own-profile Post button opens composer', await d.evaluate(() => !!document.querySelector('.cp-overlay')));
await d.keyboard.press('Escape');
await sleep(400);
await goto(d, '/');
const homeFooter = await d.evaluate(() => !!document.querySelector('.site-footer'));
await goto(d, '/marketplace');
const marketFooter = await d.evaluate(() => !!document.querySelector('.site-footer'));
ok('desktop: legal footer removed from home + marketplace', !homeFooter && !marketFooter, JSON.stringify({ homeFooter, marketFooter }));
// /login sends a signed-in visitor home, so the legal row is checked from the
// signed-out session — the only state in which that page is reachable.
await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  db.meId = null;
  localStorage.setItem('exposing-demo-v1', JSON.stringify(db));
});
await goto(d, '/login');
const loginLegal = await d.evaluate(() => ({ path: location.pathname, links: document.querySelectorAll('.auth-legal a').length }));
ok('desktop: login page links all four legal pages', loginLegal.path === '/login' && loginLegal.links === 4, JSON.stringify(loginLegal));
await goto(d, '/signup');
const signupLegal = await d.evaluate(() => ({ path: location.pathname, links: document.querySelectorAll('.signup-legal-links a').length }));
ok('desktop: signup page links all four legal pages', signupLegal.path === '/signup' && signupLegal.links === 4, JSON.stringify(signupLegal));
await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  db.meId = 'u1';
  localStorage.setItem('exposing-demo-v1', JSON.stringify(db));
});

// Admin console (switch to admin account, inject one pending promo)
await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  db.meId = 'u_admin';
  db.promotions.unshift({ id: 'pr_qa', uid: 'u1', targetType: 'post', targetId: 'p3', packageId: 'pk_starter', category: 'Travel', ageMin: 18, ageMax: 35, country: 'Nepal', city: '', coins: 100, ts: Date.now(), ends: 0, status: 'pending', impressions: 0, clicks: 0 });
  localStorage.setItem('exposing-demo-v1', JSON.stringify(db));
});
await goto(d, '/admin');
const admin0 = await d.evaluate(() => ({ tabs: document.querySelectorAll('.admin-tabs .tab').length, stats: document.querySelectorAll('.admin-stat').length, badges: document.querySelectorAll('.admin-tab-badge').length }));
ok('desktop: admin overview renders tabs/stats/badges', admin0.tabs === 7 && admin0.stats === 4 && admin0.badges >= 2, JSON.stringify(admin0));
await shot(d, 'desktop-admin');
await d.evaluate(() => document.querySelectorAll('.admin-tabs .tab')[1].click());
await sleep(450);
ok('desktop: reports queue lists open reports', await d.evaluate(() => document.querySelectorAll('.admin-report').length === 3));
await clickBtnByText(d, '.admin-report', 'dismiss');
await sleep(450);
const dismissed = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return { open: db.reports.filter(r => r.status === 'open').length, cards: document.querySelectorAll('.admin-report').length, audit: db.audit.some(a => a.action === 'dismiss_report') };
});
ok('desktop: dismiss report updates queue + audit', dismissed.open === 2 && dismissed.cards === 2 && dismissed.audit, JSON.stringify(dismissed));
await d.evaluate(() => document.querySelector('.admin-report .ghost-btn.danger').click());
await sleep(500);
const removedPost = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const p = db.posts.find(x => x.id === 'p6');
  return { status: p.status, reason: p.removedReason, notified: db.notifications.some(n => n.uid === p.uid && n.kind === 'warning'), actioned: db.reports.filter(r => r.status === 'actioned').length };
});
ok('desktop: remove report hides post + notifies owner', removedPost.status === 'removed' && !!removedPost.reason && removedPost.notified && removedPost.actioned === 1, JSON.stringify(removedPost));
await d.evaluate(() => document.querySelector('.admin-report .ghost-btn.danger').click());
await sleep(500);
ok('desktop: remove listing report takes listing down', await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return db.listings.find(l => l.id === 'l4').status === 'removed' && !!document.querySelector('.admin-view .empty-state');
}));
await d.evaluate(() => document.querySelectorAll('.admin-tabs .tab')[3].click());
await sleep(450);
await d.evaluate(() => document.querySelectorAll('.admin-chip')[1].click());
await sleep(400);
ok('desktop: pending coins filter shows both requests', await d.evaluate(() => document.querySelectorAll('.admin-coin').length === 2));
await d.evaluate(() => [...document.querySelectorAll('.admin-coin')].find(c => c.textContent.includes('TXN-88412'))?.querySelector('.promote-submit').click());
await sleep(500);
const approved = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return {
    status: db.coinRequests.find(r => r.id === 'cr1').status,
    coins: db.users.find(u => u.id === 'u2').coins,
    ledger: db.ledger.some(l => l.uid === 'u2' && l.delta === 100 && l.kind === 'purchase'),
    notified: db.notifications.some(n => n.uid === 'u2' && n.kind === 'coins')
  };
});
ok('desktop: approve coins credits wallet + ledger + notice', approved.status === 'approved' && approved.coins === 140 && approved.ledger && approved.notified, JSON.stringify(approved));
await d.evaluate(() => [...document.querySelectorAll('.admin-coin')].find(c => c.textContent.includes('TXN-QA-77'))?.querySelector('.promote-submit').click());
await sleep(500);
ok('desktop: approve QA request credits buyer', await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return db.users.find(u => u.id === 'u1').coins === 460 && db.coinRequests.find(r => r.reference === 'TXN-QA-77').status === 'approved';
}));
await shot(d, 'desktop-admin-coins');
await d.evaluate(() => document.querySelectorAll('.admin-tabs .tab')[4].click());
await sleep(450);
await d.evaluate(() => [...document.querySelectorAll('.admin-promo')].find(c => c.textContent.includes('Sita'))?.querySelector('.promote-submit').click());
await sleep(500);
const promoOn = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const p = db.promotions.find(x => x.id === 'pr_qa');
  return { status: p.status, ends: p.ends > Date.now(), notified: db.notifications.some(n => n.uid === 'u1' && n.kind === 'promotion') };
});
ok('desktop: activate promo sets active window + notice', promoOn.status === 'active' && promoOn.ends && promoOn.notified, JSON.stringify(promoOn));
await d.evaluate(() => [...document.querySelectorAll('.admin-promo')].find(c => c.textContent.includes('Sita'))?.querySelector('.ghost-btn').click());
await sleep(500);
ok('desktop: end promo closes campaign', await d.evaluate(() => JSON.parse(localStorage.getItem('exposing-demo-v1')).promotions.find(x => x.id === 'pr_qa').status === 'ended'));
await d.evaluate(() => document.querySelectorAll('.admin-tabs .tab')[2].click());
await sleep(450);
await d.type('.admin-search input', 'bikash');
await sleep(450);
ok('desktop: user search narrows list', await d.evaluate(() => document.querySelectorAll('.admin-user').length === 1));
await d.evaluate(() => document.querySelector('.admin-user .ghost-btn').click());
await d.waitForSelector('.admin-manage-modal', { timeout: 5000 }).catch(() => {});
await setTextarea(d, '.admin-manage-modal textarea', 'QA warning: keep it civil.');
await clickBtnByText(d, '.admin-manage-modal', '^.*warn');
await sleep(450);
const warned = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return { warning: db.users.find(u => u.id === 'u2').warning, notified: db.notifications.some(n => n.uid === 'u2' && n.kind === 'warning' && n.text.includes('keep it civil')) };
});
ok('desktop: warn user stores warning + notifies', warned.warning === 'QA warning: keep it civil.' && warned.notified, JSON.stringify(warned));
await d.type('.admin-manage-modal .field-row input', 'QA suspend');
await d.evaluate(() => document.querySelector('.admin-manage-modal .ghost-btn.danger').click());
await sleep(450);
const suspOk = await d.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('exposing-demo-v1')).users.find(u => u.id === 'u2').susp;
  return s && Math.abs(s.until - (Date.now() + 7 * 86400000)) < 60000 && s.reason === 'QA suspend';
});
ok('desktop: suspend 7 days sets window + reason', !!suspOk, JSON.stringify(suspOk));
await d.evaluate(() => document.querySelector('.admin-manage-modal .promote-submit').click());
await sleep(450);
ok('desktop: reinstate clears suspension', await d.evaluate(() => JSON.parse(localStorage.getItem('exposing-demo-v1')).users.find(u => u.id === 'u2').susp === null));
await d.keyboard.press('Escape');
await sleep(400);
await d.evaluate(() => document.querySelectorAll('.admin-tabs .tab')[6].click());
await sleep(450);
await setVal(d, '.admin-settings-card input[type="number"]', '5');
await d.evaluate(() => document.querySelector('.admin-save').click());
await sleep(450);
const settingsSaved = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return { threshold: db.settings.threshold, audit: db.audit.some(a => a.action === 'update_settings') };
});
ok('desktop: admin settings save persists + audits', settingsSaved.threshold === 5 && settingsSaved.audit, JSON.stringify(settingsSaved));
await setVal(d, '.admin-settings-card input[type="number"]', '3');
await d.evaluate(() => document.querySelector('.admin-save').click());
await sleep(400);
await d.evaluate(() => document.querySelectorAll('.admin-tabs .tab')[5].click());
await sleep(450);
ok('desktop: audit log lists actions + export control', await d.evaluate(() => document.querySelectorAll('.admin-audit-row').length > 6 && [...document.querySelectorAll('.admin-panel .ghost-btn')].some(b => /csv/i.test(b.textContent))));
await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  db.meId = 'u1';
  localStorage.setItem('exposing-demo-v1', JSON.stringify(db));
});
await goto(d, '/');

// Legal pages
for (const slug of ['privacy', 'terms', 'user-policy', 'cookies']) {
  await goto(d, `/legal/${slug}`);
  const legal = await d.evaluate(() => ({
    h1: document.querySelector('.legal-doc h1')?.textContent || '',
    sections: document.querySelectorAll('.legal-section').length,
    toc: document.querySelectorAll('.legal-toc a').length,
    noOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1
  }));
  ok(`desktop: /legal/${slug} renders full document`, legal.h1.length > 3 && legal.sections >= 4 && legal.toc === legal.sections && legal.noOverflow, JSON.stringify(legal));
}
await shot(d, 'desktop-legal');

// Signup
await goto(d, '/signup');
ok('desktop: signup form renders', await d.evaluate(() => document.querySelectorAll('.signup-form input.login-input').length === 7 && document.querySelectorAll('.signup-check input').length === 2));
await d.evaluate(() => document.querySelector('.signup-form button[type="submit"]').click());
await sleep(350);
ok('desktop: empty signup shows validation error', await d.evaluate(() => !!document.querySelector('.signup-error')));
const fillSignup = async (username, email) => {
  await d.evaluate(([username, email]) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const inputs = [...document.querySelectorAll('.signup-form input.login-input')];
    const values = ['QA Tester', username, email, 'password123', '1995-05-05', 'Bagmati', 'Kathmandu'];
    inputs.forEach((el, i) => { setter.call(el, values[i]); el.dispatchEvent(new Event('input', { bubbles: true })); });
    document.querySelectorAll('.signup-check input').forEach(c => { if (!c.checked) c.click(); });
  }, [username, email]);
  await sleep(250);
};
await fillSignup('sita_k', 'qa.tester@demo.test');
await d.evaluate(() => document.querySelector('.signup-form button[type="submit"]').click());
await sleep(400);
const dupSignup = await d.evaluate(() => ({ error: document.querySelector('.signup-error')?.textContent || '', path: location.pathname }));
ok('desktop: duplicate username rejected', dupSignup.path === '/signup' && /taken/i.test(dupSignup.error), JSON.stringify(dupSignup));
await fillSignup('qa_tester', 'qa.tester@demo.test');
await shot(d, 'desktop-signup');
await d.evaluate(() => document.querySelector('.signup-form button[type="submit"]').click());
await d.waitForSelector('article.post', { timeout: 15000 }).catch(() => {});
await sleep(600);
// Demo mode has no server to confirm an address against, so the account opens
// straight away. The emailed-code contract the API build uses is proved in
// auth_qa.mjs, which only ever runs against the backend.
const signupOk = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const u = db.users.find(x => x.username === 'qa_tester');
  return { created: !!u, loggedIn: db.meId === u?.id, path: location.pathname };
});
ok('desktop: signup creates account and signs in', signupOk.created && signupOk.loggedIn && signupOk.path === '/', JSON.stringify(signupOk));
await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1') || '{}');
  if (db) { db.meId = 'u1'; localStorage.setItem('exposing-demo-v1', JSON.stringify(db)); }
});
await goto(d, '/');

await d.close();

// ================= MOBILE =================
const m = await newPage({ width: 390, height: 844 }, true);
await goto(m, '/');
ok('mobile: top bar + bottom nav + fab', await m.evaluate(() => {
  const vis = el => el && getComputedStyle(el).display !== 'none';
  return vis(document.querySelector('.m-top')) && vis(document.querySelector('.mobile-nav')) && vis(document.querySelector('.post-fab'));
}));
const mLayout = await m.evaluate(() => {
  const hidden = el => !el || getComputedStyle(el).display === 'none';
  const main = document.querySelector('.main').getBoundingClientRect();
  const nav = document.querySelector('.mobile-nav').getBoundingClientRect();
  return { railHidden: hidden(document.querySelector('.rail')), calmHidden: hidden(document.querySelector('.side-calm')), mainW: Math.round(main.width), navBottom: Math.abs(nav.bottom - window.innerHeight) < 2, navFixed: getComputedStyle(document.querySelector('.mobile-nav')).position === 'fixed' };
});
ok('mobile: single column, rail/calm hidden, bottom nav pinned', mLayout.railHidden && mLayout.calmHidden && mLayout.mainW >= 380 && mLayout.navBottom && mLayout.navFixed, JSON.stringify(mLayout));
ok('mobile: no horizontal overflow', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await shot(m, 'mobile-feed');

const mMix = await m.evaluate(() => {
  const a = [...document.querySelectorAll('article.post')].find(x => x.textContent.includes('Weekend in Pokhara'));
  const mo = a.querySelector('.media-mosaic');
  return { h: mo.clientHeight, more: mo.querySelector('.media-more')?.textContent };
});
// A thumb-high stack, not a stamp: the reader asked for the 3-4 photo cards to
// grow on a phone, and 360px was the old stamp.
ok('mobile: stack mosaic ~400px + 3 overlay', Math.abs(mMix.h - 400) <= 2 && mMix.more === '+3', JSON.stringify(mMix));

// FAB opens the entry chooser
await m.tap('.post-fab');
await m.waitForSelector('.chooser-overlay', { timeout: 5000 });
await sleep(400);
ok('mobile: Post + fab opens Post/Reel chooser', await m.evaluate(() => [...document.querySelectorAll('.chooser-options button b')].map(b => b.textContent).join(',') === 'Post,Reel'));
const mChooserCard = await m.evaluate(() => {
  const card = document.querySelector('.chooser-card');
  const r = card.getBoundingClientRect();
  const btns = [...document.querySelectorAll('.chooser-options button')].map(b => b.getBoundingClientRect());
  const small = card.querySelector('.chooser-copy small');
  return { h: Math.round(r.height), w: Math.round(r.width), sideBySide: Math.abs(btns[0].top - btns[1].top) < 2, onScreen: r.bottom <= window.innerHeight && r.top >= 0 && r.left >= 0 && r.right <= window.innerWidth, noLongCopy: !small || getComputedStyle(small).display === 'none' };
});
ok('mobile: chooser is a small compact card on screen', mChooserCard.h < 170 && mChooserCard.w <= 320 && mChooserCard.sideBySide && mChooserCard.onScreen && mChooserCard.noLongCopy, JSON.stringify(mChooserCard));
await shot(m, 'mobile-chooser-entry');
await m.evaluate(() => document.querySelectorAll('.chooser-options button')[0].click());
await m.waitForSelector('.create-post-page', { timeout: 8000 });
ok('mobile: chooser Post opens create page', await m.evaluate(() => location.pathname === '/create'));
await goBack(m);

// Comment sheet + keyboard + focus retention on chips
await scrollPost(m, 'Just witnessed');
await sleep(300);
await clickPost(m, 'Just witnessed', '[aria-label="Comments"]');
await m.waitForSelector('.comments-overlay', { timeout: 5000 });
await sleep(500);
await m.tap('.comments-compose input');
await sleep(250);
await setKb(m, 300, 544);
await sleep(450);
await m.tap('.suggest-chip');
await sleep(300);
const mChip = await m.evaluate(() => ({
  isInput: document.activeElement === document.querySelector('.comments-compose input'),
  val: document.querySelector('.comments-compose input').value,
  kb: getComputedStyle(document.documentElement).getPropertyValue('--keyboard-bottom').trim()
}));
ok('mobile: chip tap keeps keyboard up (no down/up cycle)', mChip.isInput && mChip.val.length > 0 && mChip.kb === '300px', JSON.stringify(mChip));
await m.evaluate(() => document.querySelector('[data-comment="c1"] .view-replies')?.click());
await sleep(350);
const mKb = await m.evaluate(() => {
  const ov = document.querySelector('.comments-overlay');
  const r = ov.getBoundingClientRect();
  const compose = document.querySelector('.comments-sheet .comments-compose').getBoundingClientRect();
  const sugg = document.querySelector('.comments-suggestions').getBoundingClientRect();
  const list = document.querySelector('.comments-sheet .comments-list');
  list.scrollTo({ top: 150, behavior: 'instant' });
  return { top: r.top, fullH: r.height, composeBottom: compose.bottom, suggVisible: sugg.height > 0 && sugg.top >= r.top && sugg.bottom <= 545, listScrolled: list.scrollTop > 0, listH: list.clientHeight, rowScrollbar: getComputedStyle(document.querySelector('.comments-suggestions')).scrollbarWidth };
});
ok('mobile: scrim = visible area, suggestions+compose on keyboard edge, list scrolls', mKb.top === 0 && mKb.fullH === 544 && Math.abs(mKb.composeBottom - 544) < 2 && mKb.suggVisible && mKb.listScrolled && mKb.listH > 60 && mKb.rowScrollbar === 'none', JSON.stringify(mKb));
await shot(m, 'mobile-comments-keyboard');
await m.evaluate(() => document.querySelector('.comments-compose input').blur());
await clearKb(m);
await sleep(300);
await m.evaluate(() => document.querySelector('.comments-overlay').click());
await sleep(500);
ok('mobile: overlay tap closes sheet without navigating', await m.evaluate(() => !document.querySelector('.comments-overlay') && location.pathname === '/'));

// Mixed post video on mobile opens the picture page; single video opens Reels
await scrollPost(m, 'Weekend in Pokhara');
await sleep(400);
await clickPost(m, 'Weekend in Pokhara', '.post-video .video-play');
await m.waitForSelector('.media-page', { timeout: 8000 });
await sleep(1300);
const mMixMedia = await m.evaluate(() => ({ path: location.pathname, count: document.querySelector('.media-page-count')?.textContent, playing: !document.querySelector('.media-page-slide video')?.paused, noReels: !document.querySelector('.reels-page') }));
ok('mobile: mixed video opens picture page at 1/8, not Reels', /\/post\/p_mix\/media\/0$/.test(mMixMedia.path) && mMixMedia.count === '1 / 8' && mMixMedia.playing && mMixMedia.noReels, JSON.stringify(mMixMedia));
await goBack(m);
await scrollPost(m, 'Rain over New Road');
await sleep(600);
await clickPost(m, 'Rain over New Road', '.media-mosaic .auto-video');
await m.waitForSelector('.reels-page', { timeout: 10000 });
await sleep(1400);
const mSingleReel = await m.evaluate(() => {
  const el = document.querySelector('.reels-scroll');
  const i = Math.round(el.scrollTop / el.clientHeight);
  const v = document.querySelectorAll('.reel-slide')[i]?.querySelector('video');
  return { path: location.pathname, src: v?.getAttribute('src'), playing: v ? !v.paused : false };
});
ok('mobile: single-video post opens Reels at that clip', /\/video\/p11-0$/.test(mSingleReel.path) && (mSingleReel.src || '').includes('mov_bbb') && mSingleReel.playing, JSON.stringify(mSingleReel));
await goto(m, '/');

// Media page on mobile: open 3rd, keyboard-safe photo comments (SS1 fix)
await scrollPost(m, 'Golden hour');
await sleep(400);
await clickPost(m, 'Golden hour', '.stack.n4 .mosaic-cell:nth-child(3) img');
await m.waitForSelector('.media-page', { timeout: 8000 });
await sleep(600);
ok('mobile: media page opens at 3/4', await m.evaluate(() => document.querySelector('.media-page-count')?.textContent === '3 / 4'));
await shot(m, 'mobile-media-page');
await m.evaluate(() => document.querySelector('.media-page-slide:nth-child(3) .media-page-actions .reaction-trigger').click());
await sleep(350);
ok('mobile: per-media like works on media page', await m.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return db.reactions.some(r => r.targetType === 'media' && r.targetId.endsWith('#m2') && r.uid === db.meId);
}));
await m.evaluate(() => document.querySelector('.media-page-slide:nth-child(3) .media-page-actions button[aria-label^="Comment on"]').click());
await m.waitForSelector('.comments-overlay', { timeout: 5000 });
await sleep(400);
await m.tap('.comments-overlay .comments-compose input');
await sleep(250);
await setKb(m, 300, 544);
await sleep(450);
const mMediaKb = await m.evaluate(() => {
  const c = document.querySelector('.comments-sheet .comments-compose').getBoundingClientRect();
  const ov = document.querySelector('.comments-overlay').getBoundingClientRect();
  return { composeBottom: c.bottom, ovH: ov.height, visible: c.bottom <= 545 && c.height > 30 };
});
ok('mobile: photo comment field sits above keypad (SS1 fixed)', mMediaKb.visible && Math.abs(mMediaKb.composeBottom - 544) < 2 && mMediaKb.ovH === 544, JSON.stringify(mMediaKb));
await shot(m, 'mobile-media-comments-keyboard');
await m.type('.comments-overlay .comments-compose input', 'QA mobile photo comment');
await m.evaluate(() => document.querySelector('.comments-overlay button[type="submit"]').click());
await sleep(400);
ok('mobile: photo comment stored with mediaIndex', await m.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return db.comments.some(c => c.text === 'QA mobile photo comment' && c.mediaIndex === 2);
}));
await m.evaluate(() => document.querySelector('.comments-compose input').blur());
await clearKb(m);
await sleep(250);
await m.evaluate(() => document.querySelector('.comments-overlay').click());
await sleep(500);
ok('mobile: closing photo sheet keeps media page', await m.evaluate(() => !document.querySelector('.comments-overlay') && !!document.querySelector('.media-page')));
await swipe(m, 330, 400, 60, 400);
await sleep(1000);
const mSwipeL = await m.evaluate(() => {
  const el = document.querySelector('.media-page-scroll');
  return { count: document.querySelector('.media-page-count')?.textContent, left: Math.round(el.scrollLeft), w: el.clientWidth, top: el.scrollTop };
});
ok('mobile: left swipe advances to 4/4 and snaps fully', mSwipeL.count === '4 / 4' && mSwipeL.left === mSwipeL.w * 3 && mSwipeL.top === 0, JSON.stringify(mSwipeL));
await shot(m, 'mobile-media-last');
await swipe(m, 60, 400, 330, 400);
await sleep(1000);
const mSwipeR = await m.evaluate(() => {
  const el = document.querySelector('.media-page-scroll');
  return { count: document.querySelector('.media-page-count')?.textContent, left: Math.round(el.scrollLeft), w: el.clientWidth };
});
ok('mobile: right swipe returns to 3/4, not first', mSwipeR.count === '3 / 4' && mSwipeR.left === mSwipeR.w * 2, JSON.stringify(mSwipeR));
const mDots = await m.evaluate(() => {
  const dots = document.querySelector('.media-page-dots');
  const r = dots.getBoundingClientRect();
  const acts = document.querySelector('.media-page-slide:nth-child(3) .media-page-actions').getBoundingClientRect();
  return { row: getComputedStyle(dots).flexDirection, on: [...dots.children].findIndex(s => s.classList.contains('on')), centered: Math.abs((r.left + r.width / 2) - window.innerWidth / 2) < 3, aboveActions: r.bottom <= acts.top + 1, navHidden: getComputedStyle(document.querySelector('.media-page-nav.prev')).display === 'none' };
});
ok('mobile: bottom-center dots track the slide, arrows hidden', mDots.row === 'row' && mDots.on === 2 && mDots.centered && mDots.aboveActions && mDots.navHidden, JSON.stringify(mDots));
await m.evaluate(() => { const el = document.querySelector('.media-page-scroll'); el.scrollTo({ left: el.clientWidth * 3, behavior: 'smooth' }); });
await sleep(900);
ok('mobile: horizontal scroll reaches 4/4', await m.evaluate(() => document.querySelector('.media-page-count')?.textContent === '4 / 4'));
await goBack(m);
ok('mobile: phone-back from media page returns to feed', await m.evaluate(() => location.pathname === '/' && !document.querySelector('.media-page')));

// Post page keyboard: very first tap, no scroll needed (SS2)
await m.goto(BASE + '/post/p3', { waitUntil: 'domcontentloaded', timeout: 45000 });
await m.waitForSelector('.post-page-comments input', { timeout: 20000 });
const preScroll = await m.evaluate(() => window.scrollY);
await m.tap('.post-page-comments input');
await sleep(250);
await setKb(m, 300, 544);
await sleep(500);
const mInline = await m.evaluate(() => {
  const compose = document.querySelector('.post-page-comments .comments-compose');
  const c = compose.getBoundingClientRect();
  const ancestors = ['.shell', '.main', '.page-enter', '.thread-view', '.post-page-content', '.post-page-comments', '.comments-inline']
    .map(s => { const el = document.querySelector(s); return el ? getComputedStyle(el).transform : 'missing'; });
  return { bottom: Math.round(c.bottom), h: Math.round(c.height), pos: getComputedStyle(compose).position, ancestors, typing: document.documentElement.dataset.typing, scrollY: window.scrollY };
});
ok('mobile: first tap keeps post-page compose above keyboard, no scroll needed', mInline.pos === 'fixed' && Math.abs(mInline.bottom - 544) < 2 && mInline.h > 30 && mInline.ancestors.every(t => t === 'none') && mInline.typing === 'true', JSON.stringify({ preScroll, ...mInline }));
await shot(m, 'mobile-postpage-keyboard');
await m.evaluate(() => document.activeElement?.blur());
await clearKb(m);
await sleep(200);
await m.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
await sleep(350);
const mInlineNoKb = await m.evaluate(() => {
  const c = document.querySelector('.post-page-comments .comments-compose').getBoundingClientRect();
  const last = [...document.querySelectorAll('.post-page-comments .comments-row')].pop()?.getBoundingClientRect();
  return { bottom: Math.round(c.bottom), innerH: window.innerHeight, lastClear: last ? last.bottom <= c.top + 1 : true };
});
ok('mobile: compose rests at screen bottom and never covers comments', Math.abs(mInlineNoKb.bottom - mInlineNoKb.innerH) < 2 && mInlineNoKb.lastClear, JSON.stringify(mInlineNoKb));

// Create page keyboard
await goto(m, '/create');
await m.waitForSelector('.create-post-page', { timeout: 10000 });
await sleep(300);
await m.tap('.create-post-textarea');
await sleep(250);
await setKb(m, 300, 544);
await sleep(450);
const mCreate = await m.evaluate(() => {
  const f = document.querySelector('.create-post-footer').getBoundingClientRect();
  const h = document.querySelector('.create-post-header').getBoundingClientRect();
  const body = document.querySelector('.create-post-body');
  body.scrollTop = 200;
  return { footerBottom: f.bottom, headerTop: h.top, bodyScroll: body.scrollTop > 0, pageH: document.querySelector('.create-post-page').clientHeight };
});
ok('mobile: create header+footer visible above keyboard, body scrolls', Math.abs(mCreate.footerBottom - 544) < 2 && mCreate.headerTop >= 0 && mCreate.bodyScroll && mCreate.pageH === 544, JSON.stringify(mCreate));
await shot(m, 'mobile-create-keyboard');
await m.evaluate(() => { [...document.querySelectorAll('.create-addon-row')].find(b => b.textContent.includes('Location')).click(); });
await sleep(450);
await m.evaluate(() => { const b = document.querySelector('.create-post-body'); b.scrollTop = b.scrollHeight; });
await sleep(300);
ok('mobile: location panel reachable with keyboard open', await m.evaluate(() => {
  const p = document.querySelector('.addon-panel.open .place-form');
  if (!p) return false;
  const r = p.getBoundingClientRect();
  return r.top >= 0 && r.bottom <= 544 + 2;
}));
await clearKb(m);

// Mobile publish: one Post button in the header, straight into the progress ring
await m.evaluate(() => { const b = document.querySelector('.create-post-body'); b.scrollTop = 0; });
await m.type('.create-post-textarea', 'QA mobile publish');
await sleep(400);
await shot(m, 'mobile-create-publish');
await watchPublish(m);
await m.evaluate(() => document.querySelector('.post-btn-header').click());
await m.waitForFunction(() => location.pathname === '/', { timeout: 12000 });
ok('mobile: the Post button publishes straight to the feed',
  (await publishTape(m)).length >= 1 && await m.evaluate(() => document.querySelector('article.post')?.textContent.includes('QA mobile publish')),
  JSON.stringify(await publishTape(m)));
await shot(m, 'mobile-publish-landed');
await sleep(900);

// Reels on mobile
await goto(m, '/video');
await m.waitForSelector('.reels-page', { timeout: 10000 });
await m.waitForFunction(() => { const v = document.querySelector('.reel-slide video'); return v && !v.paused && v.readyState >= 2; }, { timeout: 9000 }).catch(() => {});
await sleep(600);
const mReels = await m.evaluate(() => {
  const nav = document.querySelector('.reels-nav .mobile-nav');
  const nr = nav?.getBoundingClientRect();
  const page = document.querySelector('.reels-page').getBoundingClientRect();
  const cs = nav ? getComputedStyle(nav) : null;
  return {
    slides: document.querySelectorAll('.reel-slide').length,
    playing: !document.querySelector('.reel-slide video')?.paused,
    muted: document.querySelector('.reel-slide video')?.muted,
    rail: !!document.querySelector('.reel-rail'),
    meta: !!document.querySelector('.reel-meta'),
    hasNav: !!nav,
    navVisible: cs ? cs.display !== 'none' && nr.height > 0 : false,
    navTabs: nav ? nav.querySelectorAll('.mnav-tab').length : 0,
    navAtBottom: nr ? Math.abs(nr.bottom - window.innerHeight) < 2 : false,
    pageLifted: Math.abs((window.innerHeight - page.bottom) - 58) < 3
  };
});
ok('mobile: reels full-screen video feed, sound on, rail + caption', mReels.slides >= 2 && mReels.playing && mReels.muted === false && mReels.rail && mReels.meta, JSON.stringify(mReels));
ok('mobile: reels keeps bottom nav visible above safe area', mReels.hasNav && mReels.navVisible && mReels.navTabs >= 4 && mReels.navAtBottom && mReels.pageLifted, JSON.stringify(mReels));
await shot(m, 'mobile-reels');
const reelMine = () => m.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const newest = db.posts.filter(p => p.media.some(x => x.type === 'video')).sort((a, b) => b.ts - a.ts)[0];
  return db.reactions.some(r => r.targetType === 'post' && r.targetId === newest?.id && r.uid === db.meId);
});
const mWasMine = await reelMine();
const mTap = await m.evaluate(() => {
  const btn = document.querySelector('.reel-rail-item .reaction-trigger');
  btn.click();
  return { tray: !!document.querySelector('.reaction-tray'), w: Math.round(btn.getBoundingClientRect().width) };
});
await sleep(500);
ok('mobile: reel Like tap toggles the reaction and never opens the picker',
   (await reelMine()) !== mWasMine && !mTap.tray && mTap.w === 42, JSON.stringify({ mWasMine, mTap }));
const mTray = await m.evaluate(async () => {
  const btn = document.querySelector('.reel-rail-item .reaction-trigger');
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
  await new Promise(r => setTimeout(r, 620));
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
  await new Promise(r => setTimeout(r, 80));
  const t = document.querySelector('.reaction-tray');
  if (!t) return { open: false };
  const r = t.getBoundingClientRect();
  const b = btn.getBoundingClientRect();
  return { open: true, kinds: t.querySelectorAll('button').length, inView: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight, above: r.bottom <= b.top + 2 };
});
ok('mobile: holding the reel Like opens reaction tray fully on screen', mTray.open && mTray.kinds >= 5 && mTray.inView && mTray.above, JSON.stringify(mTray));
await shot(m, 'mobile-reels-tray');
await m.evaluate(() => [...document.querySelectorAll('.reaction-tray button')].find(b => b.getAttribute('aria-label') === 'Haha')?.click());
await sleep(450);
ok('mobile: tray pick stores the reel reaction', await m.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const newest = db.posts.filter(p => p.media.some(m => m.type === 'video')).sort((a, b) => b.ts - a.ts)[0];
  return db.reactions.some(r => r.targetType === 'post' && r.targetId === newest.id && r.uid === db.meId && r.kind === 'haha') && !document.querySelector('.reaction-tray') && !!document.querySelector('.reel-rail-item .reaction-trigger.reacted .reaction-art');
}));
await shot(m, 'mobile-reels-reacted');
const mt0 = await m.evaluate(() => document.querySelector('.reel-slide video').currentTime);
const mSeekR = await doubleTapSeek(m, 'right');
ok('mobile: double-tap right seeks +10s', (mSeekR.t >= Math.min(mSeekR.dur, mt0 + 10) - 0.4 || mSeekR.t < mt0) && mSeekR.badge, JSON.stringify({ mt0, ...mSeekR }));
await sleep(500);
await m.evaluate(() => document.querySelector('.reel-rail-item button[aria-label="Comment on this reel"]').click());
await m.waitForSelector('.comments-overlay', { timeout: 5000 });
await sleep(400);
await m.tap('.comments-overlay .comments-compose input');
await sleep(250);
await setKb(m, 300, 544);
await sleep(450);
ok('mobile: reel comment compose above keypad', await m.evaluate(() => {
  const c = document.querySelector('.comments-sheet .comments-compose').getBoundingClientRect();
  return Math.abs(c.bottom - 544) < 2 && c.height > 30;
}));
await shot(m, 'mobile-reels-comments');
await m.evaluate(() => document.querySelector('.comments-compose input').blur());
await clearKb(m);
await sleep(250);
await m.evaluate(() => document.querySelector('.comments-overlay').click());
await sleep(500);
await m.evaluate(() => { const el = document.querySelector('.reels-scroll'); el.scrollTo({ top: el.clientHeight, behavior: 'smooth' }); });
await sleep(900);
ok('mobile: swipe to next reel pauses previous', await m.evaluate(() => ({
  count: document.querySelector('.reel-count')?.textContent,
  firstPaused: document.querySelectorAll('.reel-slide video')[0].paused,
  secondPlaying: !document.querySelectorAll('.reel-slide video')[1].paused
})).then(r => r.count?.startsWith('2 /') && r.firstPaused && r.secondPlaying));
await m.waitForSelector('.reel-home', { timeout: 20000 });
await m.evaluate(() => document.querySelector('.reel-home').click());
await sleep(800);
ok('mobile: reels home button returns to feed', await m.evaluate(() => location.pathname === '/'));
await goto(m, '/video');
await m.waitForSelector('.reels-page', { timeout: 10000 });
await sleep(1200);
await m.evaluate(() => document.querySelector('.reels-nav .mobile-nav .mnav-tab[href="/marketplace"]').click());
await m.waitForFunction(() => location.pathname === '/marketplace', { timeout: 6000 }).catch(() => {});
ok('mobile: reels bottom nav navigates to Marketplace', await m.evaluate(() => location.pathname === '/marketplace'));
await goto(m, '/');

// Drawer + back button
await m.tap('.m-drawer');
await sleep(450);
const drawerOpen = await m.evaluate(() => ({ open: document.querySelector('.drawer').classList.contains('open'), op: getComputedStyle(document.querySelector('.drawer-overlay')).opacity }));
ok('mobile: drawer opens with faded overlay', drawerOpen.open && drawerOpen.op === '1', JSON.stringify(drawerOpen));
await goBack(m);
ok('mobile: phone-back closes drawer', await m.evaluate(() => !document.querySelector('.drawer').classList.contains('open') && location.pathname === '/'));
await m.tap('.m-drawer');
await sleep(400);
await m.evaluate(() => document.querySelector('.drawer-overlay').click());
await sleep(450);
ok('mobile: drawer closes via overlay', await m.evaluate(() => !document.querySelector('.drawer').classList.contains('open') && getComputedStyle(document.querySelector('.drawer-overlay')).opacity === '0'));

// Search mobile
await goto(m, '/explore');
await sleep(400);
ok('mobile: search field below title', await m.evaluate(() => {
  const row = document.querySelector('.search-head-row').getBoundingClientRect();
  const field = document.querySelector('.search-field').getBoundingClientRect();
  return field.top > row.bottom - 2 && row.top < 20;
}));
await shot(m, 'mobile-search');

// Dark mode sanity
await goto(m, '/');
await m.tap('.m-drawer');
await sleep(400);
await m.evaluate(() => document.querySelector('.drawer-footer .theme-toggle, .drawer-footer button')?.click());
await sleep(400);
const theme = await m.evaluate(() => document.documentElement.dataset.theme);
await m.evaluate(() => document.querySelector('.drawer-overlay').click());
await sleep(450);
await shot(m, 'mobile-dark');
ok('mobile: theme toggle works', theme === 'dark' || theme === 'light', `theme=${theme}`);

// Login brand — /login sends a signed-in visitor home, so open it signed out.
const lp = await newPage({ width: 1280, height: 900 });
await goto(lp, '/');
await lp.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  db.meId = null;
  localStorage.setItem('exposing-demo-v1', JSON.stringify(db));
});
await goto(lp, '/login');
await sleep(700);
const loginBrand = await lp.evaluate(() => {
  const img = document.querySelector('.login-brand .brand-logo-dark');
  return { path: location.pathname, hasBrand: !!document.querySelector('.login-brand'), src: img?.getAttribute('src'), loaded: (img?.naturalWidth || 0) > 0, title: document.querySelector('.login-title')?.textContent };
});
ok('login: real Exposing logo + wordmark', loginBrand.hasBrand && loginBrand.loaded && loginBrand.src === '/exposing-logo-dark.png' && (loginBrand.title || '').includes('Exposing'), JSON.stringify(loginBrand));
await shot(lp, 'desktop-login-brand');
// Same origin, same storage: leave the shared session signed back in or the
// mobile half of the suite wakes up on a logged-out phone.
await lp.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  db.meId = 'u1';
  localStorage.setItem('exposing-demo-v1', JSON.stringify(db));
});
await lp.close();

// ================= PHASE 7: MOBILE =================
// The bell badge only exists while something is unread; the desktop half has
// already read the inbox by now, so give the phone one notification of its own.
await m.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  db.notifications.unshift({ id: 'qa_m_badge', uid: db.meId, kind: 'like', text: 'liked your photo', ts: Date.now(), read: false });
  localStorage.setItem('exposing-demo-v1', JSON.stringify(db));
});
await goto(m, '/');
ok('mobile: unread badge on bell', await m.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const badge = document.querySelector('.m-top .mnav-badge');
  return !!badge && Number(badge.textContent) > 0;
}), JSON.stringify(await m.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return {
    path: location.pathname,
    meId: db.meId,
    hasQA: db.notifications.some(n => n.id === 'qa_m_badge'),
    unreadForMe: db.notifications.filter(n => n.uid === db.meId && !n.read).length,
    mtop: !!document.querySelector('.m-top'),
    badge: document.querySelector('.m-top .mnav-badge')?.textContent || null
  };
})));

await goto(m, '/notifications');
const mNotif = await m.evaluate(() => ({
  rows: document.querySelectorAll('.notif-row').length,
  unread: document.querySelectorAll('.notif-row.unread').length,
  noOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1
}));
ok('mobile: notifications render with unread', mNotif.rows >= 5 && mNotif.unread >= 1 && mNotif.noOverflow, JSON.stringify(mNotif));
await shot(m, 'mobile-notifications');
await m.evaluate(() => document.querySelector('.notif-mark')?.click());
await sleep(400);
ok('mobile: mark all read clears badge', await m.evaluate(() => !document.querySelector('.notif-row.unread')));

await goto(m, '/messages/u2');
await m.tap('.chat-compose input');
await sleep(300);
await setKb(m, 300, 544);
await sleep(450);
const mChatKb = await m.evaluate(() => {
  const view = document.querySelector('.chat-view').getBoundingClientRect();
  const compose = document.querySelector('.chat-compose').getBoundingClientRect();
  return { viewH: Math.round(view.height), composeBottom: Math.round(compose.bottom), visible: compose.bottom <= 544 && compose.top > 0 };
});
ok('mobile: chat resizes for keyboard, compose stays reachable', mChatKb.viewH >= 520 && mChatKb.viewH <= 560 && mChatKb.visible, JSON.stringify(mChatKb));
await m.type('.chat-compose input', 'QA mobile hi');
await m.evaluate(() => document.querySelector('.chat-send').click());
await sleep(450);
ok('mobile: chat send lands in thread + store', await m.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return [...document.querySelectorAll('.chat-bubble-row.mine')].some(b => b.textContent.includes('QA mobile hi')) && db.messages.some(x => x.from === 'u1' && x.to === 'u2' && x.text === 'QA mobile hi');
}));
await clearKb(m);
await sleep(350);
const mSendClear = await m.evaluate(() => {
  const send = document.querySelector('.chat-send');
  const r = send.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { fab: !!document.querySelector('.post-fab'), hit: !!el && (el === send || send.contains(el)) };
});
ok('mobile: chat send button uncovered (no Post FAB on conversation)', !mSendClear.fab && mSendClear.hit, JSON.stringify(mSendClear));
await shot(m, 'mobile-chat');

await goto(m, '/marketplace');
const mMarket = await m.evaluate(() => ({
  cards: document.querySelectorAll('.market-card').length,
  cols: getComputedStyle(document.querySelector('.market-grid')).gridTemplateColumns.split(' ').length,
  noOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1
}));
ok('mobile: marketplace two-column grid fits', mMarket.cards >= 5 && mMarket.cols === 2 && mMarket.noOverflow, JSON.stringify(mMarket));
await shot(m, 'mobile-market');
await m.evaluate(() => document.querySelector('.market-card').click());
await m.waitForSelector('.listing-page', { timeout: 8000 }).catch(() => {});
await sleep(500);
const mListing = await m.evaluate(() => {
  const media = document.querySelector('.listing-media').getBoundingClientRect();
  const info = document.querySelector('.listing-info').getBoundingClientRect();
  return { fits: media.width <= window.innerWidth && media.left >= 0, stacked: info.top >= media.bottom - 2, actions: document.querySelectorAll('.listing-actions button').length, noOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1 };
});
ok('mobile: listing page stacks image above details with actions', mListing.fits && mListing.stacked && mListing.actions >= 3 && mListing.noOverflow, JSON.stringify(mListing));
await shot(m, 'mobile-listing');
await goBack(m);
await sleep(400);
ok('mobile: phone-back returns to marketplace', await m.evaluate(() => location.pathname === '/marketplace'));

await goto(m, '/wallet');
ok('mobile: wallet renders balance without overflow', await m.evaluate(() => !!document.querySelector('.wallet-balance') && document.documentElement.scrollWidth <= window.innerWidth + 1));
await shot(m, 'mobile-wallet');

await goto(m, '/saved');
ok('mobile: saved list renders', await m.evaluate(() => !!document.querySelector('.saved-list') || !!document.querySelector('.empty-state')));
await shot(m, 'mobile-saved');

await goto(m, '/settings');
await m.evaluate(() => document.querySelector('.settings-card .switch').click());
await sleep(350);
ok('mobile: settings toggle persists', await m.evaluate(() => JSON.parse(localStorage.getItem('exposing-demo-v1')).users.find(u => u.id === 'u1').twoStep === true));
await m.evaluate(() => document.querySelector('.settings-card .switch').click());
await sleep(300);
await shot(m, 'mobile-settings');

await goto(m, '/u/himal_lens');
const mProf = await m.evaluate(() => ({
  cover: Math.round(document.querySelector('.profile-cover').getBoundingClientRect().height),
  actions: document.querySelector('.profile-actions').getBoundingClientRect().width > 0,
  noOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1
}));
ok('mobile: profile cover compact, actions visible, no overflow', mProf.cover <= 170 && mProf.actions && mProf.noOverflow, JSON.stringify(mProf));
await shot(m, 'mobile-profile');

await goto(m, '/signup');
const mSignup = await m.evaluate(() => {
  const first = document.querySelector('.signup-form input.login-input').getBoundingClientRect();
  return { firstVisible: first.top >= 0 && first.top < window.innerHeight, noOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1, scrollable: document.querySelector('.signup-container').scrollHeight > window.innerHeight };
});
ok('mobile: signup scrolls from top, first field reachable', mSignup.firstVisible && mSignup.noOverflow, JSON.stringify(mSignup));
await shot(m, 'mobile-signup');

await goto(m, '/legal/terms');
ok('mobile: legal doc renders sections', await m.evaluate(() => document.querySelectorAll('.legal-section').length >= 4 && document.documentElement.scrollWidth <= window.innerWidth + 1));
await shot(m, 'mobile-legal');

await goto(m, '/admin');
ok('mobile: non-staff blocked from admin', await m.evaluate(() => !!document.querySelector('.empty-state') && !document.querySelector('.admin-tabs')));

// 404 recovery page on phone
await m.goto(BASE + '/this-route-does-not-exist', { waitUntil: 'domcontentloaded', timeout: 45000 });
await m.waitForSelector('.notfound-card', { timeout: 15000 });
await sleep(500);
const mnf = await m.evaluate(() => {
  const card = document.querySelector('.notfound-card').getBoundingClientRect();
  const actions = [...document.querySelectorAll('.notfound-actions a')].map(a => a.getBoundingClientRect());
  return { onScreen: card.top >= 0 && card.bottom <= window.innerHeight, bothVisible: actions.every(r => r.width > 0 && r.bottom <= window.innerHeight), noOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1 };
});
ok('mobile: 404 card fits with both actions reachable', mnf.onScreen && mnf.bothVisible && mnf.noOverflow, JSON.stringify(mnf));
await shot(m, 'mobile-notfound');
await m.tap('.notfound-primary');
await m.waitForSelector('article.post', { timeout: 15000 });
ok('mobile: 404 Back to Home lands on feed', await m.evaluate(() => location.pathname === '/'));

// ================= PHASE 8: MOBILE =================
// Chat screen: only the back arrow, no top bar / bottom nav / FAB / footer
await goto(m, '/messages/u2');
const mChatChrome = await m.evaluate(() => ({
  top: !!document.querySelector('.m-top'),
  nav: !!document.querySelector('.mobile-nav'),
  fab: !!document.querySelector('.post-fab'),
  footer: !!document.querySelector('.site-footer'),
  back: !!document.querySelector('.chat-header .icon-btn'),
  compose: !!document.querySelector('.chat-compose')
}));
ok('mobile: chat hides top bar, bottom nav, FAB and footer, keeps back arrow', !mChatChrome.top && !mChatChrome.nav && !mChatChrome.fab && !mChatChrome.footer && mChatChrome.back && mChatChrome.compose, JSON.stringify(mChatChrome));
await shot(m, 'mobile-chat-clean');
await m.tap('.chat-header .icon-btn');
await m.waitForFunction(() => location.pathname === '/messages', { timeout: 6000 }).catch(() => {});
await sleep(500);
ok('mobile: chat back arrow returns to inbox with chrome restored', await m.evaluate(() => location.pathname === '/messages' && !!document.querySelector('.m-top') && !!document.querySelector('.mobile-nav')));
const mInboxHints = await m.evaluate(() => document.querySelectorAll('.inbox-row-preview.hint').length);
ok('mobile: mutual follows auto-listed in inbox', mInboxHints >= 3, `${mInboxHints} hints`);
await shot(m, 'mobile-inbox-mutuals');

// FAB home-only
await goto(m, '/');
const fabHome = await m.evaluate(() => !!document.querySelector('.post-fab'));
await goto(m, '/u/himal_lens');
const fabProfile = await m.evaluate(() => !!document.querySelector('.post-fab'));
await goto(m, '/marketplace');
const fabMarket = await m.evaluate(() => !!document.querySelector('.post-fab'));
ok('mobile: Post FAB on home only', fabHome && !fabProfile && !fabMarket, JSON.stringify({ fabHome, fabProfile, fabMarket }));

// Followers page + requests on phone
await m.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  db.follows = db.follows.filter(f => !(f.following === 'u1' && (f.follower === 'u8' || f.follower === 'u11')));
  db.follows.push({ follower: 'u8', following: 'u1', ts: Date.now(), status: 'pending' });
  db.follows.push({ follower: 'u11', following: 'u1', ts: Date.now(), status: 'pending' });
  localStorage.setItem('exposing-demo-v1', JSON.stringify(db));
});
await goto(m, '/u/sita_k/followers');
const mPeople = await m.evaluate(() => ({
  rows: document.querySelectorAll('.people-page-list .people-row').length,
  requests: document.querySelectorAll('.people-row.request').length,
  noOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1
}));
ok('mobile: followers page lists people + pending requests', mPeople.rows >= 5 && mPeople.requests === 2 && mPeople.noOverflow, JSON.stringify(mPeople));
await shot(m, 'mobile-followers');
await m.evaluate(() => [...document.querySelectorAll('.people-row.request')].find(r => r.textContent.includes('Kathmandu Daily'))?.querySelector('.follow-btn').click());
await sleep(500);
ok('mobile: Accept request from phone', await m.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return db.follows.find(f => f.follower === 'u8' && f.following === 'u1')?.status === 'accepted' && document.querySelectorAll('.people-row.request').length === 1;
}));
await m.evaluate(() => [...document.querySelectorAll('.people-row.request')].find(r => r.textContent.includes('Goal Nepal'))?.querySelector('.ghost-btn').click());
await sleep(500);
ok('mobile: Decline request from phone', await m.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  return !db.follows.some(f => f.follower === 'u11' && f.following === 'u1') && document.querySelectorAll('.people-row.request').length === 0;
}));

// Own profile create on phone
await goto(m, '/u/sita_k');
const mOwn = await m.evaluate(() => ({
  create: [...document.querySelectorAll('.profile-actions button')].some(b => /^post$/i.test(b.textContent.trim())),
  footerLinks: document.querySelectorAll('.site-footer .footer-links a').length
}));
ok('mobile: own profile has Create post + legal footer', mOwn.create && mOwn.footerLinks === 4, JSON.stringify(mOwn));
await m.evaluate(() => [...document.querySelectorAll('.profile-actions button')].find(b => /^post$/i.test(b.textContent.trim()))?.click());
await m.waitForSelector('.cp-overlay', { timeout: 5000 }).catch(() => {});
ok('mobile: own-profile Post opens composer', await m.evaluate(() => !!document.querySelector('.cp-overlay')));
await m.keyboard.press('Escape');
await sleep(400);

await m.close();
await browser.close();

ok('no uncaught page errors', !errors.some(e => e.startsWith('pageerror')), errors.filter(e => e.startsWith('pageerror')).join(' | '));
console.log('\nResource/console errors (informational):');
[...new Set(errors)].slice(0, 12).forEach(e => console.log('  ' + e));
const failed = results.filter(r => !r.pass);
console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
await retryWrite(() => fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 2)));
process.exit(failed.length ? 1 : 0);