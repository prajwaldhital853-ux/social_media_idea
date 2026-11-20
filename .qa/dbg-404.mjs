import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
page.on('response', r => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()); });
page.on('requestfailed', r => console.log('FAILED', r.url(), r.failure()?.errorText));
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const path of ['/', '/explore', '/video', '/post/p_mix', '/post/p_mix/media/1', '/marketplace', '/login', '/no-such-route']) {
  await page.goto('http://localhost:3000' + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(1800);
}
await browser.close();
console.log('scan done');
