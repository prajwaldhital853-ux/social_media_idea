import puppeteer from 'puppeteer-core';
import { retryWrite } from './shots.mjs';
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:3000';
const PASS = 'exposing-demo-1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = 'D:/social_medial/.qa';

const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--lang=en-US', '--force-device-scale-factor=1'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });

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
await sleep(1500);

// 1. action icons at thumb size on mobile
const icon = await page.evaluate(() => {
  const svg = document.querySelector('article.post .post-actions .action-btn svg');
  const btn = document.querySelector('article.post .post-actions .action-btn');
  if (!svg || !btn) return null;
  const s = svg.getBoundingClientRect(), b = btn.getBoundingClientRect();
  return { svg: Math.round(s.width), btnH: Math.round(b.height), font: getComputedStyle(btn).fontSize };
});
ok('mobile action icons are 28px', !!icon && icon.svg === 28, JSON.stringify(icon));
ok('mobile action buttons have taller hit targets', !!icon && icon.btnH >= 48, `height ${icon?.btnH}`);
await retryWrite(() => page.screenshot({ path: `${OUT}/b-mobile-feed-top.png` }));

// 2. media heights on mobile
const mosaic = await page.evaluate(() => {
  const out = {};
  for (const a of [...document.querySelectorAll('article.post .media-mosaic')]) {
    for (const c of ['single', 'two', 'three', 'four', 'stack', 'mixed']) {
      if (a.classList.contains(c)) {
        const h = Math.round(a.getBoundingClientRect().height);
        (out[c] = out[c] || []).push(h);
        break;
      }
    }
  }
  return out;
});
const vh = 844;
const single = mosaic.single || [];
ok('mobile single image is taller (66svh)', single.length > 0 && single.some(h => h >= 0.62 * vh), JSON.stringify(mosaic));
const grid = ['two', 'three', 'four'].flatMap(c => mosaic[c] || []);
ok('mobile two/three/four mosaics are 320px tall', grid.length === 0 || grid.every(h => Math.abs(h - 320) <= 2), JSON.stringify(grid));
const stack = mosaic.stack || [];
ok('mobile stack mosaic is 360px tall', stack.length === 0 || stack.every(h => Math.abs(h - 360) <= 2), JSON.stringify(stack));
const mixed = mosaic.mixed || [];
ok('mobile mixed mosaic is 440px tall', mixed.length === 0 || mixed.every(h => Math.abs(h - 440) <= 2), JSON.stringify(mixed));

// 3. a scrolled view for the record
await page.evaluate(() => document.querySelectorAll('article.post')[1]?.scrollIntoView({ block: 'start' }));
await sleep(700);
await retryWrite(() => page.screenshot({ path: `${OUT}/b-mobile-feed-media.png` }));

// 4. desktop is untouched: same checks at 1440px
await page.setViewport({ width: 1440, height: 900 });
await goto('/');
await sleep(1500);
const desk = await page.evaluate(() => {
  const svg = document.querySelector('article.post .post-actions .action-btn svg');
  const out = { svg: svg ? Math.round(svg.getBoundingClientRect().width) : null, mosaic: {} };
  for (const a of [...document.querySelectorAll('article.post .media-mosaic')]) {
    for (const c of ['single', 'two', 'three', 'four', 'stack', 'mixed']) {
      if (a.classList.contains(c)) {
        (out.mosaic[c] = out.mosaic[c] || []).push(Math.round(a.getBoundingClientRect().height));
        break;
      }
    }
  }
  return out;
});
ok('desktop icons stay 24px', desk.svg === 24, `svg ${desk.svg}`);
const dSingle = desk.mosaic.single || [];
ok('desktop single image stays within 510px cap', dSingle.length === 0 || dSingle.every(h => h <= 512), JSON.stringify(desk.mosaic));
await retryWrite(() => page.screenshot({ path: `${OUT}/b-desktop-feed.png` }));

console.log(`== ${results.filter(Boolean).length}/${results.length} section B checks ==`);
await browser.close();
