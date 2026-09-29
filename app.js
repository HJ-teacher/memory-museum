/* 모든 데이터는 이 브라우저의 IndexedDB 안에서만 처리합니다. */
'use strict';
const $ = id => document.getElementById(id);
const THEMES = { museum: '클래식 박물관', art: '유럽 궁전 미술관', simple: '현대 미술관', tradition: '조선 궁궐관' };
const THEME_NOTES = { museum: '아이보리 벽·금빛 액자·마루', art: '붉은 벽·바로크 금박 액자·대리석', simple: '어두운 벽·스포트라이트·콘크리트', tradition: '단청·붉은 기둥·족자·일월오봉도' };
const THEME_PREVIEWS = { museum: 'museum-entry.png', art: 'rooms/euro-entry.jpg', simple: 'rooms/modern-entry.jpg', tradition: 'rooms/palace-entry.jpg' };
const DEFAULTS = { title: '우리 반 기억 박물관', count: 24, theme: 'museum', device: '', auto: true, sound: false, askName: true, useDescription: false, landscape: false, fit: false, autoDocument: true, hideQR: true };
let state = null;
function themeChoices(container, group, current) {
  container.replaceChildren();
  for (const [key, name] of Object.entries(THEMES)) {
    const label = document.createElement('label'); label.className = 'theme-choice';
    const input = document.createElement('input'); input.type = 'radio'; input.name = group; input.value = key; input.checked = key === current;
    const swatch = themeThumb('theme-swatch', key);
    const note = document.createElement('small'); note.textContent = THEME_NOTES[key];
    label.append(input, swatch, document.createTextNode(name), note); container.append(label);
  }
}
function themeThumb(className, key) {
  const thumb = document.createElement('span'); thumb.className = `${className} ${THEMES[key] ? key : 'museum'}`; thumb.setAttribute('aria-hidden', 'true');
  const preview = document.createElement('img'); preview.src = THEME_PREVIEWS[key] || THEME_PREVIEWS.museum; preview.alt = ''; preview.loading = 'lazy'; thumb.append(preview);
  return thumb;
}
themeChoices($('themeChoices'), 'setupTheme', 'museum');
$('themeChoices').addEventListener('change', e => { document.body.dataset.theme = e.target.value; });
$('minus').onclick = () => $('countInput').stepDown(); $('plus').onclick = () => $('countInput').stepUp();
let busy = false, stream = null, cameraRequest = 0, scanTimer = null, lastQR = null, lastSeen = 0;
let cancelCapture = 0, toastTimer, slideTimer, slideIndex = 0, slidePaused = false;
let ready = false, storageOK = true, releaseLock, audioContext;
const gate = new MuseumQR.Gate(), imageURLs = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const number = i => String(i + 1).padStart(2, '0');
const occupied = () => state ? state.works.filter(Boolean).length : 0;
const nextSlot = () => state ? state.works.findIndex(w => !w) : -1;
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5500); }
function status(message) { $('captureStatus').textContent = message; }
function failSave() { $('saveStatus').textContent = '저장하지 못했습니다. 기존 작품은 유지됩니다. 기기 저장 공간과 브라우저 설정을 확인해 주세요.'; $('saveStatus').classList.add('save-error'); toast('저장하지 못했어요. 저장 공간을 확보한 뒤 다시 시도해 주세요.'); }
async function commit(candidate) {
  try { await MuseumStore.write(candidate); state = candidate; $('saveStatus').textContent = '저장 완료 · 작품은 이 기기의 브라우저에만 저장됩니다.'; $('saveStatus').classList.remove('save-error'); return true; }
  catch { failSave(); return false; }
}
function imageURL(work) { if (!imageURLs.has(work.id)) imageURLs.set(work.id, URL.createObjectURL(work.blob)); return imageURLs.get(work.id); }
function cleanupURLs() { const ids = new Set((state?.works || []).filter(Boolean).map(w => w.id)); for (const [id, url] of imageURLs) if (!ids.has(id)) { URL.revokeObjectURL(url); imageURLs.delete(id); } }
function updateBusy() { updateShootMenu(); $('manualBtn').disabled = busy || !stream || nextSlot() < 0; $('uploadBtn').disabled = busy || nextSlot() < 0; }
function render() {
  if (!state) return;
  const s = state.settings; document.body.dataset.theme = s.theme;
  $('galleryTitle').textContent = s.title; $('themeLabel').textContent = THEMES[s.theme];
  $('progressText').textContent = `현재 전시 작품 ${occupied()} / ${s.count}`;
  $('progressBar').style.width = (occupied() / s.count * 100) + '%';
  $('galleryHint').textContent = occupied() === s.count ? '우리의 이야기가 모두 모였어요.' : '한 작품씩, 우리 반의 이야기가 쌓여요.';
  $('autoBtn').textContent = '자동 촬영 ' + (s.auto ? 'ON' : 'OFF'); $('autoBtn').setAttribute('aria-pressed', s.auto);
  $('fitToggle').checked = s.fit; $('workspace').classList.toggle('fit', s.fit);
  $('deleteLastBtn').disabled = !occupied(); $('slideshowBtn').disabled = !occupied();
  const gallery = $('gallery'); gallery.replaceChildren();
  state.works.forEach((work, i) => {
    const item = document.createElement('div'); item.className = 'art-slot'; item.dataset.slot = i;
    const frame = document.createElement(work ? 'button' : 'div'); frame.className = 'frame' + (work ? '' : ' empty');
    if (work) { const img = document.createElement('img'); img.src = imageURL(work); img.alt = `전시물 ${number(i)}`; img.onload = () => { frame.style.aspectRatio = `${img.naturalWidth + 80} / ${img.naturalHeight + 80}`; }; frame.style.aspectRatio = `${(work.width || 700) + 80} / ${(work.height || 1000) + 80}`; frame.append(img); frame.setAttribute('aria-label', `전시물 ${number(i)} 크게 보기`); frame.onclick = () => showArtwork(i); }
    else { const mark = document.createElement('span'); mark.className = 'empty-mark'; mark.textContent = number(i); frame.append(mark); frame.setAttribute('aria-label', `빈 전시 칸 ${number(i)}`); }
    const label = document.createElement('span'); label.className = 'art-label'; label.textContent = work?.title || `전시물 ${number(i)}`; if (work?.name) label.textContent += ` · ${work.name}`;
    item.append(frame, label); gallery.append(item);
  });
  MuseumWalk.render(state, imageURL, editArtwork); cleanupURLs(); updateGuide(); updateBusy(); requestAnimationFrame(fitLayout);
}
function fitLayout() {
  $('fitToggle').disabled = innerWidth < 760;
  if (!state?.settings.fit || $('exhibition').hidden || innerWidth < 760) return;
  const box = $('gallery').getBoundingClientRect(), width = box.width;
  const available = Math.max(320, innerHeight - box.top - 30);
  const count = state.settings.count;
  let best = { score: -1, cols: 1, rows: count };
  for (let cols = 1; cols <= Math.min(count, 10); cols++) {
    const rows = Math.ceil(count / cols), cellW = (width - (cols - 1) * 14) / cols, cellH = (available - (rows - 1) * 14) / rows - 24;
    const score = Math.min(cellW, cellH * .8);
    if (score > best.score) best = { score, cols, rows };
  }
  const g = $('gallery'); g.style.setProperty('--cols', best.cols); g.style.setProperty('--rows', best.rows); g.style.setProperty('--fit-height', available + 'px'); g.style.setProperty('--fit-frame-width', Math.min((width - (best.cols - 1) * 14) / best.cols, ((available - (best.rows - 1) * 14) / best.rows - 24) * .8) + 'px');
}
function enterExhibition() { ready = true; document.body.classList.add('inside-museum'); $('welcome').hidden = true; $('exhibition').hidden = false; $('settingsBtn').hidden = false; showCapture(false); render(); MuseumWalk.setActive(true); }
function showCapture(show) { document.body.classList.toggle('camera-open', show); closeShootMenu(); if (show) MuseumWalk.stop(); $('cameraPanel').hidden = !show; $('workspace').classList.toggle('gallery-only', !show); requestAnimationFrame(fitLayout); }
// 이미 열린 창의 내용만 교체합니다. close() 직후 다시 열면 지연된 close 이벤트가
// 새 삭제 확인을 취소한 것으로 처리되는 문제가 있어 닫았다 열지 않습니다.
function openModal(title, content) { MuseumWalk.stop(); clearInterval(slideTimer); slideTimer = null; cancelCapture++; $('modalTitle').textContent = title; $('modalBody').replaceChildren(); if (typeof content === 'string') $('modalBody').innerHTML = content; else if (content) $('modalBody').append(content); $('modal').classList.toggle('artwork-modal', !!$('modalBody').querySelector('.view-image')); if (!$('modal').open) $('modal').showModal(); }
function closeModal() { clearInterval(slideTimer); slideTimer = null; if ($('modal').open) $('modal').close(); }
$('closeModal').onclick = closeModal; $('modal').addEventListener('close', () => { clearInterval(slideTimer); slideTimer = null; });
function confirmAction(title, message, action = '삭제') {
  return new Promise(resolve => {
    openModal(title, '<p id="confirmText"></p><div class="row"><button id="cancelConfirm">취소</button><button class="primary" id="yesConfirm"></button></div>');
    $('confirmText').textContent = message; $('yesConfirm').textContent = action;
    const closed = () => resolve(false); $('modal').addEventListener('close', closed, { once: true });
    $('cancelConfirm').onclick = closeModal;
    $('yesConfirm').onclick = () => { $('modal').removeEventListener('close', closed); closeModal(); resolve(true); };
    $('cancelConfirm').focus();
  });
}
async function newExhibition(fromSetup = false) {
  if (busy || !storageOK) return;
  busy = true; cancelCapture++; updateBusy();
  try {
    // 각 전시관은 별도 보관하며 새 전시관 생성으로 기존 작품을 지우지 않습니다.
    if (!fromSetup) {
      // 기존 데이터는 새 설정을 제출하고 저장에 성공할 때까지 유지합니다.
      stopCamera(); MuseumWalk.setActive(false); document.body.classList.remove('inside-museum'); ready = false; $('welcome').hidden = false; $('exhibition').hidden = true; $('settingsBtn').hidden = true;
      $('titleInput').value = DEFAULTS.title; $('countInput').value = DEFAULTS.count;
      themeChoices($('themeChoices'), 'setupTheme', DEFAULTS.theme); document.body.dataset.theme = DEFAULTS.theme;
      await renderLobby(); $('setupForm').scrollIntoView({behavior:'smooth'}); $('titleInput').focus();
      $('setupForm').dataset.confirmed = 'yes'; $('resumeBtn').disabled = !state; return;
    }
    await createFromSetup();
  } finally { busy = false; updateBusy(); }
}
async function createFromSetup() {
  const count = Number($('countInput').value), title = $('titleInput').value.trim();
  if (!title || !Number.isInteger(count) || count < 1 || count > 40) { toast('전시관 이름과 1~40 사이의 작품 수를 입력해 주세요.'); return; }
  const candidate = { id: crypto.randomUUID(), version: 2, settings: { ...DEFAULTS, title, count, theme: document.querySelector('[name=setupTheme]:checked').value, device: $('setupCamera').value }, works: Array(count).fill(null) };
  if (await commit(candidate)) { delete $('setupForm').dataset.confirmed; stopCamera(); enterExhibition(); MuseumWalk.entrance(); }
}
$('setupForm').onsubmit = async e => {
  e.preventDefault();
  if ($('setupForm').dataset.confirmed === 'yes') { if (busy) return; busy = true; try { await createFromSetup(); } finally { busy = false; updateBusy(); } }
  else await newExhibition(true);
};
$('resumeBtn').onclick = () => { if (state) { delete $('setupForm').dataset.confirmed; enterExhibition(); } };
$('newBtn').onclick = () => newExhibition(false);
// 촬영 버튼은 메뉴를 엽니다. ‘카메라 크게 보기’도 이 메뉴 안에 있어 촬영 기능이 한곳에 모입니다.
function updateShootMenu() {
  const full = nextSlot() < 0, live = !!stream;
  $('shootBtn').classList.toggle('camera-live', live);
  $('shootStartItem').disabled = full || (busy && !live);
  $('shootStartNote').textContent = full ? '빈 칸이 없어요. 작품 수를 늘리거나 작품을 삭제해 주세요.' : live ? '켜져 있는 카메라 화면을 크게 열어 촬영해요.' : '카메라를 켜고 큰 화면에서 작품을 촬영해요.';
  $('captureViewNote').textContent = live ? '숨겨 둔 카메라 화면을 다시 크게 봐요. 자동 촬영은 계속돼요.' : '카메라는 꺼 둔 채 카메라 화면과 설정만 열어요.';
  $('shootStopItem').disabled = !live;
}
function closeShootMenu() { if ($('shootMenu').hidden) return; $('shootMenu').hidden = true; $('shootBtn').setAttribute('aria-expanded', 'false'); }
function openShootMenu() {
  updateShootMenu(); const menu = $('shootMenu'), r = $('shootBtn').getBoundingClientRect();
  menu.hidden = false; $('shootBtn').setAttribute('aria-expanded', 'true');
  const width = menu.offsetWidth, height = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(r.left, innerWidth - width - 8)) + 'px';
  menu.style.top = (r.top - height - 8 >= 8 ? r.top - height - 8 : Math.min(r.bottom + 8, innerHeight - height - 8)) + 'px';
  menu.querySelector('button:not(:disabled)')?.focus();
}
$('shootBtn').onclick = e => { e.stopPropagation(); if ($('shootMenu').hidden) openShootMenu(); else closeShootMenu(); };
$('shootStartItem').onclick = async () => { closeShootMenu(); if (nextSlot() < 0) return; showCapture(true); if (!stream && !busy) await startCamera(); };
$('shootStopItem').onclick = () => { closeShootMenu(); if (busy) { toast('촬영이 끝난 뒤 카메라를 끌 수 있어요.'); return; } stopCamera(); status('카메라를 껐어요. 사진으로 작품을 추가할 수 있습니다.'); toast('카메라를 껐어요.'); };
document.addEventListener('click', e => { if (!$('shootMenu').hidden && !$('shootMenu').contains(e.target) && e.target !== $('shootBtn')) closeShootMenu(); });
document.addEventListener('keydown', e => {
  if ($('shootMenu').hidden) return;
  if (e.key === 'Escape') { closeShootMenu(); $('shootBtn').focus(); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const items = [...$('shootMenu').querySelectorAll('button:not(:disabled)')], at = items.indexOf(document.activeElement); items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
});
window.addEventListener('resize', closeShootMenu);
$('lobbyBtn').onclick = leaveExhibition; $('exitRoomBtn').onclick = leaveExhibition;
window.addEventListener('museum-exit', leaveExhibition);
$('captureViewBtn').onclick = () => { closeShootMenu(); showCapture(true); }; $('closeCameraPanel').onclick = () => showCapture(false);
$('galleryViewBtn').onclick = () => { showCapture(false); MuseumWalk.setActive(true); };
$('gridViewBtn').onclick = () => { showCapture(false); MuseumWalk.setActive(false); requestAnimationFrame(fitLayout); };
$('fullscreenBtn').onclick = async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else { showCapture(false); await document.documentElement.requestFullscreen(); } }
  catch { toast('전체화면을 지원하지 않는 환경입니다. 브라우저의 화면 확대 기능을 이용해 주세요.'); }
};
document.addEventListener('fullscreenchange', () => { $('fullscreenBtn').textContent = document.fullscreenElement ? '전체화면 종료' : '전체화면'; fitLayout(); });
window.addEventListener('resize', fitLayout);
$('fitToggle').onchange = async () => { if (busy) { $('fitToggle').checked = state.settings.fit; return; } busy = true; try { await commit({ ...state, settings: { ...state.settings, fit: $('fitToggle').checked } }); if (state.settings.fit) showCapture(false); render(); } finally { busy = false; updateBusy(); } };

// 카메라 권한은 사용자의 버튼 조작이 있을 때만 요청합니다.
function cameraError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return '카메라 사용을 허용해 주세요. 주소창의 카메라 권한을 확인해 주세요.';
  if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') return '사용 가능한 카메라를 찾지 못했습니다. 연결과 카메라 선택을 확인해 주세요.';
  if (error?.name === 'NotReadableError') return '다른 프로그램이 카메라를 사용 중일 수 있어요. 해당 프로그램을 닫고 다시 시작해 주세요.';
  return '카메라를 시작하지 못했어요. 연결을 확인하거나 사진으로 작품을 추가해 주세요.';
}
async function deviceList() {
  if (!navigator.mediaDevices) throw new Error('unsupported');
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
  for (const id of ['setupCamera', 'cameraSelect', 'settingCamera']) {
    const select = $(id); if (!select) continue;
    const selected = select.value || state?.settings.device || '';
    select.replaceChildren(new Option('자동 선택 · 노트북 포함', ''), new Option('노트북 · 전면 카메라', '@user'), new Option('휴대폰 후면 카메라', '@environment'));
    devices.forEach((d, i) => select.add(new Option(d.label || `카메라 ${i + 1}`, d.deviceId)));
    select.value = ['@user', '@environment'].includes(selected) || devices.some(d => d.deviceId === selected) ? selected : '';
  }
  return devices;
}
function stopCamera() {
  cameraRequest++; cancelCapture++; clearTimeout(scanTimer);
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null; $('video').srcObject = null; $('videoStage').classList.remove('active'); $('cameraPlaceholder').hidden = false;
  $('cameraBadge').textContent = '카메라 꺼짐'; $('countdown').textContent = ''; updateBusy();
}
async function startCamera() {
  if (busy) return;
  stopCamera(); const token = cameraRequest;
  if (!navigator.mediaDevices?.getUserMedia) { status('카메라는 HTTPS 주소 또는 localhost에서 사용할 수 있어요. 사진 추가는 계속 이용할 수 있습니다.'); return; }
  $('startCamera').disabled = true; status('카메라 사용 권한을 확인하고 있어요.');
  try {
    const selected = state.settings.device;
    // 자동 선택에는 방향을 강제하지 않습니다. 노트북의 내장 웹캠도 바로 사용합니다.
    const cameraChoice = selected.startsWith('@') ? { facingMode: { ideal: selected.slice(1) } } : selected ? { deviceId: { exact: selected } } : {};
    const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...cameraChoice, width: { ideal: 1920 }, height: { ideal: 1080 } } });
    if (token !== cameraRequest) { media.getTracks().forEach(t => t.stop()); return; }
    stream = media; $('video').srcObject = media; await $('video').play();
    if (token !== cameraRequest) return;
    $('videoStage').classList.add('active'); $('cameraPlaceholder').hidden = true; $('cameraBadge').textContent = media.getVideoTracks()[0].label || '카메라 연결됨';
    media.getVideoTracks()[0].addEventListener('ended', () => { if (stream === media) { stopCamera(); status('카메라 연결이 끊겼어요. 연결 후 다시 시작해 주세요.'); } });
    await deviceList(); updateGuide(); updateBusy(); status('화면 전체에서 QR을 찾고 있어요. 종이 네 모서리와 QR만 화면 안에 보이면 됩니다.'); scan();
  } catch (error) { if (token === cameraRequest) { stopCamera(); status(cameraError(error)); } }
  finally { $('startCamera').disabled = false; }
}
$('discoverCamera').onclick = async () => {
  let media; $('discoverCamera').disabled = true;
  try { if (!navigator.mediaDevices?.getUserMedia) { toast('카메라 선택은 HTTPS 주소 또는 localhost에서 사용해 주세요.'); return; } media = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); const devices = await deviceList(); toast(devices.length ? '카메라를 찾았어요. 사용할 장치를 선택해 주세요.' : '사용 가능한 카메라를 찾지 못했습니다.'); }
  catch (e) { toast(cameraError(e)); } finally { media?.getTracks().forEach(t => t.stop()); $('discoverCamera').disabled = false; }
};
$('startCamera').onclick = startCamera; $('stopCamera').onclick = () => { stopCamera(); status('카메라를 껐어요. 사진으로 작품을 추가할 수 있습니다.'); };
$('cameraSelect').onchange = async () => {
  if (busy) { $('cameraSelect').value = state.settings.device; return; }
  const device = $('cameraSelect').value, wasOn = !!stream; stopCamera();
  busy = true; try { await commit({ ...state, settings: { ...state.settings, device } }); } finally { busy = false; }
  if (wasOn) await startCamera();
};
navigator.mediaDevices?.addEventListener('devicechange', () => deviceList().catch(() => {}));
function updateGuide() {
  const v = $('video'); if (!v.videoWidth) return;
  const r = MuseumCapture.guide(v.videoWidth, v.videoHeight, state?.settings.landscape);
  Object.assign($('guide').style, { left: (r.x / v.videoWidth * 100) + '%', top: (r.y / v.videoHeight * 100) + '%', width: (r.w / v.videoWidth * 100) + '%', height: (r.h / v.videoHeight * 100) + '%' });
}
let lastQRLocation = null;
const scanCanvas = document.createElement('canvas'), scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
function scan() {
  clearTimeout(scanTimer); if (!stream) return;
  try {
    const v = $('video');
    if (!document.hidden && v.readyState >= 2 && v.videoWidth && window.jsQR) {
      const scale = Math.min(1, 960 / v.videoWidth); scanCanvas.width = Math.round(v.videoWidth * scale); scanCanvas.height = Math.round(v.videoHeight * scale);
      scanCtx.drawImage(v, 0, 0, scanCanvas.width, scanCanvas.height);
      const pixels = scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
      const qr = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'dontInvert' });
      const now = performance.now(); lastQR = qr?.data || null; if (qr) { lastSeen = now; lastQRLocation = qr.location; }
      const armed = gate.observe(!!qr, now);
      if (qr && armed && state.settings.auto && !busy && !togglePending && !$('modal').open && ready) {
        const slot = MuseumQR.slotFor(qr.data, state.settings.count, state.works);
        if (slot >= 0) capture(slot, qr.data);
        else if (slot === -3) status('이 번호의 칸에는 이미 작품이 있어요. 다른 번호 QR을 사용해 주세요.');
        else if (slot === -4) status('전시 칸 수보다 큰 번호예요. 설정에서 작품 수를 늘려 주세요.');
      }
    }
  } catch { status('QR을 읽기 어려워요. 조명을 조절하거나 수동 촬영을 사용해 주세요.'); }
  scanTimer = setTimeout(scan, 160);
}
async function capture(slot, qrText = null) {
  if (busy || !stream || slot < 0 || state.works[slot]) return;
  busy = true; updateBusy(); const token = ++cancelCapture;
  $('guide').classList.add('found'); status(qrText ? '작품을 찾았어요! 잠시 그대로 두세요.' : '잠시 그대로 두세요. 곧 촬영해요.');
  try {
    for (let n = 3; n >= 1; n--) {
      $('countdown').textContent = n;
      for (let step = 0; step < 5; step++) {
        await sleep(200);
        if (token !== cancelCapture || !stream || document.hidden || (qrText && (performance.now() - lastSeen > 850 || (lastQR && lastQR !== qrText)))) { status('촬영을 멈췄어요. 작품과 QR을 다시 맞춰 주세요.'); return; }
      }
    }
    $('countdown').textContent = '찰칵!'; gate.lock(performance.now());
    const result = await MuseumCapture.fromVideo($('video'), { ...state.settings, review: false });
    $('videoShell').classList.add('flash'); setTimeout(() => $('videoShell').classList.remove('flash'), 350);
    if (!result) { status('촬영을 취소했어요. 다시 촬영할 수 있습니다.'); return; }
    const saved = await register(result.blob, slot);
    status(saved ? '촬영했어요 (' + result.mode + '). 작품을 치우고 다음 작품을 올려 주세요.' : '저장하지 못했어요. 저장 공간을 확인한 후 다시 촬영해 주세요.');
  } catch { toast('촬영을 완료하지 못했어요. 다시 촬영하거나 사진으로 작품을 추가해 주세요.'); }
  finally { $('countdown').textContent = ''; $('guide').classList.remove('found'); busy = false; updateBusy(); }
}
$('manualBtn').onclick = () => capture(nextSlot());
let togglePending = false;
$('autoBtn').onclick = async () => {
  if (!state) return;
  if (togglePending) return;
  togglePending = true;
  const auto = busy ? false : !state.settings.auto;
  // OFF는 즉시 카운트다운을 중단하고, 진행 중 저장이 끝나면 설정을 안전하게 저장합니다.
  cancelCapture++; $('autoBtn').textContent = auto ? '자동 촬영 켜는 중' : '자동 촬영 끄는 중';
  while (busy) await sleep(80);
  busy = true; try { await commit({ ...state, settings: { ...state.settings, auto } }); render(); } finally { busy = false; togglePending = false; updateBusy(); }
};
function chime() {
  if (!state.settings.sound) return;
  try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); const o = audioContext.createOscillator(), g = audioContext.createGain(); o.connect(g); g.connect(audioContext.destination); o.frequency.value = 660; g.gain.setValueAtTime(.07, audioContext.currentTime); g.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .25); o.start(); o.stop(audioContext.currentTime + .25); } catch { /* 효과음 실패는 등록을 막지 않습니다. */ }
}
async function arrival(slot, work) {
  showCapture(false); await MuseumWalk.reveal(slot, work);
}
async function completed() {
  if (occupied() !== state.settings.count) return;
  openModal('전시관이 완성되었습니다!', '<div class="complete"><div class="sparkle" aria-hidden="true">✧ ✦ ✧</div><p>우리 반의 소중한 작품이 모두 모였어요.<br>이제 함께 감상해 볼까요?</p><button id="viewComplete" class="primary">전체 작품 보기</button></div>');
  showCapture(false); $('viewComplete').onclick = closeModal;
  setTimeout(() => { if ($('viewComplete')) closeModal(); }, 4000);
}
async function register(blob, slot, { immediate = false } = {}) {
  if (slot < 0 || state.works[slot]) return false;
  const image = await createImageBitmap(blob); const width = image.width, height = image.height; image.close();
  const work = { width, height, id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, blob, name: '', title: '', description: '', createdAt: Date.now() };
  const works = state.works.slice(); works[slot] = work;
  if (!(await commit({ ...state, works }))) return false;
  if (immediate) { render(); return true; }
  MuseumWalk.prepareArrival(slot); render(); chime(); await arrival(slot, work);
  if (state.settings.askName || state.settings.useDescription) await editArtwork(slot, true);
  await completed(); return true;
}
$('uploadBtn').onclick = () => { if (!busy) $('fileInput').click(); };
$('fileInput').onchange = async e => {
  const files = [...e.target.files]; e.target.value = ''; if (busy || !files.length) return;
  busy = true; cancelCapture++; updateBusy(); let added = 0;
  MuseumWalk.stop(); showCapture(false);
  try {
    for (const file of files) {
      const slot = nextSlot(); if (slot < 0) { toast('전시관이 가득 찼어요. 작품 수를 늘리거나 새 전시관을 만들어 주세요.'); break; }
      try {
        const result = await MuseumCapture.fromFile(file, { autoCrop: state.settings.autoDocument !== false });
        if (!result) break;
        if (!(await register(result.blob, slot, { immediate: true }))) break;
        added++; status(`사진 작품 ${added}개를 액자에 넣었어요.`);
      }
      catch { toast('읽을 수 없는 사진이에요. 30MB 이하의 JPG·PNG·WebP 사진으로 다시 시도해 주세요.'); }
    }
  } finally { busy = false; updateBusy(); if (added) toast(`사진 작품 ${added}개를 바로 전시했어요. 이름과 설명은 액자를 두 번 눌러 입력하세요.`); }
};
function showArtwork(slot) {
  const work = state.works[slot]; if (!work) return;
  const content = document.createElement('div'), img = document.createElement('img'); img.className = 'view-image'; img.src = imageURL(work); img.alt = `전시물 ${number(slot)}`; content.append(img);
  if (work.name) { const p = document.createElement('p'); p.textContent = work.name; content.append(p); }
  if (state.settings.useDescription && work.description) { const p = document.createElement('p'); p.className = 'work-description'; p.textContent = work.description; content.append(p); }
  const edit = document.createElement('button'); edit.textContent = '작품 편집'; edit.onclick = () => editArtwork(slot); content.append(edit); img.ondblclick = () => editArtwork(slot);
  openModal(work.title || `전시물 ${number(slot)}`, content);
}
function editArtwork(slot, registration = false) {
  const work = state.works[slot]; if (!work) return Promise.resolve();
  const content = document.createElement('div'), img = document.createElement('img'); img.className = 'view-image'; img.src = imageURL(work); img.alt = work.title || `전시물 ${number(slot)}`; content.append(img);
  const field = (id, label, value, multiline = false) => { const l = document.createElement('label'); l.htmlFor = id; l.textContent = label; const input = document.createElement(multiline ? 'textarea' : 'input'); input.id = id; input.value = value || ''; input.maxLength = multiline ? 2000 : 80; if (multiline) input.rows = 4; content.append(l, input); return input; };
  content.className = 'artwork-editor';
  const title = field('workTitle', '작품 이름', work.title), name = field('workAuthor', '학생 이름 (선택)', work.name);
  const description = state.settings.useDescription ? field('workDescription', '작품 설명 (선택)', work.description, true) : null;
  const save = document.createElement('button'); save.className = 'primary'; save.textContent = '작품 정보 저장';
  save.onclick = async () => { if (busy && !registration) return; save.disabled = true; const works = state.works.slice(); works[slot] = { ...works[slot], title: title.value.trim(), name: name.value.trim(), description: description ? description.value.trim() : (work.description || '') }; if (await commit({ ...state, works })) { render(); closeModal(); toast('작품 정보를 저장했어요.'); } else save.disabled = false; }; content.append(save);
  const row = document.createElement('div'); row.className = 'row'; const recrop = document.createElement('button'); recrop.textContent = '종이 크롭 다시 맞추기'; recrop.onclick = () => recropWork(slot); row.append(recrop); const del = document.createElement('button'); del.className = 'danger'; del.textContent = '이 작품 삭제'; del.onclick = () => removeWork(slot); row.append(del); content.append(row);
  if (registration) row.hidden = true;
  openModal('작품 편집 · ' + (work.title || `전시물 ${number(slot)}`), content);
  return new Promise(resolve => $('modal').addEventListener('close', resolve, { once: true }));
}
async function removeWork(slot) {
  if (busy) { toast('지금 작품을 등록하고 있어요. 벽에 걸린 뒤 삭제해 주세요.'); return; }
  if (!state.works[slot]) return;
  busy = true; updateBusy();
  try { if (!(await confirmAction('작품 삭제', `전시물 ${number(slot)}을 삭제할까요? 빈 자리는 그대로 유지됩니다.`))) return; const works = state.works.slice(); works[slot] = null; if (await commit({ ...state, works })) { render(); toast('작품을 삭제했어요. 빈 칸에 새 작품을 전시할 수 있습니다.'); } }
  finally { busy = false; updateBusy(); }
}
$('deleteLastBtn').onclick = () => { let slot = -1; state.works.forEach((work, i) => { if (work && (slot < 0 || work.createdAt >= state.works[slot].createdAt)) slot = i; }); if (slot >= 0) removeWork(slot); };
$('deleteWorksBtn').onclick = () => {
  if (busy) { toast('작품 등록이 끝난 뒤 삭제할 수 있어요.'); return; }
  const content = document.createElement('div'); content.className = 'delete-works-list';
  state.works.forEach((work, slot) => {
    if (!work) return;
    const button = document.createElement('button'), img = document.createElement('img'), label = document.createElement('span');
    img.src = imageURL(work); img.alt = ''; label.textContent = `전시물 ${number(slot)} 삭제`;
    button.append(img, label); button.onclick = () => removeWork(slot); content.append(button);
  });
  if (!occupied()) content.textContent = '아직 등록된 작품이 없어요.';
  openModal('삭제할 작품을 선택해 주세요', content);
};
$('helpBtn').onclick = () => openModal('작품을 전시하는 방법', '<ol class="help-steps"><li>전시관 이름과 작품 수를 정해요.</li><li>카메라를 선택해요.</li><li>학생 작품을 실물화상기에 올려요.</li><li>QR을 보여 주면 자동으로 촬영돼요.</li><li>작품이 전시관에 바로 나타나요.</li></ol><p>QR이 잘 읽히지 않으면 ‘수동 촬영’을 사용하세요.</p><p>실물화상기를 사용할 수 없다면 ‘사진으로 작품 추가’를 사용하세요.</p><p class="small">작품은 이 기기의 브라우저에만 저장됩니다.</p>');
$('settingsBtn').onclick = () => {
  if (busy) { toast('작품 등록이 끝나면 설정을 바꿀 수 있어요.'); return; }
  const s = state.settings, highest = state.works.reduce((max, w, i) => w ? i + 1 : max, 1);
  openModal('전시관 설정', '<form id="settingsForm"><label for="settingTitle">전시관 이름</label><input id="settingTitle" maxlength="60" required><label for="settingCount">작품 칸 수</label><input id="settingCount" type="number" max="40" required><p id="countHelp" class="small"></p><fieldset class="theme-field"><legend>전시관 분위기</legend><div id="settingThemes" class="theme-choices"></div></fieldset><label for="settingCamera">카메라 선택</label><select id="settingCamera"></select><label class="inline-label"><input id="settingAuto" type="checkbox">자동 촬영</label><label class="inline-label"><input id="settingSound" type="checkbox">등록 효과음</label><label class="inline-label"><input id="settingName" type="checkbox">작품 등록 후 작품 이름·학생 이름 입력</label><label class="inline-label"><input id="settingDescription" type="checkbox">작품 설명 입력·표시 사용</label><label class="inline-label"><input id="settingLandscape" type="checkbox">가로 작품용 촬영 가이드</label><div id="advancedSettings"></div><p class="small">작품은 이 기기의 브라우저에만 저장됩니다.<br>브라우저의 사이트 데이터를 지우면 작품도 삭제됩니다.</p><div class="row"><button type="submit" class="primary">설정 저장</button></div></form><div class="settings-danger"><p>이 전시관과 안에 걸린 작품을 모두 지워요. 다른 전시관은 그대로 남아요.</p><button type="button" id="deleteRoomBtn">이 전시관 삭제</button></div>');
  $('deleteRoomBtn').onclick = () => deleteRoom({ id: state.id, title: s.title, occupied: occupied() });
  $('settingTitle').value = s.title; $('settingCount').value = s.count; $('settingCount').min = highest;
  $('countHelp').textContent = `빈 자리를 유지하기 위해 마지막 작품이 있는 ${highest}번 칸까지는 남겨 두어요.`;
  themeChoices($('settingThemes'), 'settingTheme', s.theme);
  $('settingAuto').checked = s.auto; $('settingSound').checked = s.sound; $('settingName').checked = s.askName; $('settingDescription').checked = !!s.useDescription; $('settingLandscape').checked = s.landscape;
  $('settingCamera').replaceChildren(...[...$('cameraSelect').options].map(o => o.cloneNode(true))); $('settingCamera').value = s.device;
  deviceList().catch(() => {});
  if (window.MuseumAdvanced) MuseumAdvanced.settingsUI(s);
  $('settingsForm').onsubmit = async e => {
    e.preventDefault(); if (busy) return;
    const title = $('settingTitle').value.trim(), count = Number($('settingCount').value); if (!title || !Number.isInteger(count) || count < highest || count > 40) { toast('전시관 이름과 작품 수를 확인해 주세요.'); return; }
    const settings = { ...s, title, count, theme: document.querySelector('[name=settingTheme]:checked').value, device: $('settingCamera').value, auto: $('settingAuto').checked, sound: $('settingSound').checked, askName: $('settingName').checked, useDescription: $('settingDescription').checked, landscape: $('settingLandscape').checked, ...(window.MuseumAdvanced ? MuseumAdvanced.settingsValues() : {}) };
    const wasOn = !!stream, changeCamera = settings.device !== s.device;
    busy = true;
    try { if (await commit({ ...state, settings, works: Array.from({ length: count }, (_, i) => state.works[i] || null) })) { if (settings.sound) { try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); await audioContext.resume(); } catch {} } render(); closeModal(); toast('설정을 저장했어요.'); } }
    finally { busy = false; updateBusy(); }
    if (changeCamera && wasOn) startCamera();
  };
};

async function renderLobby() {
  const rooms = await MuseumStore.list(); const list = $('roomList'); list.replaceChildren();
  $('roomLobby').hidden = !rooms.length;
  for (const room of rooms) {
    const wrap = document.createElement('div'); wrap.className = 'room-card-wrap';
    const button = document.createElement('button'); button.className = 'room-card'; button.dataset.room = room.id;
    const image = themeThumb('room-thumb', room.theme);
    const title = document.createElement('strong'); title.textContent = room.title;
    const detail = document.createElement('span'); detail.textContent = `${THEMES[room.theme] || '전시관'} · 작품 ${room.occupied} / ${room.count} · 입장 →`;
    button.append(image,title,detail); button.onclick = async () => {
      if (busy) return; busy = true;
      try { const roomState = await MuseumStore.room(room.id); if (roomState && await commit(roomState)) { enterExhibition(); MuseumWalk.entrance(); } }
      catch { failSave(); } finally { busy = false; updateBusy(); }
    };
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'room-delete'; remove.textContent = '삭제'; remove.setAttribute('aria-label', `${room.title} 전시관 삭제`);
    remove.onclick = () => deleteRoom(room);
    wrap.append(button, remove); list.append(wrap);
  }
  $('resumeBtn').disabled = !state;
}
// 전시관 삭제: 확인 후 해당 전시관의 설정과 작품만 지웁니다. 다른 전시관은 유지됩니다.
async function deleteRoom(room) {
  if (busy) { toast('작품 등록이 끝난 뒤 전시관을 삭제할 수 있어요.'); return; }
  if (!room?.id) return;
  const inside = !$('exhibition').hidden && state?.id === room.id;
  const works = room.occupied ? `걸려 있는 작품 ${room.occupied}개도 함께 삭제되며` : '삭제하면';
  if (!(await confirmAction('전시관 삭제', `‘${room.title}’ 전시관을 삭제할까요? ${works} 되돌릴 수 없어요.`, '전시관 삭제'))) return;
  busy = true; updateBusy();
  try {
    await MuseumStore.remove(room.id);
    if (state?.id === room.id) { state = null; cleanupURLs(); }
    toast(`‘${room.title}’ 전시관을 삭제했어요.`);
  } catch { toast('전시관을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.'); busy = false; updateBusy(); return; }
  busy = false; updateBusy();
  if (inside) await leaveExhibition(); else { try { await renderLobby(); } catch { failSave(); } }
}
async function leaveExhibition() {
  if (busy) { toast('작품 등록을 마친 뒤 로비로 나갈 수 있어요.'); return; }
  closeModal(); stopCamera(); MuseumWalk.stop(); MuseumWalk.setActive(false); showCapture(false);
  ready = false; document.body.classList.remove('inside-museum'); $('welcome').hidden = false; $('exhibition').hidden = true; $('settingsBtn').hidden = true;
  document.body.dataset.theme = document.querySelector('[name=setupTheme]:checked')?.value || DEFAULTS.theme;
  try { await renderLobby(); } catch { failSave(); } window.scrollTo(0,0);
}
async function recropWork(slot) {
  if (busy) return; busy = true; updateBusy(); const work = state.works[slot]; closeModal();
  try {
    const result = await MuseumCapture.fromFile(work.blob); if (!result) return;
    const image = await createImageBitmap(result.blob); const width = image.width, height = image.height; image.close();
    const works = state.works.slice(); works[slot] = {...work,id:crypto.randomUUID(),blob:result.blob,width,height};
    if (await commit({...state,works})) { render(); toast('종이 크롭과 액자 방향을 바꿨어요.'); }
  } catch { toast('작품을 보정하지 못했어요. 원래 작품은 유지됩니다.'); }
  finally { busy = false; updateBusy(); }
}
async function init() {
  try { await renderLobby(); state = await MuseumStore.read(); if (state) { state.settings = { ...DEFAULTS, ...state.settings }; if (!Array.isArray(state.works) || state.settings.count < 1 || state.settings.count > 40) throw new Error('invalid'); } $('resumeBtn').disabled = !state; $('setupForm').querySelector('[type=submit]').disabled = false; }
  catch { storageOK = false; $('setupForm').querySelector('[type=submit]').disabled = true; $('saveStatus').textContent = '저장소를 열 수 없습니다. 다른 탭을 닫거나 일반 브라우저에서 열어 주세요. 기존 사이트 데이터는 지우지 마세요.'; }
  if (!window.jsQR) toast('QR 기능 파일을 찾지 못했습니다. 수동 촬영과 사진 추가를 사용해 주세요.');
  deviceList().catch(() => {});
}
// 여러 탭의 오래된 상태가 서로 덮어쓰지 않도록 한 탭만 편집합니다.
if (navigator.locks) navigator.locks.request('memory-museum-editor', { ifAvailable: true }, async lock => {
  if (!lock) { $('setupForm').querySelector('[type=submit]').disabled = true; $('saveStatus').textContent = '다른 탭에서 전시관이 열려 있어요. 그 탭을 닫은 뒤 이 화면을 새로고침해 주세요.'; return; }
  await init(); await new Promise(resolve => { releaseLock = resolve; });
}); else init();
window.addEventListener('pagehide', () => { stopCamera(); releaseLock?.(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelCapture++; gate.lock(performance.now()); } });

// 감상 모드는 번호 순서대로 3초마다 전환합니다. 닫을 때 타이머를 정리합니다.
$('slideshowBtn').onclick = () => {
  if (!occupied() || busy) return;
  slideIndex = 0; slidePaused = false;
  openModal('작품 감상', '<img id="slideImage" class="view-image" alt=""><p id="slideCaption"></p><div class="row"><button id="slidePrev">이전</button><button id="slidePause">일시정지</button><button id="slideNext">다음</button><button id="slideEnd">종료</button></div>');
  const works = state.works.map((work, slot) => ({ work, slot })).filter(x => x.work);
  const draw = () => { const { work, slot } = works[slideIndex]; $('slideImage').src = imageURL(work); $('slideImage').alt = `전시물 ${number(slot)}`; $('slideCaption').textContent = `전시물 ${number(slot)}${work.title ? ' · ' + work.title : ''}${work.name ? ' · ' + work.name : ''}${state.settings.useDescription && work.description ? ' — ' + work.description : ''} (${slideIndex + 1} / ${works.length})`; };
  const move = step => { slideIndex = (slideIndex + step + works.length) % works.length; draw(); };
  const resetTimer = () => { clearInterval(slideTimer); slideTimer = setInterval(() => { if (!slidePaused && !document.hidden) move(1); }, 3000); };
  $('slidePrev').onclick = () => { move(-1); resetTimer(); }; $('slideNext').onclick = () => { move(1); resetTimer(); };
  $('slidePause').onclick = () => { slidePaused = !slidePaused; $('slidePause').textContent = slidePaused ? '다시 재생' : '일시정지'; resetTimer(); };
  $('slideEnd').onclick = closeModal; draw(); resetTimer();
};
document.addEventListener('keydown', e => { if (!$('slideImage') || !$('modal').open) return; if (e.key === 'ArrowLeft') $('slidePrev').click(); if (e.key === 'ArrowRight') $('slideNext').click(); });

function download(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
function png(canvas) { return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG')), 'image/png')); }
$('qrBtn').onclick = () => {
  openModal('활동지에 붙이는 전시용 QR', '<p>공통 QR은 다음 빈 칸에, 번호 QR은 해당 번호 칸에 전시해요. 한 활동지에는 QR을 하나만 넣어 주세요.</p><div class="row"><button id="commonQR" class="primary">공통 QR 만들기</button><button id="numberQR">번호 QR 만들기</button><button id="printQR">A4 인쇄</button></div><p class="small">흰 여백을 포함해 가로 3cm 이상으로 인쇄해 주세요.</p><div id="qrList" class="qr-list"></div>');
  let numbered = false;
  function build() {
    try {
      const list = $('qrList'); list.replaceChildren();
      const codes = numbered ? Array.from({ length: state.settings.count }, (_, i) => 'EXHIBIT-' + number(i)) : ['CLASS-EXHIBIT'];
      for (const text of codes) {
        const box = document.createElement('div'); box.className = 'qr-item'; const c = MuseumQR.canvas(text), label = document.createElement('p'), button = document.createElement('button'); label.textContent = text; button.textContent = 'PNG 저장';
        button.onclick = async () => { try { download(await png(c), text + '.png'); } catch { toast('QR 이미지를 저장하지 못했어요. 다시 시도해 주세요.'); } };
        box.append(c, label, button); list.append(box);
      }
    } catch { toast('QR 생성 파일을 찾지 못했어요. vendor 폴더를 확인해 주세요.'); }
  }
  $('commonQR').onclick = () => { numbered = false; build(); }; $('numberQR').onclick = () => { numbered = true; build(); };
  $('printQR').onclick = () => {
    try {
      const area = $('printArea'); area.replaceChildren(); const title = document.createElement('h1'); title.textContent = state.settings.title + ' · 전시용 QR'; const list = document.createElement('div'); list.className = 'qr-list';
      for (let i = 0; i < state.settings.count; i++) { const text = numbered ? 'EXHIBIT-' + number(i) : 'CLASS-EXHIBIT', box = document.createElement('div'), img = document.createElement('img'), label = document.createElement('p'); box.className = 'qr-item'; img.src = MuseumQR.canvas(text).toDataURL('image/png'); label.textContent = text; box.append(img, label); list.append(box); }
      area.append(title, list); Promise.all([...area.querySelectorAll('img')].map(img => img.decode())).then(() => window.print()).catch(() => toast('인쇄 이미지를 준비하지 못했어요. 다시 시도해 주세요.'));
    } catch { toast('인쇄를 준비하지 못했어요. QR PNG 저장을 이용해 주세요.'); }
  };
  build();
};
$('exportBtn').onclick = async () => {
  if (busy) { toast('작품 등록이 끝난 뒤 저장해 주세요.'); return; }
  busy = true; $('exportBtn').disabled = true;
  try {
    const count = state.settings.count, cols = Math.min(6, Math.ceil(Math.sqrt(count * 1.5))), rows = Math.ceil(count / cols), cellW = 340, cellH = 410, gap = 32, margin = 60;
    const c = MuseumCapture.make(margin * 2 + cols * cellW + (cols - 1) * gap, 210 + rows * cellH + (rows - 1) * gap + margin), ctx = c.getContext('2d'), style = getComputedStyle(document.body);
    ctx.fillStyle = style.getPropertyValue('--wall'); ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = style.getPropertyValue('--ink'); ctx.font = 'bold 46px "Malgun Gothic", sans-serif'; ctx.fillText(state.settings.title, margin, 88, c.width - margin * 2);
    ctx.font = '26px "Malgun Gothic", sans-serif'; ctx.fillText(`현재 전시 작품 ${occupied()} / ${count}`, margin, 140);
    for (let i = 0; i < count; i++) {
      const x = margin + (i % cols) * (cellW + gap), y = 190 + Math.floor(i / cols) * (cellH + gap), frameH = cellH - 45;
      ctx.fillStyle = style.getPropertyValue('--frame'); ctx.fillRect(x, y, cellW, frameH); ctx.fillStyle = style.getPropertyValue('--surface'); ctx.fillRect(x + 12, y + 12, cellW - 24, frameH - 24);
      const work = state.works[i];
      if (work) { const img = new Image(); img.src = imageURL(work); await img.decode(); const scale = Math.min((cellW - 40) / img.width, (frameH - 40) / img.height); ctx.drawImage(img, x + (cellW - img.width * scale) / 2, y + (frameH - img.height * scale) / 2, img.width * scale, img.height * scale); }
      else { ctx.fillStyle = style.getPropertyValue('--frame'); ctx.font = '48px Georgia'; ctx.textAlign = 'center'; ctx.fillText(number(i), x + cellW / 2, y + frameH / 2); }
      ctx.textAlign = 'center'; ctx.fillStyle = style.getPropertyValue('--ink'); ctx.font = '24px "Malgun Gothic", sans-serif'; ctx.fillText(`전시물 ${number(i)}${work?.name ? ' · ' + work.name : ''}`, x + cellW / 2, y + frameH + 33, cellW); ctx.textAlign = 'left';
    }
    download(await png(c), '우리-반-전시관.png'); toast('전체 전시관 이미지를 저장했어요.');
  } catch { toast('이미지를 저장하지 못했어요. 기기 저장 공간을 확인하고 다시 시도해 주세요.'); }
  finally { busy = false; $('exportBtn').disabled = false; updateBusy(); }
};

