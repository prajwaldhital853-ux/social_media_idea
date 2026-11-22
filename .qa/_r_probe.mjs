import puppeteer from 'puppeteer-core';
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:3000';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = 'D:/social_medial/.qa';

const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--lang=en-US', '--force-device-scale-factor=1'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.goto(BASE + '/video', { waitUntil: 'domcontentloaded', timeout: 45000 });
await sleep(4000);
const rail = await page.evaluate(() => {
  const item = document.querySelector('.reel-rail');
  if (!item) return null;
  return [...item.children].map(c => ({
    cls: c.className,
    box: (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) }))(c.getBoundingClientRect()),
    text: (c.textContent || '').trim().slice(0, 30),
  }));
});
console.log(JSON.stringify(rail, null, 1));
await page.screenshot({ path: `${OUT}/_r-before.png` });
await browser.close();
