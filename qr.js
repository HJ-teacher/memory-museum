/* QR에는 개인 정보를 넣지 않습니다. 다른 QR 링크는 실행하지 않습니다. */
window.MuseumQR = (() => {
  function slotFor(text, count, works) {
    if (text === 'CLASS-EXHIBIT') return works.findIndex((w, i) => i < count && !w);
    const match = /^EXHIBIT-(\d{2})$/.exec(text || '');
    if (!match) return -2;
    const i = Number(match[1]) - 1;
    return i >= 0 && i < count ? (works[i] ? -3 : i) : -4;
  }
  function canvas(text, scale = 8) {
    if (!window.qrcode) throw new Error('QR unavailable');
    const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
    const n = qr.getModuleCount(), c = document.createElement('canvas');
    c.width = c.height = (n + 8) * scale;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.fillStyle = '#000';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) ctx.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale);
    return c;
  }
  // 다음 작품은 QR이 1.2초 이상 사라지고 촬영 후 1.5초가 지나면 준비합니다.
  class Gate {
    constructor() { this.locked = false; this.absentSince = null; this.until = 0; }
    lock(now) { this.locked = true; this.until = now + 1500; this.absentSince = null; }
    observe(present, now) {
      if (present) this.absentSince = null;
      else if (this.absentSince === null) this.absentSince = now;
      if (this.locked && this.absentSince !== null && now - this.absentSince >= 1200 && now >= this.until) this.locked = false;
      return !this.locked;
    }
  }
  return { slotFor, canvas, Gate };
})();

