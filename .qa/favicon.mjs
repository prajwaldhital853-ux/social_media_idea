/**
 * Favicon generator: crops the camera-lens eye out of the brand logo and tiles
 * it square. Tiling the whole wordmark made the 16px tab icon unreadable.
 *
 * The crop is measured, not guessed: the saturated-orange iris gives the center,
 * then a run-length scan outward from it finds the black lens ring, and the
 * square is grown to hold that ring with a small margin.
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const SRC = 'C:/Users/Dell/.qoder/tmp/D--social-medial/images/1f212bdf-36f4-47ba-ab03-471cc075521d/8df23753-ef26-4294-95a8-39b4193e481a.png';
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
  const p = x.getImageData(0, 0, W, H).data;

  const at = (i, y) => { const o = (y * W + i) * 4; return [p[o], p[o + 1], p[o + 2]]; };
  // Saturated orange: red hot and green clearly above blue. Red-on-white blends
  // keep g ~= b, so the wordmark and its anti-aliasing fall out of this test.
  const isOrange = ([r, g, b]) => r > 170 && g > 80 && g - b > 60;
  const isDark = ([r, g, b]) => Math.max(r, g, b) < 90;
  const isLight = ([r, g, b]) => Math.min(r, g, b) >= 200;

  let minX = W, minY = H, maxX = 0, maxY = 0, found = 0;
  for (let y = 0; y < H; y++) {
    for (let i = 0; i < W; i++) {
      if (isOrange(at(i, y))) {
        found++;
        if (i < minX) minX = i;
        if (i > maxX) maxX = i;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) throw new Error('no iris found');
  const cx = Math.round((minX + maxX) / 2);
  const cy = Math.round((minY + maxY) / 2);

  /**
   * Walk out from the iris and remember the last dark pixel before a long
   * white stretch: that pixel is the outer edge of the lens ring. Mid-tones in
   * between (iris, eyeliner, anti-aliasing) neither add to nor break the run.
   */
  const ringEdge = (dx, dy) => {
    let gap = 0, dark = 0, lastDark = null;
    for (let step = 1; step <= 2000; step++) {
      const i = cx + dx * step, y = cy + dy * step;
      if (i < 0 || y < 0 || i >= W || y >= H) return null;
      const c = at(i, y);
      if (isDark(c)) { dark++; gap = 0; lastDark = { x: i, y }; continue; }
      if (isLight(c)) {
        if (++gap > 6) return dark > 25 && lastDark ? lastDark : null;
        continue;
      }
    }
    return null;
  };
  const left = ringEdge(-1, 0), right = ringEdge(1, 0), top = ringEdge(0, -1);
  if (!left || !right) throw new Error('lens ring not found');
  // The lens circle is fitted from the ring edges, not the orange box, because
  // the iris sits high inside the lens.
  const ringCx = (left.x + right.x) / 2;
  const ringR = (right.x - left.x) / 2;
  const ringCy = top ? top.y + ringR : cy;
  // The wordmark is painted over the lower half of the lens, so a full-circle
  // crop always drags letters into the tile. Keep the arc above the eye and
  // stop just under it.
  const x0 = Math.round(ringCx - ringR * 0.72);
  const x1 = Math.round(ringCx + ringR * 0.72);
  const y0 = Math.round(ringCy - ringR * 0.88);
  const y1 = Math.min(Math.round(ringCy + ringR * 0.9), maxY + 8);
  const cx0 = Math.max(0, Math.min(W - 1, x0));
  const cw = Math.max(1, Math.min(W - cx0, x1 - x0 + 1));
  const cy0 = Math.max(0, Math.min(H - 1, y0));
  const ch = Math.max(1, Math.min(H - cy0, y1 - y0 + 1));

  const crop = x.getImageData(cx0, cy0, cw, ch);
  const cp = crop.data;
  // Drop the outer white so the mark sits on the tile's own rounded square.
  const bg = o => Math.min(cp[o], cp[o + 1], cp[o + 2]) >= 240;
  const mask = new Uint8Array(cw * ch);
  const stack = [];
  for (let i = 0; i < cw; i++) {
    if (bg(i * 4)) { mask[i] = 1; stack.push(i); }
    const b = (ch - 1) * cw + i;
    if (bg(b * 4)) { mask[b] = 1; stack.push(b); }
  }
  for (let y = 0; y < ch; y++) {
    const l = y * cw, r = y * cw + cw - 1;
    if (bg(l * 4)) { mask[l] = 1; stack.push(l); }
    if (bg(r * 4)) { mask[r] = 1; stack.push(r); }
  }
  while (stack.length) {
    const i = stack.pop();
    const ix = i % cw, iy = (i / cw) | 0;
    if (ix > 0 && !mask[i - 1] && bg((i - 1) * 4)) { mask[i - 1] = 1; stack.push(i - 1); }
    if (ix < cw - 1 && !mask[i + 1] && bg((i + 1) * 4)) { mask[i + 1] = 1; stack.push(i + 1); }
    if (iy > 0 && !mask[i - cw] && bg((i - cw) * 4)) { mask[i - cw] = 1; stack.push(i - cw); }
    if (iy < ch - 1 && !mask[i + cw] && bg((i + cw) * 4)) { mask[i + cw] = 1; stack.push(i + cw); }
  }
  for (let i = 0; i < cw * ch; i++) if (mask[i]) cp[i * 4 + 3] = 0;
  const tmp = document.createElement('canvas');
  tmp.width = cw; tmp.height = ch;
  tmp.getContext('2d').putImageData(crop, 0, 0);

  const tile = (size, fit, corner, background) => {
    const tc = document.createElement('canvas');
    tc.width = size; tc.height = size;
    const tx = tc.getContext('2d');
    tx.fillStyle = background;
    tx.beginPath();
    tx.roundRect(0, 0, size, size, corner);
    tx.fill();
    const s = Math.min(fit / cw, fit / ch);
    tx.imageSmoothingQuality = 'high';
    tx.drawImage(tmp, (size - cw * s) / 2, (size - ch * s) / 2, cw * s, ch * s);
    return tc.toDataURL('image/png');
  };

  // Contact sheet: each tile at its real pixel size, on the dark tab bar color.
  const sheet = document.createElement('canvas');
  sheet.width = 1200; sheet.height = 620;
  const sx = sheet.getContext('2d');
  sx.fillStyle = '#101114';
  sx.fillRect(0, 0, sheet.width, sheet.height);
  const draw = (dataUrl, dx, dy, dw) => {
    return new Promise(res => {
      const t = new Image();
      t.onload = () => { sx.drawImage(t, dx, dy, dw, dw); res(); };
      t.src = dataUrl;
    });
  };

  const icon512 = tile(512, 470, 108, '#ffffff');
  const icon48 = tile(48, 44, 10, '#ffffff');
  const icon32 = tile(32, 29, 7, '#ffffff');
  const apple = tile(180, 158, 40, '#ffffff');
  await draw(icon512, 40, 40, 320);
  await draw(apple, 400, 40, 180);
  await draw(icon48, 620, 40, 48);
  await draw(icon32, 700, 56, 32);
  await draw(icon512, 40, 400, 16);
  await draw(icon512, 80, 400, 24);
  await draw(icon512, 130, 400, 32);
  await draw(icon512, 190, 400, 48);
  await draw(icon512, 260, 400, 64);

  return {
    iris: { minX, minY, maxX, maxY, found },
    ring: { cx: Math.round(ringCx), cy: Math.round(ringCy), r: Math.round(ringR) },
    crop: { cx0, cy0, cw, ch },
    icon512,
    icon48,
    icon32,
    apple,
    sheet: sheet.toDataURL('image/png')
  };
}, `data:image/png;base64,${b64}`);

const write = (path, dataUrl) => fs.writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
write('D:/social_medial/public/exposing-icon.png', result.icon512);
write('D:/social_medial/public/apple-icon.png', result.apple);
write('D:/social_medial/app/icon.png', result.icon512);
write('D:/social_medial/app/apple-icon.png', result.apple);
write('D:/social_medial/.qa/favicon-preview.png', result.sheet);
console.log(JSON.stringify({ iris: result.iris, ring: result.ring, crop: result.crop }));
await browser.close();
