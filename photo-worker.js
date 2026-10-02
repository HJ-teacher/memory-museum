// 고해상도 원근 보정은 별도 스레드에서 실행합니다.
  function warp(source, p, width, height) {
    const scale = Math.min(1, 4096 / Math.max(width, height)), out = new OffscreenCanvas(1, 1);
    out.width = Math.round(width * scale); out.height = Math.round(height * scale);
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p;
    const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    const det = dx1 * dy2 - dx2 * dy1; if (Math.abs(det) < 1e-8) return null;
    // 기울기만 있는 사각형은 Canvas의 원본 해상도 변환으로 빠르게 처리합니다.
    if (Math.abs(dx3) < .001 && Math.abs(dy3) < .001) {
      const ctx = out.getContext('2d'), ax = (x1 - x0) / Math.max(1, out.width - 1), bx = (x3 - x0) / Math.max(1, out.height - 1);
      const ay = (y1 - y0) / Math.max(1, out.width - 1), by = (y3 - y0) / Math.max(1, out.height - 1), determinant = ax * by - bx * ay;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.setTransform(by / determinant, -ay / determinant, -bx / determinant, ax / determinant,
        (bx * y0 - by * x0) / determinant, (ay * x0 - ax * y0) / determinant);
      ctx.drawImage(source, 0, 0); return out;
    }
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
self.onmessage = event => {
  const { data, sourceWidth, sourceHeight, points, width, height } = event.data;
  const source = new OffscreenCanvas(sourceWidth, sourceHeight);
  source.getContext('2d').putImageData(new ImageData(data, sourceWidth, sourceHeight), 0, 0);
  try {
    const canvas = warp(source, points, width, height);
    if (!canvas) { self.postMessage(null); return; }
    const result = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    self.postMessage({ data: result.data, width: canvas.width, height: canvas.height }, [result.data.buffer]);
  } catch { self.postMessage(null); }
};