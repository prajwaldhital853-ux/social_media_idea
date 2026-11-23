import puppeteer from 'puppeteer-core';
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:3000';
const PASS = 'exposing-demo-1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--lang=en-US'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('response', async r => {
  if (/\/api\/sync\//.test(r.url()) && r.status() === 200) {
    const b = await r.json().catch(() => null);
    if (b) console.log('SYNC follows:', (b.follows || []).map(f => `${f.follower}->${f.following}:${f.status}`).join(' '));
  }
});
const goto = async path => { await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 45000 }); await sleep(900); };
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

await signIn('sita@demo.test');
await goto('/');
await sleep(2000);
const snap = () => page.evaluate(() => [...document.querySelectorAll('article.post')].slice(0, 12).map(a => ({
  href: (a.querySelector('.post-name')?.getAttribute('href') || '').replace('/u/', ''),
  follow: a.querySelector('.feed-follow')?.textContent?.trim() || null,
})));
console.log('t+2s ', JSON.stringify(await snap()));
await sleep(3000);
console.log('t+5s ', JSON.stringify(await snap()));
await browser.close();
