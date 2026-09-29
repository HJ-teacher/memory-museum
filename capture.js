/* 카메라 이미지의 중앙 영역과 미리보기 가이드는 동일한 계산을 사용합니다. */
window.MuseumCapture = (() => {
  function guide(w, h, landscape = false) {
    const margin = 0.03;
    return { x: Math.round(w * margin), y: Math.round(h * margin), w: Math.round(w * (1 - 2 * margin)), h: Math.round(h * (1 - 2 * margin)) };
  }
  function make(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function blob(c) { return new Promise((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(new Error('encode')), 'image/jpeg', .9)); }
  function crop(source, rect) {
    const scale = Math.min(1, 1600 / Math.max(rect.w, rect.h));
    const c = make(rect.w * scale, rect.h * scale);
    c.getContext('2d').drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height); return c;
  }
  async function fromVideo(video, settings) {
    if (!video.videoWidth) throw new Error('not ready');
    const c = make(video.videoWidth, video.videoHeight); c.getContext('2d').drawImage(video, 0, 0);
    let output = null, mode = '화면 자동 크롭';
    if (settings.autoDocument && window.MuseumAdvanced) {
      try { output = MuseumAdvanced.documentCrop(c, settings.qrLocation); if (output) mode = '종이 자동 보정'; } catch { output = null; }
    }
    if (settings.review || !output) {
      const reviewed = await MuseumCrop.review(c);
      if (!reviewed) return null;
      output = reviewed; mode = '종이 크롭 · 원근 보정';
    }
    if (window.MuseumAdvanced) { try { MuseumAdvanced.hideQR(output); } catch {} }
    return { blob: await blob(output), mode };
  }
  async function fromFile(file, { autoCrop = false } = {}) {
    if (!file.type.startsWith('image/') || file.size > 30 * 1024 * 1024) throw new Error('invalid image');
    const url = URL.createObjectURL(file), img = new Image();
    try {
      img.src = url; await img.decode();
      if (img.naturalWidth * img.naturalHeight > 60000000) throw new Error('large image');
      const source = crop(img, { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight });
      const detected = autoCrop ? MuseumAdvanced.documentCrop(source) : null;
      const output = detected || await MuseumCrop.review(source);
      if (output) MuseumAdvanced.hideQR(output);
      return output ? { blob: await blob(output), mode: '사진 종이 보정' } : null;
    } finally { URL.revokeObjectURL(url); }
  }
  return { guide, make, blob, crop, fromVideo, fromFile };
})();

