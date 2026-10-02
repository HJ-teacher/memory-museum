// QR 계산은 별도 스레드에서 처리하여 촬영 화면과 버튼을 멈추지 않습니다.
importScripts('jsQR.js');
self.onmessage = event => {
  const { id, data, width, height } = event.data;
  try { self.postMessage({ id, qr: jsQR(data, width, height, { inversionAttempts: 'attemptBoth' }) }); }
  catch { self.postMessage({ id, qr: null }); }
};
