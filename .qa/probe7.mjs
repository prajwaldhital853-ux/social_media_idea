import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=en-US'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const routes = ['/', '/signup', '/login', '/notifications', '/messages', '/messages/u2', '/marketplace', '/wallet', '/saved', '/settings', '/u/sita_k', '/legal/privacy', '/admin', '/this-route-does-not-exist'];
for (const r of routes) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0, 90)));
  await page.goto('http://localhost:3000' + r, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(1500);
  console.log(r, '→', errs.length ? errs.join(' | ') : 'clean');
  await page.close();
}

// signup reproduction with error capture
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message.slice(0, 120)));
await page.goto('http://localhost:3000/signup', { waitUntil: 'domcontentloaded', timeout: 45000 });
await sleep(1200);
const fill = async (username, email) => {
  const inputs = await page.$$('.signup-form input.login-input');
  const values = ['QA Tester', username, email, 'password123', '', 'Bagmati', 'Kathmandu'];
  for (let i = 0; i < inputs.length; i++) {
    await inputs[i].click({ clickCount: 3 });
    if (values[i]) await inputs[i].type(values[i]);
  }
  await page.evaluate(() => {
    const el = document.querySelector('.signup-form input[type="date"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '1995-05-05');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => document.querySelectorAll('.signup-check input').forEach(c => { if (!c.checked) c.click(); }));
};
await fill('sita_k', 'qa.tester@demo.test');
await page.evaluate(() => document.querySelector('.signup-form button[type="submit"]').click());
await sleep(400);
console.log('dup error:', await page.evaluate(() => document.querySelector('.signup-error')?.textContent));
await fill('qa_tester', 'qa.tester@demo.test');
const vals = await page.evaluate(() => [...document.querySelectorAll('.signup-form input.login-input')].map(i => ({ type: i.type, v: i.value })));
console.log('field values:', JSON.stringify(vals));
console.log('checks:', await page.evaluate(() => [...document.querySelectorAll('.signup-check input')].map(c => c.checked)));
await page.evaluate(() => document.querySelector('.signup-form button[type="submit"]').click());
await sleep(1200);
console.log('after submit path:', await page.evaluate(() => location.pathname));
console.log('error now:', await page.evaluate(() => document.querySelector('.signup-error')?.textContent));
console.log('users has qa_tester:', await page.evaluate(() => JSON.parse(localStorage.getItem('exposing-demo-v1') || '{}').users?.some(u => u.username === 'qa_tester')));
console.log('signup pageerrors:', errs.join(' | ') || 'none');
await browser.close();