// QR 계산은 별도 스레드에서 처리하여 촬영 화면과 버튼을 멈추지 않습니다.
importScripts('jsQR.js');
let previousRegion = null;
function regionDecode(data, width, height, region) {
  const x = Math.max(0, Math.floor(region.x)), y = Math.max(0, Math.floor(region.y));
  const w = Math.min(width - x, Math.ceil(region.w)), h = Math.min(height - y, Math.ceil(region.h));
  const scale = Math.min(4, Math.max(1, region.scale || 1)), ow = Math.round(w * scale), oh = Math.round(h * scale);
  if (w < 7 || h < 7) return null;
  const pixels = new Uint8ClampedArray(ow * oh * 4);
  for (let row = 0; row < oh; row++) for (let col = 0; col < ow; col++) {
    const src = ((y + Math.floor(row / scale)) * width + x + Math.floor(col / scale)) * 4, dst = (row * ow + col) * 4;
    pixels[dst] = data[src]; pixels[dst + 1] = data[src + 1]; pixels[dst + 2] = data[src + 2]; pixels[dst + 3] = 255;
  }
  const qr = jsQR(pixels, ow, oh, { inversionAttempts: 'attemptBoth' });
  if (!qr) return null;
  for (const point of Object.values(qr.location)) { point.x = point.x / scale + x; point.y = point.y / scale + y; }
  return qr;
}
function finderRegions(data, width, height) {
  const gray = new Uint8Array(width * height), histogram = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < gray.length; i++) { const p = i * 4; const v = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8; gray[i] = v; histogram[v]++; total += v; }
  let count = 0, sum = 0, best = 0, threshold = 128;
  for (let t = 0; t < 255; t++) {
    count += histogram[t]; sum += t * histogram[t]; if (!count || count === gray.length) continue;
    const low = sum / count, high = (total - sum) / (gray.length - count), score = count * (gray.length - count) * (high - low) ** 2;
    if (score > best) { best = score; threshold = Math.round((low + high) / 2); }
  }
  const centers = [];
  const matches = r => { const unit = r.reduce((a, b) => a + b, 0) / 7; return unit >= .8 && r.every((v, i) => Math.abs(v - unit * (i === 2 ? 3 : 1)) <= unit * (i === 2 ? 1.3 : .7)); };
  for (const cutoff of [threshold, Math.max(24, threshold - 45), Math.min(232, threshold + 45)]) {
    for (let row = 0; row < height; row += 2) {
      let color = gray[row * width] < cutoff, start = 0, runs = [];
      for (let col = 1; col <= width; col++) {
        const next = col < width && gray[row * width + col] < cutoff;
        if (col < width && next === color) continue;
        runs.push(col - start); if (runs.length > 5) runs.shift();
        // Finder patterns have the same 1:1:3:1:1 run lengths in either polarity.
        if (runs.length === 5 && matches(runs)) {
          const unit = runs.reduce((a, b) => a + b, 0) / 7;
          const cx = Math.round(col - runs[4] - runs[3] - runs[2] / 2);
          if (cx >= 0 && cx < width) {
            const dark = gray[row * width + cx] < cutoff, vertical = [0, 0, 1, 0, 0];
            let yy = row - 1;
            for (let part = 2; part >= 0; part--) { const expected = part % 2 === 0 ? dark : !dark; while (yy >= 0 && (gray[yy * width + cx] < cutoff) === expected && vertical[part] < unit * 9) { vertical[part]++; yy--; } }
            const top = yy + 1; yy = row + 1;
            for (let part = 2; part <= 4; part++) { const expected = part % 2 === 0 ? dark : !dark; while (yy < height && (gray[yy * width + cx] < cutoff) === expected && vertical[part] < unit * 9) { vertical[part]++; yy++; } }
            if (matches(vertical)) {
              const cy = top + vertical[0] + vertical[1] + vertical[2] / 2;
              const found = centers.find(p => Math.abs(p.x - cx) < unit * 3 && Math.abs(p.y - cy) < unit * 3);
              if (found) found.hits++; else if (centers.length < 80) centers.push({ x: cx, y: cy, unit, hits: 1 });
            }
          }
        }
        start = col; color = next;
      }
    }
    if (centers.length >= 3) break;
  }
  return centers.sort((a, b) => b.hits - a.hits).slice(0, 24).map(p => {
    const radius = Math.max(40, p.unit * 36);
    const x = Math.max(0, p.x - radius), y = Math.max(0, p.y - radius);
    return { x, y, w: Math.min(width - x, radius * 2), h: Math.min(height - y, radius * 2), scale: p.unit < 2.5 ? 3 : 1 };
  });
}
function decode(data, width, height, fast) {
  if (!fast) return jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
  if (previousRegion && previousRegion.width === width && previousRegion.height === height) {
    const qr = regionDecode(data, width, height, previousRegion); if (qr) return qr;
  }
  for (const region of finderRegions(data, width, height)) {
    const qr = regionDecode(data, width, height, region);
    if (qr) { previousRegion = { ...region, width, height }; return qr; }
  }
  previousRegion = null;
  // Full-image fallback also handles damaged finder patterns and unusual exposure.
  const scale = Math.min(1, 1280 / Math.max(width, height));
  const w = Math.round(width * scale), h = Math.round(height * scale), pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const src = (Math.floor(y / scale) * width + Math.floor(x / scale)) * 4, dst = (y * w + x) * 4;
    pixels.set(data.subarray(src, src + 4), dst);
  }
  const qr = jsQR(pixels, w, h, { inversionAttempts: 'attemptBoth' });
  if (qr) for (const point of Object.values(qr.location)) { point.x /= scale; point.y /= scale; }
  return qr;
}
self.onmessage = event => {
  const { id, data, width, height, fast } = event.data;
  const started = performance.now();
  try { self.postMessage({ id, qr: decode(data, width, height, fast), ms: performance.now() - started }); }
  catch { self.postMessage({ id, qr: null }); }
};
