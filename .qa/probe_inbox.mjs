// Probe: why does the inbox column show only two rows once a thread is open?
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:3000';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=en-US'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const setInput = (nth, value) => page.evaluate(([nth, value]) => {
  const el = document.querySelectorAll('.login-content input.login-input')[nth];
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, [nth, value]);

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.login-content', { timeout: 20000 });
await setInput(0, 'sita');
await setInput(1, 'exposing-demo-1');
await page.evaluate(() => document.querySelector('.login-content form button.login-submit')?.click());
await page.waitForFunction(() => location.pathname === '/' || !!document.querySelector('.auth-code'), { timeout: 25000 });
if ((await page.$('.auth-code'))) {
  await page.evaluate(() => document.querySelector('.auth-code-dev')?.click());
  await page.waitForFunction(() => location.pathname === '/', { timeout: 20000 });
}

await page.goto(`${BASE}/messages`, { waitUntil: 'domcontentloaded' });
await sleep(2500);
const before = await page.evaluate(() => ({
  rows: document.querySelectorAll('.messenger-side .inbox-row').length,
  names: [...document.querySelectorAll('.messenger-side .inbox-row b')].map(b => b.textContent.trim()),
  first: document.querySelector('.messenger-side .inbox-row b')?.textContent
}));
console.log('inbox page', JSON.stringify(before));

const api = await page.evaluate(async () => {
  const r = await fetch('/api/messages/inbox/', { credentials: 'include' });
  const j = await r.json();
  return { status: r.status, keys: Object.keys(j), rows: (j.results || j.rows || []).slice(0, 3) };
});
console.log('api inbox', JSON.stringify(api).slice(0, 700));

await page.evaluate(() => document.querySelector('.messenger-side .inbox-row')?.click());
for (const wait of [300, 1000, 2000, 4000]) {
  await sleep(wait === 300 ? 300 : wait - 300);
  const state = await page.evaluate(() => ({
    path: location.pathname,
    rows: document.querySelectorAll('.messenger-side .inbox-row').length,
    names: [...document.querySelectorAll('.messenger-side .inbox-row b')].map(b => b.textContent.trim()),
    active: !!document.querySelector('.messenger-side .inbox-row.active'),
    skeletons: document.querySelectorAll('.people-skeleton.inbox').length,
    empty: !!document.querySelector('.messenger-empty')
  }));
  console.log(`+${wait}ms`, JSON.stringify(state));
}
const cached = await page.evaluate(() => {
  const raw = localStorage.getItem('exposing-demo-v1');
  const db = raw ? JSON.parse(raw) : {};
  return { users: (db.users || []).length, ids: (db.users || []).slice(0, 6).map(u => u.username) };
});
console.log('localStorage db users', JSON.stringify(cached));
await browser.close();
