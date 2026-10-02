/* 카메라 이미지의 중앙 영역과 미리보기 가이드는 동일한 계산을 사용합니다. */
window.MuseumCapture = (() => {
  let qrWorker = null, workerFailed = false;
  let qrRequestId = 0;
  const qrRequests = new Map();
  let fastRegion = null;
  function decodeAsync(canvas, fast = false) {
    const pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
    if (workerFailed || !window.Worker) return Promise.resolve(jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' }));
    return new Promise(resolve => {
      try {
        if (!qrWorker) {
          qrWorker = new Worker('qr-worker.js?v=20261002-fast-hq');
          qrWorker.onmessage = event => { const pending = qrRequests.get(event.data.id); qrRequests.delete(event.data.id); pending?.(event.data.qr); };
          qrWorker.onerror = () => { qrWorker.terminate(); qrWorker = null; workerFailed = true; for (const pending of qrRequests.values()) pending(null); qrRequests.clear(); };
        }
        const id = ++qrRequestId; qrRequests.set(id, resolve);
        qrWorker.postMessage({ id, data: pixels.data, width: pixels.width, height: pixels.height, fast }, [pixels.data.buffer]);
      } catch { workerFailed = true; resolve(null); }
    });
  }
  async function readQRAsync(video, canvas, orientation, region = null) {
    if (region) drawQRRegion(video, canvas, region);
    else drawFrame(video, canvas, orientation, 1280);
    return decodeAsync(canvas);
  }
  async function readFastQR(video, canvas, orientation) {
    const width = video.videoWidth, height = video.videoHeight;
    if (fastRegion && fastRegion.width === width && fastRegion.height === height) {
      const region = fastRegion;
      drawQRRegion(video, canvas, { ...region, scale: 1 });
      const qr = await decodeAsync(canvas, true);
      if (qr) {
        for (const point of Object.values(qr.location)) { point.x += region.x; point.y += region.y; }
        rememberRegion(qr, width, height); return qr;
      }
    }
    fastRegion = null;
    if (workerFailed || !window.Worker) return readQR(video, canvas, orientation, 1280);
    // QR 방향은 디코더가 처리합니다. 전체 영상의 회전·복사를 줄입니다.
    canvas.width = width; canvas.height = height; canvas.getContext('2d').drawImage(video, 0, 0);
    const qr = await decodeAsync(canvas, true);
    if (qr) rememberRegion(qr, width, height);
    return qr;
  }
  function rememberRegion(qr, width, height) {
    const points = ['topLeftCorner', 'topRightCorner', 'bottomRightCorner', 'bottomLeftCorner'].map(k => qr.location[k]);
    const left = Math.min(...points.map(p => p.x)), right = Math.max(...points.map(p => p.x));
    const top = Math.min(...points.map(p => p.y)), bottom = Math.max(...points.map(p => p.y));
    const margin = Math.max(48, right - left, bottom - top);
    const x = Math.max(0, Math.floor(left - margin)), y = Math.max(0, Math.floor(top - margin));
    fastRegion = { x, y, w: Math.min(width - x, Math.ceil(right - left + margin * 2)), h: Math.min(height - y, Math.ceil(bottom - top + margin * 2)), width, height };
  }
  function readCanvasQR(canvas) { return decodeAsync(canvas, true); }
  function guide(w, h, landscape = false) {
    const margin = 0.03;
    return { x: Math.round(w * margin), y: Math.round(h * margin), w: Math.round(w * (1 - 2 * margin)), h: Math.round(h * (1 - 2 * margin)) };
  }
  function make(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function blob(c) { return new Promise((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(new Error('encode')), 'image/jpeg', .97)); }
  function crop(source, rect) {
    const scale = Math.min(1, 4096 / Math.max(rect.w, rect.h));
    const c = make(rect.w * scale, rect.h * scale);
    c.getContext('2d').drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height); return c;
  }
  function frameSize(video, orientation = 'landscape') {
    const w = video.videoWidth, h = video.videoHeight;
    const rotate = orientation === 'portrait' ? w > h : h > w;
    return { width: rotate ? h : w, height: rotate ? w : h, rotate };
  }
  // QR 인식과 저장은 미리보기와 동일한 회전을 사용합니다.
  function drawFrame(video, canvas, orientation = 'landscape', maxSize = Infinity) {
    const size = frameSize(video, orientation);
    const scale = Math.min(1, maxSize / Math.max(size.width, size.height));
    canvas.width = Math.max(1, Math.round(size.width * scale));
    canvas.height = Math.max(1, Math.round(size.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.save();
    // 작은 QR 모듈의 대비를 축소 과정에서 흐리지 않습니다.
    ctx.imageSmoothingEnabled = false;
    if (size.rotate) {
      ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2);
      ctx.drawImage(video, 0, 0, canvas.height, canvas.width);
    } else ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    return canvas;
  }
  function readQR(video, canvas, orientation, maxSize = 1280) {
    drawFrame(video, canvas, orientation, maxSize);
    const pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
  }
  // 전체 화면을 줄이면 사라지는 작은 QR은 겹치는 원본 영역을 확대해서 읽습니다.
  function qrRegions(video) {
    const w = video.videoWidth, h = video.videoHeight, side = 768;
    const columns = Math.max(1, Math.ceil((w - side) / (side - 160)) + 1);
    const rows = Math.max(1, Math.ceil((h - side) / (side - 160)) + 1);
    const regions = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      regions.push({ x: columns === 1 ? 0 : Math.round(x * (w - side) / (columns - 1)),
        y: rows === 1 ? 0 : Math.round(y * (h - side) / (rows - 1)), w: Math.min(side, w), h: Math.min(side, h) });
    }
    // 활동지 가장자리의 QR을 먼저 찾고 나머지 영역을 빠짐없이 순회합니다.
    const priority = [0, columns - 1, (rows - 1) * columns, regions.length - 1, Math.floor(rows / 2) * columns + Math.floor(columns / 2)];
    return [...new Set([...priority, ...regions.map((_, i) => i)])].map(i => regions[i]);
  }
  function drawQRRegion(video, canvas, region) {
    canvas.width = region.w * (region.scale || 2); canvas.height = region.h * (region.scale || 2);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(video, region.x, region.y, region.w, region.h, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  function readQRRegion(video, canvas, region) {
    drawQRRegion(video, canvas, region);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
  }
  async function fromVideo(video, settings) {
    if (!video.videoWidth) throw new Error('not ready');
    const c = drawFrame(video, make(1, 1), settings.cameraOrientation);
    let output = null, mode = '화면 자동 크롭';
    if (settings.autoDocument && window.MuseumAdvanced) {
      try { output = await MuseumAdvanced.documentCropAsync(c, settings.qrLocation); if (output) mode = '종이 자동 보정'; } catch { output = null; }
    }
    if (settings.review || !output) {
      const reviewed = await MuseumCrop.review(c);
      if (!reviewed) return null;
      output = reviewed; mode = '종이 크롭 · 원근 보정';
    }
    if (window.MuseumAdvanced) { try { await MuseumAdvanced.hideQRAsync(output); } catch {} }
    return { blob: await blob(output), mode };
  }
  async function fromFile(file, { autoCrop = false } = {}) {
    if (!file.type.startsWith('image/') || file.size > 30 * 1024 * 1024) throw new Error('invalid image');
    const url = URL.createObjectURL(file), img = new Image();
    try {
      img.src = url; await img.decode();
      if (img.naturalWidth * img.naturalHeight > 60000000) throw new Error('large image');
      const source = crop(img, { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight });
      const detected = autoCrop ? await MuseumAdvanced.documentCropAsync(source) : null;
      const output = detected || await MuseumCrop.review(source);
      if (output) await MuseumAdvanced.hideQRAsync(output);
      return output ? { blob: await blob(output), mode: '사진 종이 보정' } : null;
    } finally { URL.revokeObjectURL(url); }
  }
  return { guide, make, blob, crop, frameSize, drawFrame, readQR, readQRAsync, readFastQR, readCanvasQR, qrRegions, readQRRegion, fromVideo, fromFile };
})();


