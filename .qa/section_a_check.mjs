import puppeteer from 'puppeteer-core';
import { retryWrite } from './shots.mjs';
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:3000';
const PASS = 'exposing-demo-1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = 'D:/social_medial/.qa';

const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--lang=en-US', '--force-device-scale-factor=1'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const results = [];
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const goto = async path => { await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 45000 }); await sleep(1000); };
const textOf = sel => page.evaluate(s => (document.querySelector(s)?.textContent || '').trim(), sel);

async function signOut() {
  await goto('/settings');
  await page.waitForSelector('.settings-logout', { timeout: 10000 }).catch(() => {});
  await page.evaluate(() => document.querySelector('.settings-logout')?.click());
  await page.waitForFunction(() => location.pathname === '/login', { timeout: 15000 }).catch(() => {});
  await sleep(600);
}
async function signIn(identifier) {
  await goto('/login');
  if (!(await page.$('.login-content'))) { await signOut(); await goto('/login'); }
  await page.evaluate(([identifier, pass]) => {
    const set = (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const inputs = [...document.querySelectorAll('.login-content input.login-input')];
    set(inputs[0], identifier); set(inputs[1], pass);
    document.querySelector('.login-content form button.login-submit')?.click();
  }, [identifier, PASS]);
  await page.waitForFunction(() => location.pathname === '/' || !!document.querySelector('.auth-code'), { timeout: 25000 }).catch(() => {});
  if ((await textOf('.auth-code-title')) === 'Confirm it is you') {
    await page.evaluate(() => document.querySelector('.auth-code-dev')?.click());
    await page.waitForFunction(() => location.pathname === '/', { timeout: 20000 }).catch(() => {});
  }
  await sleep(900);
}

await signIn('sita');
await goto('/');
await sleep(1200);

// 1. no @handle in any post card header
const handles = await page.evaluate(() => [...document.querySelectorAll('article.post .post-handle')].length);
ok('feed cards show no @username', handles === 0, `${handles} handles`);
await retryWrite(() => page.screenshot({ path: `${OUT}/a-feed-no-handle.png` }));

// 2. follow text only on non-followed authors; clicking hides it immediately and persists
const before = await page.evaluate(() => [...document.querySelectorAll('article.post')].slice(0, 12).map(a => ({
  handle: a.querySelector('.post-handle')?.textContent || '',
  name: a.querySelector('.post-name')?.textContent?.trim() || '',
  follow: a.querySelector('.feed-follow')?.textContent?.trim() || null,
  cls: a.querySelector('.feed-follow')?.className || '',
})));
const followingRows = before.filter(r => r.cls.includes('following')).length;
ok('no lingering "Following" text in the feed', followingRows === 0, JSON.stringify(before.filter(r => r.follow).slice(0, 4)));

const target = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('article.post .feed-follow')].find(b => b.textContent.trim() === 'Follow');
  if (!btn) return null;
  const art = btn.closest('article');
  return { name: art?.querySelector('.post-name')?.textContent?.trim(), top: art?.getBoundingClientRect().top };
});
if (target) {
  const hit = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('article.post .feed-follow')].find(b => b.textContent.trim() === 'Follow');
    if (!btn) return null;
    const art = btn.closest('article');
    art.dataset.probe = '1';
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    return {
      name: art.querySelector('.post-name')?.textContent?.trim(),
      href: art.querySelector('.post-name')?.getAttribute('href') || '',
    };
  });
  await sleep(700);
  const toast = await page.evaluate(() => document.querySelector('.toast')?.textContent?.trim() || '');
  await sleep(1600);
  const after = await page.evaluate(() => {
    const row = document.querySelector('article.post[data-probe="1"]');
    return { probe: row ? (row.querySelector('.feed-follow')?.textContent?.trim() || '(hidden)') : 'row gone' };
  });
  // A public follow confirms silently (the toast is reserved for requests), so
  // only the text itself has to disappear.
  ok('tap hides the follow text immediately', after.probe === '(hidden)', JSON.stringify({ clicked: hit?.name, toast, after: after.probe }));
  await retryWrite(() => page.screenshot({ path: `${OUT}/a-follow-tapped.png` }));
  await goto('/');
  await sleep(1800);
  const fresh = await page.evaluate(href => {
    const rows = [...document.querySelectorAll('article.post')].filter(a => a.querySelector('.post-name')?.getAttribute('href') === href);
    if (!rows.length) return 'author rows gone';
    const texts = rows.map(a => a.querySelector('.feed-follow')?.textContent?.trim() || '(hidden)');
    return texts.every(t => t === '(hidden)') ? '(hidden)' : texts.join(',');
  }, hit?.href);
  ok('after a fresh load the author still shows no follow text', fresh === '(hidden)', fresh);
} else {
  ok('a followable author existed in the feed', false, 'no Follow text found to click');
}

// 3. profile stats: followers/following further apart
await goto('/u/arjun');
await sleep(1200);
const gap = await page.evaluate(() => {
  const stats = [...document.querySelectorAll('.profile-stat')];
  const f = stats.find(s => /Follower/i.test(s.textContent));
  const g = stats.find(s => /Following/i.test(s.textContent));
  if (!f || !g) return null;
  return { gapPx: Math.round(g.getBoundingClientRect().left - f.getBoundingClientRect().right), ml: getComputedStyle(g).marginLeft };
});
ok('followers/following chips have the wider desktop gap', !!gap && gap.gapPx >= 20, JSON.stringify(gap));
await retryWrite(() => page.screenshot({ path: `${OUT}/a-profile-stats-gap.png` }));

console.log(`== ${results.filter(Boolean).length}/${results.length} section A checks ==`);
await browser.close();
