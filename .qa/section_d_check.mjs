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
await sleep(1500);

// 1. notifications: clicking a row performs the action (navigates), not just close
await page.evaluate(() => document.querySelector('.topbar-slot [aria-label="Notifications"]')?.click());
await page.waitForSelector('.notif-row .notif-open', { timeout: 8000 }).catch(() => {});
await sleep(400);
const panelOpen = await page.evaluate(() => !!document.querySelector('.topbar-panel'));
const rowInfo = await page.evaluate(() => {
  const row = document.querySelector('.notif-row .notif-open');
  return { exists: !!row, unreadBefore: document.querySelectorAll('.notif-row.unread').length };
});
let nav1 = null;
let after1 = null;
if (rowInfo.exists) {
  await Promise.all([
    page.evaluate(() => document.querySelector('.notif-row .notif-open')?.click()),
    page.waitForFunction(() => location.pathname !== '/', { timeout: 8000 }).then(() => { nav1 = page.url(); }).catch(() => {}),
  ]);
  await sleep(900);
  after1 = await page.evaluate(() => ({ path: location.pathname, panel: !!document.querySelector('.topbar-panel') }));
}
ok('bell panel opens', panelOpen, '');
ok('clicking a notification row performs it (navigates)', !!nav1, `landed ${nav1 || (after1 ? JSON.stringify(after1) : '(stayed on feed)')}`);
await retryWrite(() => page.screenshot({ path: `${OUT}/d-notif-row-open.png` }));

// 2. in-panel tab switch survives: open panel, click Unread, panel stays and tab activates
await goto('/');
await sleep(1200);
await page.evaluate(() => document.querySelector('.topbar-slot [aria-label="Notifications"]')?.click());
await sleep(800);
await page.evaluate(() => [...document.querySelectorAll('.panel-tabs button')].find(b => /unread/i.test(b.textContent || ''))?.click());
await sleep(600);
const tabState = await page.evaluate(() => ({
  panel: !!document.querySelector('.topbar-panel'),
  unreadActive: [...document.querySelectorAll('.panel-tabs button')].find(b => /unread/i.test(b.textContent || ''))?.classList.contains('active'),
}));
ok('panel tab switch works on first click', tabState.panel && tabState.unreadActive === true, JSON.stringify(tabState));

// 3. messages: clicking a conversation opens the thread
await page.evaluate(() => document.querySelector('.topbar-slot [aria-label="Messages"]')?.click());
await page.waitForSelector('.inbox-list button, .inbox-list a', { timeout: 8000 }).catch(() => {});
await sleep(400);
const convoInfo = await page.evaluate(() => !!document.querySelector('.inbox-list .conversation-row, .inbox-list button, .inbox-list a'));
let nav2 = null;
let after2 = null;
if (convoInfo) {
  await Promise.all([
    page.evaluate(() => document.querySelector('.inbox-list')?.querySelector('button, a')?.click()),
    page.waitForFunction(() => location.pathname.startsWith('/messages/'), { timeout: 8000 }).then(() => { nav2 = page.url(); }).catch(() => {}),
  ]);
  await sleep(900);
  after2 = await page.evaluate(() => ({ path: location.pathname, panel: !!document.querySelector('.topbar-panel') }));
}
ok('messages panel: clicking a conversation opens the thread', !!nav2, `landed ${nav2 || (after2 ? JSON.stringify(after2) : '(stayed)')}`);
await retryWrite(() => page.screenshot({ path: `${OUT}/d-convo-open.png` }));

// 4. outside click still dismisses
await goto('/');
await sleep(1200);
await page.evaluate(() => document.querySelector('.topbar-slot [aria-label="Notifications"]')?.click());
await sleep(700);
await page.click('.post');
await sleep(500);
const closed = await page.evaluate(() => !document.querySelector('.topbar-panel'));
ok('outside click still closes the panel', closed, '');

console.log(`== ${results.filter(Boolean).length}/${results.length} section D checks ==`);
await browser.close();
