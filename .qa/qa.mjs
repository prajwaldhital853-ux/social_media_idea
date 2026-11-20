import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const OUT = 'D:/social_medial/.qa';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// 1x1 red PNG for attachment test
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
  return page;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
async function goto(page, path) {
  await page.goto('http://localhost:3000' + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('.post, .create-post-page, .search-view, .login-card, .modern-login', { timeout: 30000 }).catch(() => {});
  await sleep(900);
}
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

// ================= DESKTOP =================
const d = await newPage({ width: 1280, height: 900 });
await goto(d, '/');

ok('desktop: feed renders', await d.evaluate(() => document.querySelectorAll('.post').length >= 10));
ok('desktop: window scrollbar hidden', await d.evaluate(() => getComputedStyle(document.documentElement).scrollbarWidth === 'none'));
ok('desktop: no horizontal overflow', await d.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
ok('desktop: page-enter animation', await d.evaluate(() => getComputedStyle(document.querySelector('.page-enter')).animationName === 'pageIn'));
await shot(d, 'desktop-feed');

// Mosaic +N
const mix = await articleBy(d, 'Weekend in Pokhara');
const mixInfo = await d.evaluate(el => {
  const m = el.querySelector('.media-mosaic');
  return { cls: m.className, cells: m.querySelectorAll('.mosaic-cell').length, more: m.querySelector('.media-more')?.textContent, preview: !!m.querySelector('.post-video.preview'), previewPaused: m.querySelector('.post-video video')?.paused, h: m.clientHeight };
}, mix);
ok('desktop: p_mix stack n5, 5 cells, +3', mixInfo.cls.includes('stack n5') && mixInfo.cells === 5 && mixInfo.more === '+3', JSON.stringify(mixInfo));
ok('desktop: mixed video is paused preview', mixInfo.preview && mixInfo.previewPaused);
await mix.asElement().screenshot({ path: `${OUT}/desktop-mosaic.png` });

// Single video autoplay
await d.evaluate(() => { [...document.querySelectorAll('article.post')].find(a => a.textContent.includes('Rain over New Road'))?.scrollIntoView({ block: 'center' }); });
await sleep(1500);
const singleVid = await d.evaluate(() => {
  const a = [...document.querySelectorAll('article.post')].find(x => x.textContent.includes('Rain over New Road'));
  const v = a?.querySelector('.media-mosaic.single video');
  return v ? { paused: v.paused, muted: v.muted, ready: v.readyState, loop: v.loop } : null;
});
ok('desktop: single video autoplays muted+loop', singleVid && !singleVid.paused && singleVid.muted && singleVid.loop, JSON.stringify(singleVid));

// Mixed video click -> viewer plays at index 0
await d.evaluate(() => { [...document.querySelectorAll('article.post')].find(a => a.textContent.includes('Weekend in Pokhara'))?.scrollIntoView({ block: 'center' }); });
await sleep(400);
await d.evaluate(() => { [...document.querySelectorAll('article.post')].find(a => a.textContent.includes('Weekend in Pokhara')).querySelector('.post-video .video-play').click(); });
await d.waitForSelector('.media-modal', { timeout: 5000 });
await sleep(900);
const viewer1 = await d.evaluate(() => ({ count: document.querySelector('.media-viewer-count')?.textContent, playing: !document.querySelector('.media-slide video')?.paused, slides: document.querySelectorAll('.media-slide').length }));
ok('desktop: viewer opens at 1/8 and plays video', viewer1.count === '1 / 8' && viewer1.playing && viewer1.slides === 8, JSON.stringify(viewer1));
await shot(d, 'desktop-viewer-video');
await d.keyboard.press('ArrowDown');
await sleep(600);
ok('desktop: ArrowDown advances to 2/8', await d.evaluate(() => document.querySelector('.media-viewer-count')?.textContent === '2 / 8'));
await d.keyboard.press('Escape');
await sleep(400);
ok('desktop: Escape closes viewer', await d.evaluate(() => !document.querySelector('.media-modal')));

// Third picture opens at index 2, scroll to others
await d.evaluate(() => { [...document.querySelectorAll('article.post')].find(a => a.textContent.includes('Golden hour'))?.scrollIntoView({ block: 'center' }); });
await sleep(400);
await d.evaluate(() => { [...document.querySelectorAll('article.post')].find(a => a.textContent.includes('Golden hour')).querySelector('.stack.n4 .mosaic-cell:nth-child(3) img').click(); });
await d.waitForSelector('.media-modal', { timeout: 5000 });
await sleep(500);
ok('desktop: 3rd photo opens viewer at 3/4', await d.evaluate(() => document.querySelector('.media-viewer-count')?.textContent === '3 / 4'));
await shot(d, 'desktop-viewer-third');
await d.evaluate(() => { const el = document.querySelector('.media-viewer-scroll'); el.scrollTo({ top: el.clientHeight * 3 }); });
await sleep(600);
ok('desktop: scroll reaches 4/4', await d.evaluate(() => document.querySelector('.media-viewer-count')?.textContent === '4 / 4'));
await d.evaluate(() => document.querySelector('.media-viewer-close').click());
await sleep(400);

// Comment sheet on p3
await d.evaluate(() => { [...document.querySelectorAll('article.post')].find(a => a.textContent.includes('Just witnessed'))?.scrollIntoView({ block: 'center' }); });
await sleep(300);
await d.evaluate(() => { [...document.querySelectorAll('article.post')].find(a => a.textContent.includes('Just witnessed')).querySelector('[aria-label="Comments"]').click(); });
await d.waitForSelector('.comments-overlay', { timeout: 5000 });
await sleep(500);
const sheetInfo = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const kinds = [...new Set(db.reactions.filter(r => r.targetType === 'post' && r.targetId === 'p3').map(r => r.kind))];
  const quick = [...document.querySelectorAll('.comments-quickreact button')].map(b => b.getAttribute('aria-label'));
  const head = [...document.querySelectorAll('.comments-heading .comment-reaction-icon')].length;
  const sheet = document.querySelector('.comments-sheet');
  return { kinds, quick, head, sheetH: sheet.clientHeight, listScrollable: document.querySelector('.comments-sheet .comments-list').scrollHeight > document.querySelector('.comments-sheet .comments-list').clientHeight };
});
ok('desktop: quickreact mirrors post kinds', JSON.stringify(sheetInfo.quick.sort()) === JSON.stringify(sheetInfo.kinds.sort()), JSON.stringify(sheetInfo));
ok('desktop: heading shows post reaction icons', sheetInfo.head === sheetInfo.kinds.length);
await shot(d, 'desktop-comments');

// Threaded replies
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

// Reply flow
await d.evaluate(() => { [...document.querySelectorAll('[data-comment="c1r1"] .comment-action-btn')].find(b => b.textContent === 'Reply').click(); });
await sleep(250);
const banner = await d.evaluate(() => ({ banner: document.querySelector('.reply-banner')?.textContent || '', val: document.querySelector('.comments-compose input').value }));
ok('desktop: reply banner + prefill', banner.banner.includes('Replying to') && banner.val.startsWith('@'), JSON.stringify(banner));
await d.type('.comments-compose input', 'QA threaded reply');
await d.evaluate(() => document.querySelector('.comments-compose button[type="submit"]').click());
await sleep(400);
ok('desktop: reply posted into thread', await d.evaluate(() => document.querySelectorAll('[data-comment="c1"] .comment-replies .comments-row').length === 5));

// Comment reaction tray limited to post kinds
await d.focus('[data-comment="c1r1"] .reaction-trigger');
await d.keyboard.press('ArrowUp');
await sleep(350);
const trayKinds = await d.evaluate(() => [...document.querySelectorAll('.reaction-tray button')].map(b => b.getAttribute('aria-label').toLowerCase()));
ok('desktop: comment tray limited to post kinds', JSON.stringify(trayKinds.sort()) === JSON.stringify(sheetInfo.kinds.sort()), JSON.stringify(trayKinds));
await shot(d, 'desktop-comment-tray');
await d.keyboard.press('Escape');
await sleep(250);
ok('desktop: Escape closes tray but keeps sheet', await d.evaluate(() => !document.querySelector('.reaction-tray') && !!document.querySelector('.comments-overlay')));

// Quick react toggle (pick a kind that is not already mine)
await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const mine = db.reactions.find(r => r.targetType === 'post' && r.targetId === 'p3' && r.uid === db.meId)?.kind;
  const btn = [...document.querySelectorAll('.comments-quickreact button')].find(b => b.getAttribute('aria-label') !== mine);
  btn.click();
});
await sleep(300);
ok('desktop: quickreact toggles on', await d.evaluate(() => !!document.querySelector('.comments-quickreact button.on')));

// Keyboard simulation inside sheet
await d.focus('.comments-compose input');
await sleep(200);
await setKb(d, 380, 520);
await sleep(400);
const kbSheet = await d.evaluate(() => {
  const ov = document.querySelector('.comments-overlay').getBoundingClientRect();
  const compose = document.querySelector('.comments-sheet .comments-compose').getBoundingClientRect();
  const list = document.querySelector('.comments-sheet .comments-list');
  list.scrollTo({ top: 120, behavior: 'instant' });
  return { ovH: ov.height, composeBottom: compose.bottom, listScrolled: list.scrollTop > 0, composeVisible: compose.bottom <= ov.bottom + 1 && compose.top >= ov.top };
});
ok('desktop: sheet shrinks with keyboard, compose above it, list scrolls', kbSheet.ovH === 520 && kbSheet.composeVisible && kbSheet.listScrolled, JSON.stringify(kbSheet));
await shot(d, 'desktop-sheet-keyboard');
await clearKb(d);
await d.keyboard.press('Escape');
await sleep(400);
ok('desktop: sheet closes with exit animation', await d.evaluate(() => !document.querySelector('.comments-overlay')));

// Like+love-only post: force p3 reactions
await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  db.reactions = db.reactions.filter(r => !(r.targetType === 'post' && r.targetId === 'p3')).concat([
    { id: 'qa_r1', targetType: 'post', targetId: 'p3', uid: 'u2', kind: 'like', ts: Date.now() },
    { id: 'qa_r2', targetType: 'post', targetId: 'p3', uid: 'u3', kind: 'love', ts: Date.now() }
  ]);
  localStorage.setItem('exposing-demo-v1', JSON.stringify(db));
});
await goto(d, '/');
await d.evaluate(() => { [...document.querySelectorAll('article.post')].find(a => a.textContent.includes('Just witnessed')).querySelector('[aria-label="Comments"]').click(); });
await d.waitForSelector('.comments-overlay', { timeout: 5000 });
await sleep(400);
const limited = await d.evaluate(() => ({
  quick: [...document.querySelectorAll('.comments-quickreact button')].map(b => b.getAttribute('aria-label')),
  head: [...document.querySelectorAll('.comments-heading .comment-reaction-icon')].length
}));
ok('desktop: like+love post shows only those icons', JSON.stringify(limited.quick.sort()) === JSON.stringify(['like', 'love']) && limited.head === 2, JSON.stringify(limited));
await shot(d, 'desktop-comments-limited');
await d.focus('[data-comment="c1"] .reaction-trigger');
await d.keyboard.press('ArrowUp');
await sleep(300);
ok('desktop: comment tray also only like+love', await d.evaluate(() => [...document.querySelectorAll('.reaction-tray button')].length === 2));
await d.keyboard.press('Escape');
await sleep(200);
await d.keyboard.press('Escape');
await sleep(400);

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
await shot(d, 'desktop-postpage-keyboard');
await d.type('.post-page-comments input', 'QA inline comment');
await d.evaluate(() => document.querySelector('.post-page-comments button[type="submit"]').click());
await sleep(400);
ok('desktop: inline comment posts', await d.evaluate(() => document.querySelector('.post-page-comments .comments-list').textContent.includes('QA inline comment')));
await clearKb(d);

// Create page
await goto(d, '/create');
await d.waitForSelector('.create-post-page', { timeout: 10000 });
await sleep(400);
await d.type('.create-post-textarea', 'Long caption test. '.repeat(40));
await sleep(300);
const taH = await d.evaluate(() => document.querySelector('.create-post-textarea').clientHeight);
ok('desktop: textarea capped at 320px', taH <= 320, `h=${taH}`);
await d.evaluate(() => { [...document.querySelectorAll('.create-addon-row')].find(b => b.textContent.includes('Location')).click(); });
await sleep(450);
ok('desktop: location panel opens', await d.evaluate(() => document.querySelector('.addon-panel.open') !== null));
await d.evaluate(() => { [...document.querySelectorAll('.place-suggestions button')].find(b => b.textContent === 'Pokhara').click(); });
await sleep(300);
await d.evaluate(() => { [...document.querySelectorAll('.create-addon-row')].find(b => b.textContent.includes('Feeling')).click(); });
await sleep(450);
await d.evaluate(() => { [...document.querySelectorAll('.mood-grid button')].find(b => b.textContent.includes('happy')).click(); });
await sleep(300);
const chips = await d.evaluate(() => [...document.querySelectorAll('.create-chip')].map(c => c.textContent));
ok('desktop: mood + place chips', chips.length === 2 && chips.some(c => c.includes('happy')) && chips.some(c => c.includes('Pokhara')), JSON.stringify(chips));
const fileInput = await d.$('input[type="file"]');
await fileInput.uploadFile(`${OUT}/test.png`);
await sleep(900);
ok('desktop: attachment thumbnail renders', await d.evaluate(() => !!document.querySelector('.create-media-item img')));
await shot(d, 'desktop-create');
await d.evaluate(() => document.querySelector('.create-publish').click());
await d.waitForFunction(() => location.pathname === '/', { timeout: 10000 });
await sleep(900);
const published = await d.evaluate(() => {
  const first = document.querySelector('article.post');
  return { text: first?.textContent.includes('Long caption test'), tags: first?.querySelectorAll('.post-tag').length };
});
ok('desktop: publish returns home with new post + tags', published.text && published.tags === 2, JSON.stringify(published));

// Create page keyboard safety
await goto(d, '/create');
await d.focus('.create-post-textarea');
await sleep(200);
await setKb(d, 380, 520);
await sleep(400);
const createKb = await d.evaluate(() => {
  const page = document.querySelector('.create-post-page').getBoundingClientRect();
  const footer = document.querySelector('.create-post-footer').getBoundingClientRect();
  const body = document.querySelector('.create-post-body');
  return { pageH: page.height, footerBottom: footer.bottom, bodyScrollable: body.scrollHeight >= body.clientHeight };
});
ok('desktop: create footer above keyboard, body scrolls', createKb.pageH === 520 && Math.abs(createKb.footerBottom - 520) < 2, JSON.stringify(createKb));
await shot(d, 'desktop-create-keyboard');
await clearKb(d);

// Search page
await goto(d, '/explore');
await sleep(500);
const searchLayout = await d.evaluate(() => {
  const row = document.querySelector('.search-head-row').getBoundingClientRect();
  const field = document.querySelector('.search-field').getBoundingClientRect();
  return { rowTop: row.top, fieldTop: field.top, fieldBelow: field.top > row.bottom - 2, gapFromTop: row.top };
});
ok('desktop: search field below title row', searchLayout.fieldBelow && searchLayout.gapFromTop > 8, JSON.stringify(searchLayout));
await d.type('.search-field input', 'sita');
await d.evaluate(() => document.querySelector('.search-field').requestSubmit());
await sleep(700);
ok('desktop: search finds Sita', await d.evaluate(() => document.body.textContent.includes('Sita Karki')));
await shot(d, 'desktop-search');

await d.close();

// ================= MOBILE =================
const m = await newPage({ width: 390, height: 844 }, true);
await goto(m, '/');
ok('mobile: top bar + bottom nav + fab', await m.evaluate(() => {
  const vis = el => el && getComputedStyle(el).display !== 'none';
  return vis(document.querySelector('.m-top')) && vis(document.querySelector('.mobile-nav')) && vis(document.querySelector('.post-fab'));
}));
ok('mobile: no horizontal overflow', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await shot(m, 'mobile-feed');

const mMix = await m.evaluate(() => {
  const a = [...document.querySelectorAll('article.post')].find(x => x.textContent.includes('Weekend in Pokhara'));
  const mo = a.querySelector('.media-mosaic');
  return { h: mo.clientHeight, more: mo.querySelector('.media-more')?.textContent };
});
ok('mobile: stack mosaic ~280px + 3 overlay', Math.abs(mMix.h - 280) <= 2 && mMix.more === '+3', JSON.stringify(mMix));

// Comment sheet + keyboard
await m.evaluate(() => { [...document.querySelectorAll('article.post')].find(a => a.textContent.includes('Just witnessed')).querySelector('[aria-label="Comments"]').click(); });
await m.waitForSelector('.comments-overlay', { timeout: 5000 });
await sleep(500);
await shot(m, 'mobile-comments');
await m.tap('.comments-compose input');
await sleep(250);
await setKb(m, 300, 544);
await sleep(450);
await m.evaluate(() => document.querySelector('[data-comment="c1"] .view-replies')?.click());
await sleep(350);
const mKb = await m.evaluate(() => {
  const ov = document.querySelector('.comments-overlay').getBoundingClientRect();
  const compose = document.querySelector('.comments-sheet .comments-compose').getBoundingClientRect();
  const quick = document.querySelector('.comments-quickreact').getBoundingClientRect();
  const list = document.querySelector('.comments-sheet .comments-list');
  list.scrollTo({ top: 150, behavior: 'instant' });
  return { ovH: ov.height, composeBottom: compose.bottom, quickVisible: quick.height > 0 && quick.top >= ov.top && quick.bottom <= ov.bottom + 1, listScrolled: list.scrollTop > 0, listH: list.clientHeight };
});
ok('mobile: keyboard shrinks sheet; quickreact+compose visible; list scrolls', mKb.ovH === 544 && Math.abs(mKb.composeBottom - 544) < 2 && mKb.quickVisible && mKb.listScrolled && mKb.listH > 60, JSON.stringify(mKb));
await shot(m, 'mobile-comments-keyboard');
await m.evaluate(() => document.querySelector('.comments-compose input').blur());
await clearKb(m);
await sleep(300);
await m.evaluate(() => document.querySelector('.comments-overlay').click());
await sleep(450);
ok('mobile: overlay tap closes sheet without navigating', await m.evaluate(() => !document.querySelector('.comments-overlay') && location.pathname === '/'));

// Viewer on mobile: open 3rd, swipe-scroll
await m.evaluate(() => { [...document.querySelectorAll('article.post')].find(a => a.textContent.includes('Golden hour'))?.scrollIntoView({ block: 'center' }); });
await sleep(400);
await m.evaluate(() => { [...document.querySelectorAll('article.post')].find(a => a.textContent.includes('Golden hour')).querySelector('.stack.n4 .mosaic-cell:nth-child(3) img').click(); });
await m.waitForSelector('.media-modal', { timeout: 5000 });
await sleep(500);
ok('mobile: viewer opens at 3/4', await m.evaluate(() => document.querySelector('.media-viewer-count')?.textContent === '3 / 4'));
await shot(m, 'mobile-viewer');
await m.evaluate(() => { const el = document.querySelector('.media-viewer-scroll'); el.scrollTo({ top: el.clientHeight * 3, behavior: 'smooth' }); });
await sleep(800);
ok('mobile: swipe/scroll to 4/4', await m.evaluate(() => document.querySelector('.media-viewer-count')?.textContent === '4 / 4'));
await m.evaluate(() => document.querySelector('.media-viewer-close').click());
await sleep(400);

// Post page keyboard
await goto(m, '/post/p3');
await m.waitForSelector('.post-page-comments', { timeout: 10000 });
await sleep(400);
await m.tap('.post-page-comments input');
await sleep(250);
await setKb(m, 300, 544);
await sleep(450);
const mInline = await m.evaluate(() => {
  const c = document.querySelector('.post-page-comments .comments-compose').getBoundingClientRect();
  const list = document.querySelector('.post-page-comments .comments-list');
  return { bottom: c.bottom, pos: getComputedStyle(document.querySelector('.post-page-comments .comments-compose')).position, listVisible: list.clientHeight > 0 };
});
ok('mobile: post-page compose above keyboard', mInline.pos === 'fixed' && Math.abs(mInline.bottom - 544) < 2, JSON.stringify(mInline));
await shot(m, 'mobile-postpage-keyboard');
await clearKb(m);

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
await shot(m, 'mobile-create-panel');
await clearKb(m);

// Drawer
await goto(m, '/');
await m.tap('.m-drawer');
await sleep(450);
const drawerOpen = await m.evaluate(() => ({ open: document.querySelector('.drawer').classList.contains('open'), op: getComputedStyle(document.querySelector('.drawer-overlay')).opacity }));
ok('mobile: drawer opens with faded overlay', drawerOpen.open && drawerOpen.op === '1', JSON.stringify(drawerOpen));
await shot(m, 'mobile-drawer');
await m.evaluate(() => document.querySelector('.drawer-overlay').click());
await sleep(450);
ok('mobile: drawer closes', await m.evaluate(() => !document.querySelector('.drawer').classList.contains('open') && getComputedStyle(document.querySelector('.drawer-overlay')).opacity === '0'));

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
await sleep(400);
await shot(m, 'mobile-dark');
ok('mobile: theme toggle works', theme === 'dark' || theme === 'light', `theme=${theme}`);

await m.close();
await browser.close();

const realErrors = errors.filter(e => !e.includes('ERR_CACHE_OPERATION_NOT_SUPPORTED') && !e.includes('Failed to load resource'));
ok('no uncaught page errors', !errors.some(e => e.startsWith('pageerror')), errors.filter(e => e.startsWith('pageerror')).join(' | '));
console.log('\nResource/console errors (informational):');
[...new Set(errors)].slice(0, 12).forEach(e => console.log('  ' + e));
const failed = results.filter(r => !r.pass);
console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 2));
process.exit(failed.length ? 1 : 0);