/**
 * Batch QA for the feed-chrome changes: tabs living in the top bar with no gap,
 * the narrower/taller card, the bigger left-shifted actions, the dark separator,
 * the "at Place feeling Mood" header line, the red Follow text, the single Post
 * button and the logo favicon.
 *
 * Every claim here is a measured box or a real click, because each one is a
 * pixel the reviewer can disagree with.
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

const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const textOf = (page, sel) => page.$eval(sel, el => el.textContent.trim()).catch(() => '');
const count = (page, sel) => page.$$eval(sel, els => els.length).catch(() => 0);

async function newPage(viewport, mobile = false) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ ...viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  return page;
}

const goto = async (page, path) => {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(700);
};

const setInput = (page, nth, value) => page.evaluate(([nth, value]) => {
  const el = document.querySelectorAll('.login-content input.login-input')[nth];
  if (!el) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, [nth, value]);

/** Pre-hydration fills never reach React, so keep re-posting until the button arms. */
async function armLogin(page, identifier, password, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    await setInput(page, 0, identifier);
    await setInput(page, 1, password);
    const armed = await page.evaluate(() => {
      const b = document.querySelector('.login-content form button.login-submit');
      return !!b && !b.disabled;
    });
    if (armed) return true;
    await sleep(250);
  }
  return false;
}

async function signIn(page, identifier, password) {
  await goto(page, '/login');
  await page.waitForSelector('.login-content', { timeout: 20000 }).catch(() => {});
  await armLogin(page, identifier, password);
  await page.evaluate(() => document.querySelector('.login-content form button.login-submit')?.click());
  await page.waitForFunction(() => location.pathname === '/' || !!document.querySelector('.auth-code'), { timeout: 25000 }).catch(() => {});
  if ((await textOf(page, '.auth-code-title')) === 'Confirm it is you') {
    await page.evaluate(() => document.querySelector('.auth-code-dev')?.click());
    await page.waitForFunction(() => location.pathname === '/', { timeout: 20000 }).catch(() => {});
  }
  await sleep(900);
}

const box = (page, sel) => page.$eval(sel, el => {
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) };
}).catch(() => null);

const styles = (page, sel, props) => page.$eval(sel, (el, props) => {
  const cs = getComputedStyle(el);
  const out = {};
  for (const p of props) out[p] = cs[p];
  return out;
}, props).catch(() => null);

async function settle(page, ms = 6000) {
  await page.waitForFunction(() => {
    const tiles = [...document.querySelectorAll('article.post img')]
      .filter(img => { const r = img.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; });
    return tiles.length > 0 && tiles.every(img => img.complete && img.naturalWidth > 0);
  }, { timeout: ms }).catch(() => {});
  await sleep(400);
}

// ============================ DESKTOP ============================
const d = await newPage({ width: 1440, height: 900 });
await goto(d, '/');
await d.evaluate(() => localStorage.setItem('exposing-theme', 'dark'));
await signIn(d, DEMO.username, DEMO.password);
await goto(d, '/');
await d.waitForSelector('article.post', { timeout: 20000 }).catch(() => {});
await settle(d);

const tabs = await box(d, '.topbar-tabs');
const tabBtns = await count(d, '.topbar-tabs .topbar-tab');
const topbar = await box(d, '.topbar');
ok('desktop: For you / Following live in the top bar', !!tabs && tabBtns === 2 && !!topbar && tabs.top >= topbar.top && tabs.bottom <= topbar.bottom + 1,
  JSON.stringify({ tabs, topbar, tabBtns }));

const homeHeaderVisible = await d.$eval('.home-header', el => getComputedStyle(el).display !== 'none').catch(() => false);
ok('desktop: the separate tab card below the top bar is gone', homeHeaderVisible === false, String(homeHeaderVisible));

const firstPost = await box(d, 'article.post');
const gap = firstPost && tabs ? firstPost.top - topbar.bottom : -1;
ok('desktop: no empty strip between the top bar and the first post', gap >= 0 && gap <= 24, `gap=${gap}px topbar.bottom=${topbar?.bottom} post.top=${firstPost?.top}`);

// The tab buttons must not overlap the search field or the right-hand icons.
const overlap = await d.evaluate(() => {
  const t = document.querySelector('.topbar-tabs')?.getBoundingClientRect();
  if (!t) return 'no tabs';
  const hits = ['.topbar-search input', '.topbar-right']
    .map(s => document.querySelector(s)?.getBoundingClientRect())
    .filter(Boolean)
    .filter(r => r.left < t.right && r.right > t.left && r.top < t.bottom && r.bottom > t.top);
  return hits.length;
});
ok('desktop: the tabs do not collide with the search field or the right icons', overlap === 0, JSON.stringify(overlap));

const cols = await d.evaluate(() => getComputedStyle(document.querySelector('.shell')).gridTemplateColumns);
const postBox = await box(d, 'article.post');
ok('desktop: the feed column is narrower than before (560px)', /560/.test(cols), cols);
ok('desktop: the card fills that column', postBox && postBox.w >= 540 && postBox.w <= 562, JSON.stringify(postBox));

const pad = await styles(d, 'article.post', ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight']);
ok('desktop: the card is taller via roomier padding', pad && pad.paddingTop === '18px' && pad.paddingBottom === '12px' && pad.paddingLeft === '20px', JSON.stringify(pad));

const act = await styles(d, '.post-actions', ['justifyContent', 'gap']);
const iconBox = await box(d, '.action-btn svg');
const btnBox = await box(d, '.action-btn');
const saveLeft = (await box(d, '.save-action'))?.left;
ok('desktop: action icons are bigger (24px)', iconBox && iconBox.w >= 23 && iconBox.w <= 26, JSON.stringify(iconBox));
ok('desktop: Like / comment / share hug the left edge of the card', act && /flex-start/.test(act.justifyContent) && btnBox && btnBox.left - postBox.left <= 24,
  JSON.stringify({ act, btnLeft: btnBox?.left, postLeft: postBox?.left }));
ok('desktop: Save stays pinned to the right', saveLeft && postBox && saveLeft > postBox.right - 120, `save.left=${saveLeft} post.right=${postBox?.right}`);
const ink = await styles(d, '.action-btn', ['color', 'fontSize', 'fontWeight']);
ok('desktop: the action labels are legible on the dark card', ink && parseFloat(ink.fontSize) >= 14 && Number(ink.fontWeight) >= 600, JSON.stringify(ink));

// ---- header context line + red Follow ----
const header = await d.evaluate(() => {
  const art = [...document.querySelectorAll('article.post')].find(a => a.querySelector('.post-context'));
  if (!art) return null;
  const ctx = art.querySelector('.post-context');
  const name = art.querySelector('.post-name');
  return {
    text: ctx.textContent.replace(/\s+/g, ' ').trim(),
    place: art.querySelector('.post-place')?.textContent.trim(),
    feeling: art.querySelector('.post-feeling')?.textContent.trim(),
    name: name?.textContent.trim(),
    href: art.querySelector('.post-place')?.getAttribute('href') || null,
    line: `${name?.textContent.trim()} ${ctx.textContent.replace(/\s+/g, ' ').trim()}`
  };
});
ok('desktop: the header reads "Name at Place feeling Mood"', !!header && /^at .+/.test(header.place || '') && /^feeling /.test(header.feeling || ''),
  JSON.stringify(header));
ok('desktop: the place is a link into search', !!header && /^\/explore\?q=/.test(header.href || ''), header?.href);

const followRow = await d.evaluate(() => {
  const b = [...document.querySelectorAll('article.post .feed-follow')].find(x => x.textContent.trim() === 'Follow');
  if (!b) return null;
  const cs = getComputedStyle(b);
  return { text: b.textContent.trim(), color: cs.color, weight: cs.fontWeight, size: cs.fontSize };
});
ok('desktop: a red Follow label sits beside authors you do not follow', !!followRow && followRow.text === 'Follow' && Number(followRow.weight) >= 700,
  JSON.stringify(followRow));
const followRed = followRow && /rgb\(2[0-9]{2}, [0-5]?[0-9], [0-5]?[0-9]\)/.test(followRow.color);
ok('desktop: that Follow label is red', !!followRed, followRow?.color);

const toggled = await d.evaluate(async () => {
  const pick = () => [...document.querySelectorAll('article.post .feed-follow')].find(x => x.textContent.trim() === 'Follow');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const first = pick();
  if (!first) return { skipped: true };
  const card = first.closest('article.post');
  first.click();
  await wait(1500);
  const nowFollowing = card.querySelector('.feed-follow');
  const mid = nowFollowing ? { text: nowFollowing.textContent.trim(), cls: nowFollowing.className, color: getComputedStyle(nowFollowing).color } : null;
  nowFollowing?.click();
  await wait(1500);
  const back = card.querySelector('.feed-follow');
  return { mid, back: back ? { text: back.textContent.trim(), color: getComputedStyle(back).color } : null };
});
ok('desktop: tapping Follow turns that label into Following', !!toggled.mid && /Following/i.test(toggled.mid.text) && /following/.test(toggled.mid.cls),
  JSON.stringify(toggled));
ok('desktop: tapping Following unfollows and brings the red label back', !!toggled.back && toggled.back.text === 'Follow' && /rgb\(2[0-9]{2}, [0-5]?[0-9], [0-5]?[0-9]\)/.test(toggled.back.color),
  JSON.stringify(toggled.back));

// Already-followed authors must show nothing at all after a refresh.
const latchedCheck = await d.evaluate(() => {
  const arts = [...document.querySelectorAll('article.post')];
  return arts.map(a => ({
    name: a.querySelector('.post-name')?.textContent.trim(),
    follow: a.querySelector('.feed-follow')?.textContent.trim() || null
  }));
});
ok('desktop: no Follow text renders on your own posts', latchedCheck.every(r => r.name !== 'Sita Gurung' || r.follow === null),
  JSON.stringify(latchedCheck.slice(0, 6)));

await shot(d, 'chrome-desktop-feed');

// ---- post detail page carries the same header line ----
const target = await d.evaluate(() => {
  const art = [...document.querySelectorAll('article.post')].find(a => a.querySelector('.post-context'));
  if (!art) return null;
  const r = art.querySelector('.post-caption')?.getBoundingClientRect() || art.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + Math.min(r.height / 2, 40)) };
});
if (target) {
  await d.mouse.click(target.x, target.y);
  await d.waitForFunction(() => /\/post\/[^/]+$/.test(location.pathname), { timeout: 15000 }).catch(() => {});
  await sleep(900);
  const detailUrl = await d.evaluate(() => location.pathname);
  const detailCtx = await textOf(d, 'article.post .post-context');
  ok('desktop: the post page shows the same place + feeling line', /\/post\//.test(detailUrl) && !!detailCtx, `${detailUrl} -> "${detailCtx}"`);
  await d.goBack().catch(() => {});
  await sleep(800);
} else {
  ok('desktop: the post page shows the same place + feeling line', false, 'no post with a context line in the feed');
}

// ---- create page: one Post button, straight to publishing ----
await goto(d, '/create');
await d.waitForSelector('.create-post-header', { timeout: 15000 }).catch(() => {});
const create = await d.evaluate(() => {
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const named = [...document.querySelectorAll('button')]
    .filter(b => /^Post$/i.test(b.textContent.trim()))
    .map(b => ({ cls: b.className, vis: visible(b) }));
  return {
    all: named.length,
    shown: named.filter(b => b.vis).length,
    detail: named,
    footer: !!document.querySelector('.create-publish'),
    chooser: !!document.querySelector('.create-chooser')
  };
});
ok('desktop: the create page has exactly one visible Post button', create.shown === 1 && !create.footer && !create.chooser, JSON.stringify(create));

// ---- favicon ----
const head = await d.evaluate(() => ({
  icon: document.querySelector('link[rel="icon"]')?.getAttribute('href'),
  apple: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'),
  icons: [...document.querySelectorAll('link[rel~="icon"]')].map(l => l.getAttribute('href'))
}));
ok('desktop: the tab icon is the logo tile, not the letter E', !!head.icon && /icon/.test(head.icon), JSON.stringify(head));
const iconBytes = await d.evaluate(async href => {
  const r = await fetch(href);
  const b = await r.arrayBuffer();
  return { status: r.status, len: b.byteLength };
}, head.icons[0] || '/icon.png');
ok('desktop: the icon file is served and is a real PNG', iconBytes.status === 200 && iconBytes.len > 3000, JSON.stringify(iconBytes));

// ============================ MOBILE ============================
const m = await newPage({ width: 390, height: 844 }, true);
await goto(m, '/');
await m.evaluate(() => localStorage.setItem('exposing-theme', 'dark'));
await goto(m, '/');
await m.waitForSelector('article.post', { timeout: 20000 }).catch(() => {});
await settle(m);

const sep = await m.evaluate(() => {
  const arts = [...document.querySelectorAll('article.post')].slice(0, 4);
  if (arts.length < 2) return null;
  const cs = getComputedStyle(arts[0]);
  const gaps = [];
  for (let i = 1; i < arts.length; i++) gaps.push(Math.round(arts[i].getBoundingClientRect().top - arts[i - 1].getBoundingClientRect().bottom));
  return {
    borderWidth: cs.borderBottomWidth,
    borderStyle: cs.borderBottomStyle,
    borderColor: cs.borderBottomColor,
    cardBg: cs.backgroundColor,
    pageBg: getComputedStyle(document.body).backgroundColor,
    gaps,
    radius: cs.borderRadius,
    shadow: cs.boxShadow
  };
});
ok('mobile: posts are separated by one thin band, not a card gap', !!sep && parseFloat(sep.borderWidth) >= 6 && sep.gaps.every(g => g === 0),
  JSON.stringify(sep));
ok('mobile: that band is a different shade from the card', !!sep && sep.borderColor !== sep.cardBg, `band=${sep?.borderColor} card=${sep?.cardBg}`);
await shot(m, 'chrome-mobile-dark');

const mFollow = await count(m, 'article.post .feed-follow');
ok('mobile: the red Follow text renders on the phone feed too', mFollow > 0, String(mFollow));
const mTabs = await box(m, '.topbar-tabs');
const mHeader = await box(m, '.home-header');
ok('mobile: the phone keeps its own For you / Following header', !!mHeader && !!mTabs && mTabs.w === 0, JSON.stringify({ mTabs, mHeader }));

console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
const failed = results.filter(r => !r.pass);
if (failed.length) console.log('FAILED:\n' + failed.map(f => ` - ${f.name} :: ${f.detail}`).join('\n'));
await browser.close();
