import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const SRC = 'C:/Users/Dell/.qoder/tmp/D--social-medial/images/1f212bdf-36f4-47ba-ab03-471cc075521d/8df23753-ef26-4294-95a8-39b4193e481a.png';
const OUT = 'D:/social_medial/public';
const b64 = fs.readFileSync(SRC).toString('base64');

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--force-device-scale-factor=1']
});
const page = await browser.newPage();
const result = await page.evaluate(async dataUrl => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, W, H);
  const p = d.data;
  const isBg = o => Math.min(p[o], p[o + 1], p[o + 2]) >= 240;
  const mask = new Uint8Array(W * H);
  const stack = [];
  for (let i = 0; i < W; i++) {
    if (isBg(i * 4)) { mask[i] = 1; stack.push(i); }
    const b = (H - 1) * W + i;
    if (isBg(b * 4)) { mask[b] = 1; stack.push(b); }
  }
  for (let y = 0; y < H; y++) {
    const l = y * W, r = y * W + W - 1;
    if (isBg(l * 4)) { mask[l] = 1; stack.push(l); }
    if (isBg(r * 4)) { mask[r] = 1; stack.push(r); }
  }
  while (stack.length) {
    const i = stack.pop();
    const ix = i % W, iy = (i / W) | 0;
    if (ix > 0 && !mask[i - 1] && isBg((i - 1) * 4)) { mask[i - 1] = 1; stack.push(i - 1); }
    if (ix < W - 1 && !mask[i + 1] && isBg((i + 1) * 4)) { mask[i + 1] = 1; stack.push(i + 1); }
    if (iy > 0 && !mask[i - W] && isBg((i - W) * 4)) { mask[i - W] = 1; stack.push(i - W); }
    if (iy < H - 1 && !mask[i + W] && isBg((i + W) * 4)) { mask[i + W] = 1; stack.push(i + W); }
  }
  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (let y = 0; y < H; y++) {
    for (let i = 0; i < W; i++) {
      if (!mask[y * W + i]) {
        if (i < minX) minX = i;
        if (i > maxX) maxX = i;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const pad = 8;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(W - 1, maxX + pad); maxY = Math.min(H - 1, maxY + pad);
  const cw = maxX - minX + 1, ch = maxY - minY + 1;

  const make = (dark, targetW) => {
    const oc = document.createElement('canvas');
    const scale = targetW / cw;
    oc.width = targetW; oc.height = Math.round(ch * scale);
    const ox = oc.getContext('2d');
    const src = x.getImageData(minX, minY, cw, ch);
    const sp = src.data;
    for (let yy = 0; yy < ch; yy++) {
      for (let xx = 0; xx < cw; xx++) {
        const o = (yy * cw + xx) * 4;
        if (mask[(yy + minY) * W + (xx + minX)]) { sp[o + 3] = 0; continue; }
        if (dark) {
          const r = sp[o], g = sp[o + 1], b = sp[o + 2];
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          if (mx - mn <= 20 && mx < 120) {
            const v = 255 - mx;
            sp[o] = v; sp[o + 1] = v; sp[o + 2] = v;
          }
        }
      }
    }
    const tmp = document.createElement('canvas');
    tmp.width = cw; tmp.height = ch;
    tmp.getContext('2d').putImageData(src, 0, 0);
    ox.imageSmoothingQuality = 'high';
    ox.drawImage(tmp, 0, 0, oc.width, oc.height);
    return oc;
  };

  const light = make(false, 1200);
  const dark = make(true, 1200);

  const tile = (size, logo, fit, radius) => {
    const tc = document.createElement('canvas');
    tc.width = size; tc.height = size;
    const tx = tc.getContext('2d');
    tx.fillStyle = '#ffffff';
    tx.beginPath();
    tx.roundRect(0, 0, size, size, radius);
    tx.fill();
    const s = Math.min(fit / logo.width, fit / logo.height);
    const w = logo.width * s, h = logo.height * s;
    tx.imageSmoothingQuality = 'high';
    tx.drawImage(logo, (size - w) / 2, (size - h) / 2, w, h);
    return tc;
  };

  const preview = document.createElement('canvas');
  preview.width = 1200; preview.height = dark.height + 80;
  const px = preview.getContext('2d');
  px.fillStyle = '#101114';
  px.fillRect(0, 0, preview.width, preview.height);
  px.drawImage(dark, 0, 40);
  return {
    aspect: cw / ch,
    light: light.toDataURL('image/png'),
    dark: dark.toDataURL('image/png'),
    icon: tile(512, light, 452, 112).toDataURL('image/png'),
    apple: tile(180, light, 158, 40).toDataURL('image/png'),
    preview: preview.toDataURL('image/png')
  };
}, `data:image/png;base64,${b64}`);

for (const [name, key] of [['exposing-logo.png', 'light'], ['exposing-logo-dark.png', 'dark'], ['exposing-icon.png', 'icon'], ['apple-icon.png', 'apple']]) {
  fs.writeFileSync(`${OUT}/${name}`, Buffer.from(result[key].split(',')[1], 'base64'));
}
fs.writeFileSync('D:/social_medial/.qa/preview-dark.png', Buffer.from(result.preview.split(',')[1], 'base64'));
console.log('content aspect', result.aspect.toFixed(3));
console.log(fs.readdirSync(OUT).map(f => `${f} ${fs.statSync(`${OUT}/${f}`).size}`).join('\n'));
await browser.close();