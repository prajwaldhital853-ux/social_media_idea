import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const OUT = 'D:/social_medial/.qa';
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
  return page;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
async function goto(page, path) {
  await page.goto('http://localhost:3000' + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('.post, .create-post-page, .search-view, .login-card, .modern-login, .reels-page, .media-page', { timeout: 30000 }).catch(() => {});
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
const setVal = (page, sel, v) => page.evaluate(([sel, v]) => {
  const el = document.querySelector(sel);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, [sel, v]);
const goBack = async page => { await page.goBack({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {}); await sleep(750); };
const clickPost = (page, text, sel) => page.evaluate(([t, s]) => {
  [...document.querySelectorAll('article.post')].find(a => a.textContent.includes(t))?.querySelector(s)?.click();
}, [text, sel]);
const scrollPost = (page, text) => page.evaluate(t => {
  [...document.querySelectorAll('article.post')].find(a => a.textContent.includes(t))?.scrollIntoView({ block: 'center' });
}, text);

// ================= DESKTOP =================
const d = await newPage({ width: 1280, height: 900 });
await goto(d, '/');

ok('desktop: feed renders', await d.evaluate(() => document.querySelectorAll('.post').length >= 10));
ok('desktop: window scrollbar hidden', await d.evaluate(() => getComputedStyle(document.documentElement).scrollbarWidth === 'none'));
ok('desktop: no horizontal overflow', await d.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
ok('desktop: page-enter animation', await d.evaluate(() => getComputedStyle(document.querySelector('.page-enter')).animationName === 'pageIn'));
await shot(d, 'desktop-feed');

const mix = await articleBy(d, 'Weekend in Pokhara');
const mixInfo = await d.evaluate(el => {
  const m = el.querySelector('.media-mosaic');
  return { cls: m.className, cells: m.querySelectorAll('.mosaic-cell').length, more: m.querySelector('.media-more')?.textContent, preview: !!m.querySelector('.post-video.preview'), previewPaused: m.querySelector('.post-video video')?.paused };
}, mix);
ok('desktop: p_mix stack n5, 5 cells, +3', mixInfo.cls.includes('stack n5') && mixInfo.cells === 5 && mixInfo.more === '+3', JSON.stringify(mixInfo));
ok('desktop: mixed video is paused preview', mixInfo.preview && mixInfo.previewPaused);
await mix.asElement().screenshot({ path: `${OUT}/desktop-mosaic.png` });

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
await sleep(1200);
ok('desktop: video resumes when back in view', await d.evaluate(() => {
  const a = [...document.querySelectorAll('article.post')].find(x => x.textContent.includes('Rain over New Road'));
  return a?.querySelector('.media-mosaic.single video')?.paused === false;
}));

// Mixed video click -> dedicated media route, plays at 1/8
await scrollPost(d, 'Weekend in Pokhara');
await sleep(400);
await clickPost(d, 'Weekend in Pokhara', '.post-video .video-play');
await d.waitForSelector('.media-page', { timeout: 8000 });
await sleep(1200);
const viewer1 = await d.evaluate(() => ({
  path: location.pathname,
  count: document.querySelector('.media-page-count')?.textContent,
  playing: !document.querySelector('.media-page-slide video')?.paused,
  muted: document.querySelector('.media-page-slide video')?.muted,
  slides: document.querySelectorAll('.media-page-slide').length,
  snap: getComputedStyle(document.querySelector('.media-page-scroll')).scrollSnapType
}));
ok('desktop: media opens as separate route at 1/8, video plays with sound', /\/post\/.+\/media\/0$/.test(viewer1.path) && viewer1.count === '1 / 8' && viewer1.playing && viewer1.muted === false && viewer1.slides === 8 && viewer1.snap.includes('mandatory'), JSON.stringify(viewer1));
await shot(d, 'desktop-media-video');
await d.keyboard.press('ArrowDown');
await sleep(700);
ok('desktop: ArrowDown advances to 2/8', await d.evaluate(() => document.querySelector('.media-page-count')?.textContent === '2 / 8'));

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
  return { commentSpan: a.querySelector('[aria-label="Comments"] span')?.textContent, reactSpan: a.querySelector('.post-actions .reaction-trigger span')?.textContent, totalComments, totalReactions };
}, mixId);
ok('desktop: post totals include per-media comments+reactions', agg.commentSpan === String(agg.totalComments) && agg.reactSpan === String(agg.totalReactions), JSON.stringify(agg));

// Open-at-index + swipe direction correctness
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
ok('desktop: swipe down advances one slide to 4/4', await d.evaluate(() => document.querySelector('.media-page-count')?.textContent === '4 / 4'));
await d.mouse.wheel({ deltaY: -650 });
await sleep(900);
ok('desktop: swipe up returns to previous slide 3/4 (not top)', await d.evaluate(() => document.querySelector('.media-page-count')?.textContent === '3 / 4'));
await d.evaluate(() => { const el = document.querySelector('.media-page-scroll'); el.scrollTo({ top: el.clientHeight * 3, behavior: 'instant' }); });
await sleep(500);
ok('desktop: scroll reaches 4/4', await d.evaluate(() => document.querySelector('.media-page-count')?.textContent === '4 / 4'));
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
  return el ? { text: el.textContent, color: getComputedStyle(el).color } : null;
});
ok('desktop: reply @mention rendered in blue', mention && mention.text.startsWith('@') && mention.color === 'rgb(29, 111, 214)', JSON.stringify(mention));

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

// Entry chooser from the rail + button
await goto(d, '/');
await d.click('.post-btn');
await d.waitForSelector('.chooser-overlay', { timeout: 5000 });
await sleep(350);
const entryChooser = await d.evaluate(() => [...document.querySelectorAll('.chooser-options button b')].map(b => b.textContent));
ok('desktop: + button opens Post/Reels chooser', JSON.stringify(entryChooser) === JSON.stringify(['Post', 'Reels']), JSON.stringify(entryChooser));
await shot(d, 'desktop-chooser-entry');
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
await d.evaluate(() => document.querySelector('.create-publish').click());
await d.waitForSelector('.chooser-overlay', { timeout: 5000 });
const pubChooser = await d.evaluate(() => ({
  options: [...document.querySelectorAll('.chooser-options button b')].map(b => b.textContent),
  reelEnabled: !document.querySelectorAll('.chooser-options button')[1].disabled
}));
ok('desktop: publish chooser offers Post + enabled Reel', JSON.stringify(pubChooser.options) === JSON.stringify(['Post', 'Reel']) && pubChooser.reelEnabled, JSON.stringify(pubChooser));
await d.evaluate(() => document.querySelectorAll('.chooser-options button')[1].click());
await d.waitForSelector('.publish-overlay', { timeout: 5000 });
const pctEarly = await d.evaluate(() => document.querySelector('.publish-pct')?.textContent);
const reelLabel = await d.evaluate(() => document.querySelector('.publish-card b')?.textContent);
await sleep(700);
const pctLater = await d.evaluate(() => document.querySelector('.publish-pct')?.textContent);
ok('desktop: publish ring stages % and labels reel', /^\d+%$/.test(pctEarly || '') && parseInt(pctLater) > parseInt(pctEarly) && /reel/i.test(reelLabel || ''), `${pctEarly} -> ${pctLater} / ${reelLabel}`);
await shot(d, 'desktop-publish-progress');
await d.waitForFunction(() => location.pathname === '/', { timeout: 10000 });
await sleep(900);
ok('desktop: reel published with kind reel', await d.evaluate(() => JSON.parse(localStorage.getItem('exposing-demo-v1')).posts[0].kind === 'reel'));

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
await d.evaluate(() => document.querySelector('.create-publish').click());
await d.waitForSelector('.chooser-overlay', { timeout: 5000 });
await d.evaluate(() => document.querySelectorAll('.chooser-options button')[0].click());
await d.waitForFunction(() => location.pathname === '/', { timeout: 10000 });
await sleep(900);
const published = await d.evaluate(() => {
  const first = document.querySelector('article.post');
  return { text: first?.textContent.includes('Long caption test'), tags: first?.querySelectorAll('.post-tag').length };
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
await d.evaluate(() => document.querySelector('.create-publish').click());
await d.waitForSelector('.chooser-overlay', { timeout: 5000 });
await d.evaluate(() => document.querySelectorAll('.chooser-options button')[0].click());
await d.waitForFunction(() => location.pathname === '/', { timeout: 10000 });
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

// Reels page (desktop)
await goto(d, '/video');
await d.waitForSelector('.reels-page', { timeout: 10000 });
await sleep(1500);
const reels1 = await d.evaluate(() => ({
  slides: document.querySelectorAll('.reel-slide').length,
  playing: !document.querySelector('.reel-slide video')?.paused,
  muted: document.querySelector('.reel-slide video')?.muted,
  snap: getComputedStyle(document.querySelector('.reels-scroll')).scrollSnapType,
  rail: !!document.querySelector('.reel-rail'),
  onlyVideos: [...document.querySelectorAll('.reel-slide video')].length === document.querySelectorAll('.reel-slide').length,
  caption: !!document.querySelector('.reel-meta'),
  noFeedCards: !document.querySelector('article.post')
}));
ok('desktop: reels page = video-only snap feed with sound on', reels1.slides >= 2 && reels1.playing && reels1.muted === false && reels1.snap.includes('mandatory') && reels1.rail && reels1.onlyVideos && reels1.caption && reels1.noFeedCards, JSON.stringify(reels1));
await shot(d, 'desktop-reels');
// double-tap right = +10s
const t0 = await d.evaluate(() => document.querySelector('.reel-slide video').currentTime);
await d.mouse.click(800, 450);
await sleep(90);
await d.mouse.click(800, 450);
await sleep(350);
const seekR = await d.evaluate(() => ({ t: document.querySelector('.reel-slide video').currentTime, badge: !!document.querySelector('.av-seek.right') }));
ok('desktop: double-tap right seeks +10s with badge', (seekR.t > t0 + 9 || seekR.t < t0) && seekR.badge, JSON.stringify({ t0, ...seekR, note: 'wrap allowed: 5s clip loops at end' }));
await shot(d, 'desktop-reels-seek');
await sleep(600);
const t1 = await d.evaluate(() => document.querySelector('.reel-slide video').currentTime);
await d.mouse.click(480, 450);
await sleep(90);
await d.mouse.click(480, 450);
await sleep(350);
const seekL = await d.evaluate(() => ({ t: document.querySelector('.reel-slide video').currentTime, badge: !!document.querySelector('.av-seek.left') }));
ok('desktop: double-tap left seeks -10s with badge', (seekL.t < t1 || seekL.t === 0) && seekL.badge, JSON.stringify({ t1, ...seekL }));
await sleep(600);
// single tap pauses / resumes
await d.mouse.click(640, 450);
await sleep(500);
ok('desktop: single tap pauses reel', await d.evaluate(() => document.querySelector('.reel-slide video').paused));
await d.mouse.click(640, 450);
await sleep(600);
ok('desktop: single tap resumes reel', await d.evaluate(() => !document.querySelector('.reel-slide video').paused));
// rail actions
const railBefore = await d.evaluate(() => {
  const btn = document.querySelector('.reel-rail-item button[aria-label="Like this reel"], .reel-rail-item button[aria-label="Remove reaction"]');
  const label = btn?.getAttribute('aria-label');
  btn?.click();
  return { label };
});
await sleep(400);
const railAfter = await d.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('exposing-demo-v1'));
  const newest = db.posts.filter(p => p.media.some(m => m.type === 'video')).sort((a, b) => b.ts - a.ts)[0];
  return { newestId: newest?.id, newestKind: newest?.kind, mine: db.reactions.filter(r => r.targetType === 'post' && r.targetId === newest?.id && r.uid === db.meId).map(r => r.kind), path: location.pathname };
});
ok('desktop: reel rail like stores post reaction', railAfter.mine.length > 0 && railAfter.newestKind === 'reel' && railBefore.label === 'Like this reel', JSON.stringify({ ...railBefore, ...railAfter }));
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

// FAB opens the entry chooser
await m.tap('.post-fab');
await m.waitForSelector('.chooser-overlay', { timeout: 5000 });
await sleep(400);
ok('mobile: Post + fab opens Post/Reels chooser', await m.evaluate(() => [...document.querySelectorAll('.chooser-options button b')].map(b => b.textContent).join(',') === 'Post,Reels'));
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
await m.evaluate(() => { const el = document.querySelector('.media-page-scroll'); el.scrollTo({ top: el.clientHeight * 3, behavior: 'smooth' }); });
await sleep(900);
ok('mobile: swipe down reaches 4/4', await m.evaluate(() => document.querySelector('.media-page-count')?.textContent === '4 / 4'));
await m.evaluate(() => { const el = document.querySelector('.media-page-scroll'); el.scrollTo({ top: el.clientHeight * 2, behavior: 'smooth' }); });
await sleep(900);
ok('mobile: swipe up returns to 3/4, not first', await m.evaluate(() => document.querySelector('.media-page-count')?.textContent === '3 / 4'));
await goBack(m);
ok('mobile: phone-back from media page returns to feed', await m.evaluate(() => location.pathname === '/' && !document.querySelector('.media-page')));

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
  return { bottom: c.bottom, pos: getComputedStyle(document.querySelector('.post-page-comments .comments-compose')).position };
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
await clearKb(m);

// Mobile publish via chooser + progress
await m.evaluate(() => { const b = document.querySelector('.create-post-body'); b.scrollTop = 0; });
await m.type('.create-post-textarea', 'QA mobile publish');
await m.evaluate(() => document.querySelector('.create-publish').click());
await m.waitForSelector('.chooser-overlay', { timeout: 5000 });
await sleep(400);
await shot(m, 'mobile-chooser');
await m.evaluate(() => document.querySelectorAll('.chooser-options button')[0].click());
await m.waitForSelector('.publish-overlay', { timeout: 5000 });
await shot(m, 'mobile-publish-progress');
await m.waitForFunction(() => location.pathname === '/', { timeout: 10000 });
await sleep(900);
ok('mobile: chooser + progress publishes to feed', await m.evaluate(() => document.querySelector('article.post')?.textContent.includes('QA mobile publish')));

// Reels on mobile
await goto(m, '/video');
await m.waitForSelector('.reels-page', { timeout: 10000 });
await sleep(1500);
const mReels = await m.evaluate(() => ({
  slides: document.querySelectorAll('.reel-slide').length,
  playing: !document.querySelector('.reel-slide video')?.paused,
  muted: document.querySelector('.reel-slide video')?.muted,
  rail: !!document.querySelector('.reel-rail'),
  meta: !!document.querySelector('.reel-meta'),
  noNav: !document.querySelector('.mobile-nav')
}));
ok('mobile: reels full-screen video feed, sound on, rail + caption', mReels.slides >= 2 && mReels.playing && mReels.muted === false && mReels.rail && mReels.meta && mReels.noNav, JSON.stringify(mReels));
await shot(m, 'mobile-reels');
const mt0 = await m.evaluate(() => document.querySelector('.reel-slide video').currentTime);
await m.touchscreen.tap(300, 400);
await sleep(90);
await m.touchscreen.tap(300, 400);
await sleep(350);
const mSeekR = await m.evaluate(() => ({ t: document.querySelector('.reel-slide video').currentTime, badge: !!document.querySelector('.av-seek.right') }));
ok('mobile: double-tap right seeks +10s', (mSeekR.t > mt0 + 9 || mSeekR.t < mt0) && mSeekR.badge, JSON.stringify({ mt0, ...mSeekR }));
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
await m.evaluate(() => document.querySelector('.reel-home').click());
await sleep(800);
ok('mobile: reels home button returns to feed', await m.evaluate(() => location.pathname === '/'));

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

await m.close();
await browser.close();

ok('no uncaught page errors', !errors.some(e => e.startsWith('pageerror')), errors.filter(e => e.startsWith('pageerror')).join(' | '));
console.log('\nResource/console errors (informational):');
[...new Set(errors)].slice(0, 12).forEach(e => console.log('  ' + e));
const failed = results.filter(r => !r.pass);
console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 2));
process.exit(failed.length ? 1 : 0);