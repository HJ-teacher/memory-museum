/* 밝은 종이를 찾는 경량 Canvas 보조 기능입니다. AI나 외부 서버는 사용하지 않습니다.
   어두운 바탕의 흰 종이에 적합하며, 확신이 없으면 null을 반환합니다. */
window.MuseumAdvanced = (() => {
  function detectPaper(source, qrLocation = null) {
    const w = 320, h = Math.round(source.height / source.width * w), c = document.createElement('canvas');
    c.width = w; c.height = h; const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(source, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data, seen = new Uint8Array(w * h), queue = new Int32Array(w * h);
    const lums = new Uint8Array(w * h);
    let lumSum = 0;
    for (let i = 0; i < w * h; i++) {
      const p = i * 4;
      const lum = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
      lums[i] = lum;
      lumSum += lum;
    }
    const avgLum = lumSum / (w * h);
    const thresh = Math.max(100, Math.min(180, avgLum * 1.15));
    const bright = i => lums[i] >= thresh;
    let best = null;
    for (let start = 0; start < w * h; start++) {
      if (seen[start] || !bright(start)) continue;
      let read = 0, end = 1, minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity, tl, tr, br, bl;
      seen[start] = 1; queue[0] = start;
      while (read < end) {
        const i = queue[read++], x = i % w, y = Math.floor(i / w), sum = x + y, diff = x - y;
        if (sum < minSum) { minSum = sum; tl = [x, y]; } if (sum > maxSum) { maxSum = sum; br = [x, y]; }
        if (diff < minDiff) { minDiff = diff; bl = [x, y]; } if (diff > maxDiff) { maxDiff = diff; tr = [x, y]; }
        const neighbors = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
        for (const n of neighbors) if (n >= 0 && !seen[n] && bright(n)) { seen[n] = 1; queue[end++] = n; }
      }
      if (!best || end > best.size) best = { size: end, points: [tl, tr, br, bl] };
    }
    if (!best || best.size < w * h * .05) return null;
    const p = best.points;
    if (p.some(([x, y]) => x < 1 || y < 1 || x > w - 2 || y > h - 2)) return null;
    const area = Math.abs(p.reduce((sum, v, i) => sum + v[0] * p[(i + 1) % 4][1] - v[1] * p[(i + 1) % 4][0], 0)) / 2;
    if (area < w * h * .10 || area > w * h * .98 || best.size / area < .14 || best.size / area > 1.2) return null;
    const lengths = p.map((v, i) => Math.hypot(v[0] - p[(i + 1) % 4][0], v[1] - p[(i + 1) % 4][1]));
    if (Math.min(...lengths) < 25 || Math.min(lengths[0], lengths[2]) / Math.max(lengths[0], lengths[2]) < .55 || Math.min(lengths[1], lengths[3]) / Math.max(lengths[1], lengths[3]) < .55) return null;
    const width = (lengths[0] + lengths[2]) / 2, height = (lengths[1] + lengths[3]) / 2;
    if (width / height < .35 || width / height > 2.8) return null;
    // 네 꼭짓점 사이의 변이 바깥으로 볼록한지 검증합니다.
    for (let i = 0; i < 4; i++) { const a = p[i], b = p[(i + 1) % 4], d = p[(i + 2) % 4]; if ((b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0]) <= 0) return null; }
    const ratio = source.width / w;
    return p.map(([x, y]) => [x * ratio, y * ratio]);
  }
  function documentCrop(source, qrLocation = null) {
    const p = detectPaper(source, qrLocation); if (!p) return null;
    const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
    return warp(source,p,(distance(p[0],p[1])+distance(p[2],p[3]))/2,(distance(p[0],p[3])+distance(p[1],p[2]))/2);
  }
  // 단위 사각형 → 종이 사각형의 투영 변환을 역매핑하여 원근을 보정합니다.
  function warp(source, p, width, height) {
    const scale = Math.min(1, 1600 / Math.max(width, height)), out = document.createElement('canvas');
    out.width = Math.round(width * scale); out.height = Math.round(height * scale);
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p;
    const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    const det = dx1 * dy2 - dx2 * dy1; if (Math.abs(det) < 1e-8) return null;
    const g = (dx3 * dy2 - dx2 * dy3) / det, h = (dx1 * dy3 - dx3 * dy1) / det;
    const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
    const input = source.getContext('2d').getImageData(0, 0, source.width, source.height).data, ctx = out.getContext('2d'), image = ctx.createImageData(out.width, out.height);
    for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
      const u = x / Math.max(1, out.width - 1), v = y / Math.max(1, out.height - 1), z = g * u + h * v + 1;
      const sx = Math.max(0, Math.min(source.width - 1.001, (a * u + b * v + x0) / z)), sy = Math.max(0, Math.min(source.height - 1.001, (d * u + e * v + y0) / z));
      const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy, pos = (y * out.width + x) * 4;
      for (let channel = 0; channel < 3; channel++) { const i = (iy * source.width + ix) * 4 + channel; image.data[pos + channel] = input[i] * (1 - fx) * (1 - fy) + input[i + 4] * fx * (1 - fy) + input[i + source.width * 4] * (1 - fx) * fy + input[i + source.width * 4 + 4] * fx * fy; }
      image.data[pos + 3] = 255;
    }
    ctx.putImageData(image, 0, 0); return out;
  }
  function hideQR(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true }), image = ctx.getImageData(0, 0, canvas.width, canvas.height), qr = window.jsQR?.(image.data, image.width, image.height);
    if (!qr || !/^(CLASS-EXHIBIT|EXHIBIT-\d{2})$/.test(qr.data)) return;
    const pts = ['topLeftCorner', 'topRightCorner', 'bottomRightCorner', 'bottomLeftCorner'].map(k => qr.location[k]);
    // 검출점의 반 픽셀 오차와 축소 시 경계의 번짐을 포함하는 2px 여백입니다.
    const x = Math.floor(Math.min(...pts.map(p => p.x))) - 2, y = Math.floor(Math.min(...pts.map(p => p.y))) - 2, right = Math.ceil(Math.max(...pts.map(p => p.x))) + 2, bottom = Math.ceil(Math.max(...pts.map(p => p.y))) + 2;
    const size = (right - x) * (bottom - y), edge = Math.min(x, y, canvas.width - right, canvas.height - bottom);
    if (size > canvas.width * canvas.height * .04 || edge > Math.min(canvas.width, canvas.height) * .12) return;
    // 주변이 흰 여백인 작은 QR만 처리하고, 작품에 가까우면 원본을 유지합니다.
    const pad = 3; if (x < pad || y < pad || right + pad >= canvas.width || bottom + pad >= canvas.height) return;
    let total = 0, white = 0;
    for (let yy = y - pad; yy <= bottom + pad; yy++) for (let xx = x - pad; xx <= right + pad; xx++) if (xx < x || xx > right || yy < y || yy > bottom) { total++; const i = (yy * canvas.width + xx) * 4; if (Math.min(image.data[i], image.data[i + 1], image.data[i + 2]) > 225) white++; }
    if (white / total < .97) return;
    ctx.fillStyle = '#fff'; ctx.fillRect(x - 1, y - 1, right - x + 2, bottom - y + 2);
  }
  function settingsUI(s) {
    document.getElementById('advancedSettings').innerHTML = '<label class="inline-label"><input id="settingDocument" type="checkbox">밝은 종이 자동 보정 (보조 기능)</label><p class="small">카메라 화면 전체에서 종이를 찾아 반듯하게 잘라요. 경계가 불확실할 때만 네 모서리를 확인합니다.</p><label class="inline-label"><input id="settingHideQR" type="checkbox">가장자리의 작은 QR을 흰색으로 가리기</label><p class="small">흰 여백에 있는 QR만 가려요. 작품을 보존하려면 꺼 두세요.</p>';
    document.getElementById('settingDocument').checked = !!s.autoDocument; document.getElementById('settingHideQR').checked = !!s.hideQR;
  }
  function settingsValues() { return { autoDocument: document.getElementById('settingDocument').checked, hideQR: document.getElementById('settingHideQR').checked }; }
  return { documentCrop, detectPaper, warp, hideQR, settingsUI, settingsValues };
})();
