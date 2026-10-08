window.museumAuthReady = new Promise((resolve) => {
  document.addEventListener('DOMContentLoaded', async () => {
    const loginScreen = document.getElementById('loginScreen');
    const loginForm = document.getElementById('loginForm');
    const loginMessage = document.getElementById('loginMessage');

    const appParts = [
      document.querySelector('header'),
      document.querySelector('main'),
      document.querySelector('footer')
    ];

    function showApp() {
      loginScreen.hidden = true;
      appParts.forEach(el => {
        if (el) el.hidden = false;
      });
    }

    function showLogin() {
      loginScreen.hidden = false;
      appParts.forEach(el => {
        if (el) el.hidden = true;
      });
    }

    const shareToken =
      new URLSearchParams(location.search).get('share');

    /*
      공유 링크로 들어온 방문자는
      선생님 로그인 없이 전시관을 볼 수 있도록 합니다.
    */
    if (shareToken) {
      showApp();
      resolve(true);
      return;
    }

    const user = await getCurrentUser();

    if (user) {
      showApp();
      resolve(true);
    } else {
      showLogin();

      loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        loginMessage.textContent = '로그인 중...';

        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;

        try {
          await signIn(email, password);
          loginMessage.textContent = '';
          showApp();
          resolve(true);
        } catch (error) {
          console.error(error);
          loginMessage.textContent =
            '로그인에 실패했습니다. 이메일과 비밀번호를 확인해 주세요.';
        }
      });
    }
  });
});
/* 모든 데이터는 이 브라우저의 IndexedDB 안에서만 처리합니다. */
'use strict';
const $ = id => document.getElementById(id);
const THEMES = { museum: '클래식 박물관', art: '유럽 궁전 미술관', simple: '현대 미술관', tradition: '조선 궁궐관' };
const THEME_NOTES = { museum: '아이보리 벽·금빛 액자·마루', art: '붉은 벽·바로크 금박 액자·대리석', simple: '어두운 벽·스포트라이트·콘크리트', tradition: '단청·붉은 기둥·족자·일월오봉도' };
const THEME_PREVIEWS = { museum: 'museum-entry.png', art: 'rooms/euro-entry.jpg', simple: 'rooms/modern-entry.jpg', tradition: 'rooms/palace-entry.jpg' };
const DEFAULTS = { title: '우리 반 기억 박물관', count: 24, theme: 'museum', device: '', auto: true, sound: false, askTitle: false, askAuthor: false, askDescription: false, cameraOrientation: 'landscape', landscape: false, fit: false, autoDocument: true, hideQR: true, kiosk: true };
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
// 자동 게시 모드: 카메라를 계속 켜 두고, QR을 비추면 클릭 없이 촬영·전시합니다.
let kioskPaused = false, lastCameraError = '', wakeLock = null, liveTimer;
const kioskOn = () => !!state && ready && state.settings.kiosk !== false && state.settings.auto !== false && !kioskPaused;
function setCountdown(text) { $('countdown').textContent = text; $('miniCountdown').textContent = text; }
function live(title, note, mode = 'idle') {
  $('liveTitle').textContent = title; $('liveNote').textContent = note; $('liveMonitor').dataset.mode = mode;
}
function liveReady() {
  if (!state) return;
  const slot = nextSlot();
  if (slot < 0) live('전시관이 가득 찼어요', '설정에서 작품 수를 늘리면 계속 전시할 수 있어요.', 'full');
  else live('QR을 비춰 주세요', `활동지의 QR이 보이면 자동으로 찍어 ${number(slot)}번 액자에 걸어요.`, 'idle');
}
function updateLiveMonitor() {
  const show = kioskOn() && !$('exhibition').hidden;
  $('liveMonitor').hidden = !show;
  $('liveStartBtn').hidden = !show || !!stream;
  if (show && !stream && !$('liveMonitor').dataset.mode?.startsWith('error')) live('카메라를 켜는 중', '잠시만 기다려 주세요.', 'wait');
  if (show && stream) requestWakeLock(); else releaseWakeLock();
}
async function requestWakeLock() { try { if (!wakeLock && navigator.wakeLock && !document.hidden) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { wakeLock = null; } }
function releaseWakeLock() { try { wakeLock?.release(); } catch {} wakeLock = null; }
async function ensureKioskCamera() {
  if (!kioskOn() || stream || busy || $('exhibition').hidden) { updateLiveMonitor(); return; }
  updateLiveMonitor(); await startCamera(); updateLiveMonitor();
  if (!stream) live('카메라를 켜지 못했어요', lastCameraError || '카메라 연결을 확인해 주세요. 아래 버튼을 한 번 누르면 다시 시도해요.', 'error');
  else liveReady();
}
// 카메라가 잠깐 끊겨도 권한이 있으면 저절로 다시 켭니다.
setInterval(() => { if (kioskOn() && !stream && !busy && !document.hidden && !$('exhibition').hidden && lastCameraError !== 'NotAllowedError') ensureKioskCamera(); }, 6000);
function failSave() { $('saveStatus').textContent = '저장하지 못했습니다. 기존 작품은 유지됩니다. 기기 저장 공간과 브라우저 설정을 확인해 주세요.'; $('saveStatus').classList.add('save-error'); toast('저장하지 못했어요. 저장 공간을 확보한 뒤 다시 시도해 주세요.'); }
async function commit(candidate) {
  try { await MuseumStore.write(candidate); state = candidate; $('saveStatus').textContent = '저장 완료 · 작품은 이 기기의 브라우저에만 저장됩니다.'; $('saveStatus').classList.remove('save-error'); return true; }
  catch { failSave(); return false; }
}
function imageURL(work) { if (!imageURLs.has(work.id)) imageURLs.set(work.id, URL.createObjectURL(work.blob)); return imageURLs.get(work.id); }
function cleanupURLs() { const ids = new Set((state?.works || []).filter(Boolean).map(w => w.id)); for (const [id, url] of imageURLs) if (!ids.has(id)) { URL.revokeObjectURL(url); imageURLs.delete(id); } }
function updateBusy() { $('cameraOrientation').disabled = busy; updateShootMenu(); $('manualBtn').disabled = busy || !stream || nextSlot() < 0; $('uploadBtn').disabled = busy || nextSlot() < 0; }
function render() {
  if (!state) return;
  const s = state.settings; $('cameraOrientation').value = s.cameraOrientation || 'landscape'; document.body.dataset.theme = s.theme;
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
function enterExhibition() { ready = true; kioskPaused = false; document.body.classList.add('inside-museum'); $('welcome').hidden = true; $('exhibition').hidden = false; $('settingsBtn').hidden = false; showCapture(false); render(); MuseumWalk.setActive(true); ensureKioskCamera(); }
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
function updateShootMenu() {
  const full = nextSlot() < 0, live = !!stream;
  $('shootBtn').classList.toggle('camera-live', live);
  $('shootStartItem').disabled = full || (busy && !live);
  $('shootStartNote').textContent = full ? '빈 칸이 없어요. 작품 수를 늘리거나 작품을 삭제해 주세요.' : live ? '켜져 있는 카메라 화면을 크게 열어 촬영해요.' : '카메라를 켜고 큰 화면에서 작품을 촬영해요.';
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
$('shootStartItem').onclick = async () => { closeShootMenu(); if (nextSlot() < 0) return; kioskPaused = false; showCapture(true); if (!stream && !busy) await startCamera(); updateLiveMonitor(); };
$('shootStopItem').onclick = () => { closeShootMenu(); if (busy) { toast('촬영이 끝난 뒤 카메라를 끌 수 있어요.'); return; } kioskPaused = true; stopCamera(); status('카메라를 껐어요. 사진으로 작품을 추가할 수 있습니다.'); toast('카메라를 껐어요. 자동 게시는 ‘카메라로 촬영하기’로 다시 켤 수 있어요.'); };
document.addEventListener('click', e => { if (!$('shootMenu').hidden && !$('shootMenu').contains(e.target) && e.target !== $('shootBtn')) closeShootMenu(); });
document.addEventListener('keydown', e => {
  if ($('shootMenu').hidden) return;
  if (e.key === 'Escape') { closeShootMenu(); $('shootBtn').focus(); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const items = [...$('shootMenu').querySelectorAll('button:not(:disabled)')], at = items.indexOf(document.activeElement); items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
});
window.addEventListener('resize', closeShootMenu);
$('lobbyBtn').onclick = leaveExhibition; $('exitRoomBtn').onclick = leaveExhibition;
window.addEventListener('museum-exit', leaveExhibition);
$('closeCameraPanel').onclick = () => showCapture(false);
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
  $('cameraBadge').textContent = '카메라 꺼짐'; setCountdown(''); $('miniVideo').srcObject = null; updateBusy(); updateLiveMonitor();
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
    // 세로 작품에는 16:9보다 넓은 4:3 센서 영역을 요청합니다.
    // resizeMode:none은 브라우저의 디지털 크롭 대신 장치의 전체 영상을 우선합니다.
    const portrait = state.settings.cameraOrientation === 'portrait';
    const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...cameraChoice, width: { ideal: 3840 }, height: { ideal: portrait ? 2880 : 2160 }, aspectRatio: { ideal: portrait ? 4 / 3 : 16 / 9 }, resizeMode: { ideal: 'none' } } });
    if (token !== cameraRequest) { media.getTracks().forEach(t => t.stop()); return; }
    stream = media; $('video').srcObject = media; await $('video').play(); lastCameraError = '';
    const track = media.getVideoTracks()[0], capabilities = track.getCapabilities?.() || {};
    if (capabilities.focusMode?.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    $('miniVideo').srcObject = media; $('miniVideo').play().catch(() => {});
    if (token !== cameraRequest) return;
    $('videoStage').classList.add('active'); $('cameraPlaceholder').hidden = true; $('cameraBadge').textContent = media.getVideoTracks()[0].label || '카메라 연결됨';
    media.getVideoTracks()[0].addEventListener('ended', () => { if (stream === media) { stopCamera(); status('카메라 연결이 끊겼어요. 연결 후 다시 시작해 주세요.'); if (kioskOn()) live('카메라 연결이 끊겼어요', '다시 연결되면 저절로 켜져요.', 'error'); } });
    await deviceList(); updateGuide(); updateBusy(); status('화면 전체에서 QR을 찾고 있어요. 종이 네 모서리와 QR만 화면 안에 보이면 됩니다.'); updateLiveMonitor(); liveReady(); scan();
  } catch (error) { if (token === cameraRequest) { stopCamera(); lastCameraError = error?.name === 'NotAllowedError' ? 'NotAllowedError' : ''; status(cameraError(error)); if (kioskOn()) live('카메라를 켜지 못했어요', cameraError(error), 'error'); } }
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
function fitCameraPreview(video, container, orientation) {
  if (!video.videoWidth || !container.clientWidth || !container.clientHeight) return null;
  const size = MuseumCapture.frameSize(video, orientation);
  const scale = Math.min(container.clientWidth / size.width, container.clientHeight / size.height);
  const width = size.width * scale, height = size.height * scale;
  Object.assign(video.style, {
    position: 'absolute', left: '50%', top: '50%', maxWidth: 'none',
    width: (video.videoWidth * scale) + 'px', height: (video.videoHeight * scale) + 'px',
    objectFit: 'contain', transform: 'translate(-50%, -50%) rotate(' + (size.rotate ? 90 : 0) + 'deg)'
  });
  return { width, height, x: (container.clientWidth - width) / 2, y: (container.clientHeight - height) / 2 };
}
function updateGuide() {
  const orientation = state?.settings.cameraOrientation || 'landscape';
  const box = fitCameraPreview($('video'), $('videoStage'), orientation);
  fitCameraPreview($('miniVideo'), $('miniVideo').parentElement, orientation);
  if (!box) return;
  const r = MuseumCapture.guide(box.width, box.height);
  Object.assign($('guide').style, { left: (box.x + r.x) + 'px', top: (box.y + r.y) + 'px', width: r.w + 'px', height: r.h + 'px' });
}
$('cameraOrientation').onchange = async () => {
  if (!state || busy) { $('cameraOrientation').value = state?.settings.cameraOrientation || 'landscape'; return; }
  const cameraOrientation = $('cameraOrientation').value;
  busy = true; cancelCapture++; gate.lock(performance.now()); updateBusy();
  try {
    if (await commit({ ...state, settings: { ...state.settings, cameraOrientation } })) {
      updateGuide();
    }
  } finally { busy = false; $('cameraOrientation').value = state.settings.cameraOrientation || 'landscape'; updateBusy(); }
  // 방향에 맞는 센서 비율로 다시 연결합니다. 설정 저장 실패 시에는 기존 방향을 유지합니다.
  if (stream && state.settings.cameraOrientation === cameraOrientation) await startCamera();
  status(state.settings.cameraOrientation === 'portrait' ? '넓은 세로 촬영 · 화면 전체에서 QR을 찾아요. 종이와 QR을 모두 화면 안에 놓아 주세요.' : '가로 촬영 · 화면 전체에서 QR을 찾아요.');
};
const cameraPreviewObserver = new ResizeObserver(updateGuide);
cameraPreviewObserver.observe($('videoStage'));
cameraPreviewObserver.observe($('miniVideo').parentElement);
$('video').addEventListener('resize', updateGuide);
$('miniVideo').addEventListener('loadedmetadata', updateGuide);
let lastQRLocation = null;
const scanCanvas = document.createElement('canvas'), scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
let processingCapture = false;
async function scan() {
  clearTimeout(scanTimer); if (!stream) return;
  if (processingCapture) { scanTimer = setTimeout(scan, 100); return; }
  const scanRequest = cameraRequest;
  try {
    const v = $('video');
    if (!document.hidden && v.readyState >= 2 && v.videoWidth && window.jsQR) {
      const qr = await MuseumCapture.readFastQR(v, scanCanvas, state.settings.cameraOrientation);
      if (scanRequest !== cameraRequest || !stream) return;
      const now = performance.now(); lastQR = qr?.data || null; if (qr) { lastSeen = now; lastQRLocation = qr.location; }
      const armed = gate.observe(!!qr, now);
      if (qr && armed && state.settings.auto && !busy && !togglePending && !$('modal').open && ready) {
        const slot = MuseumQR.slotFor(qr.data, state.settings.count, state.works);
        if (slot >= 0) capture(slot, qr.data);
        else if (slot === -3) { status('이 번호의 칸에는 이미 작품이 있어요. 다른 번호 QR을 사용해 주세요.'); live('이미 작품이 있는 번호예요', '다른 번호 QR을 비춰 주세요.', 'warn'); }
        else if (slot === -4) { status('전시 칸 수보다 큰 번호예요. 설정에서 작품 수를 늘려 주세요.'); live('없는 번호예요', '설정에서 작품 수를 늘려 주세요.', 'warn'); }
        else if (slot === -1) liveReady();
      }
    }
  } catch { status('QR을 읽기 어려워요. 조명을 조절하거나 수동 촬영을 사용해 주세요.'); }
  if (scanRequest === cameraRequest && stream) scanTimer = setTimeout(scan, 60);
}
async function capture(slot, qrText = null) {
  if (busy || !stream || slot < 0 || state.works[slot]) return;
  busy = true; updateBusy(); const token = ++cancelCapture;
  $('guide').classList.add('found'); status(qrText ? 'QR을 찾았어요! 1초 후 촬영해요.' : '1초 후 촬영해요. 잠시 그대로 두세요.'); live('1초 후 촬영해요', `잠시 그대로 들어 주세요 · ${number(slot)}번 액자`, 'found');
  try {
    const deadline = performance.now() + 1000;
    setCountdown('1');
    while (performance.now() < deadline) {
        await sleep(Math.min(50, Math.max(0, deadline - performance.now())));
        if (token !== cancelCapture || !stream || document.hidden || (qrText && (performance.now() - lastSeen > 850 || (lastQR && lastQR !== qrText)))) { status('촬영을 멈췄어요. 작품과 QR을 다시 맞춰 주세요.'); live('다시 비춰 주세요', 'QR이 화면에서 벗어났어요. 활동지를 카메라 앞에 가만히 들어 주세요.', 'warn'); return; }
    }
    processingCapture = true; setCountdown('찰칵!'); gate.lock(performance.now());
    const result = await MuseumCapture.fromVideo($('video'), { ...state.settings, review: false });
    $('videoShell').classList.add('flash'); setTimeout(() => $('videoShell').classList.remove('flash'), 350);
    if (!result) { status('촬영을 취소했어요. 다시 촬영할 수 있습니다.'); return; }
    const saved = await register(result.blob, slot, { auto: !!qrText });
    if (saved && qrText) { live('전시했어요!', `${number(slot)}번 액자에 걸었어요. 활동지를 치우면 다음 친구 차례예요.`, 'done'); clearTimeout(liveTimer); liveTimer = setTimeout(() => { if (!busy && stream) liveReady(); }, 5200); }
    status(saved ? '촬영했어요 (' + result.mode + '). 작품을 치우고 다음 작품을 올려 주세요.' : '저장하지 못했어요. 저장 공간을 확인한 후 다시 촬영해 주세요.');
  } catch { toast('촬영을 완료하지 못했어요. 다시 촬영하거나 사진으로 작품을 추가해 주세요.'); }
  finally { processingCapture = false; setCountdown(''); $('guide').classList.remove('found'); busy = false; updateBusy(); }
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
async function register(blob, slot, { immediate = false, auto = false } = {}) {
  if (slot < 0 || state.works[slot]) return false;
  const image = await createImageBitmap(blob); const width = image.width, height = image.height; image.close();
  const work = { width, height, id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, blob, name: '', title: '', description: '', createdAt: Date.now() };
  const works = state.works.slice(); works[slot] = work;
  if (!(await commit({ ...state, works }))) return false;
  if (immediate) { render(); return true; }
  showCapture(false); render(); chime();
  // 자동 게시(QR)에서는 교사가 클릭하지 않아도 되도록 입력 창을 띄우지 않고, 새 작품 앞으로 다가가 보여 줍니다.
  if (auto && kioskOn()) { MuseumWalk.focus(slot, 1400); return true; }
  if (state.settings.askTitle || state.settings.askAuthor || state.settings.askDescription) await editArtwork(slot, true);
  return true;
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
  if (work.description) { const p = document.createElement('p'); p.className = 'work-description'; p.textContent = work.description; content.append(p); }
  const edit = document.createElement('button'); edit.textContent = '작품 편집'; edit.onclick = () => editArtwork(slot); content.append(edit); img.ondblclick = () => editArtwork(slot);
  openModal(work.title || `전시물 ${number(slot)}`, content);
}
function editArtwork(slot, registration = false) {
  const work = state.works[slot]; if (!work) return Promise.resolve();
  const content = document.createElement('div'), img = document.createElement('img'); img.className = 'view-image'; img.src = imageURL(work); img.alt = work.title || `전시물 ${number(slot)}`; content.append(img);
  const field = (id, label, value, multiline = false) => { const l = document.createElement('label'); l.htmlFor = id; l.textContent = label; const input = document.createElement(multiline ? 'textarea' : 'input'); input.id = id; input.value = value || ''; input.maxLength = multiline ? 2000 : 80; if (multiline) input.rows = 4; content.append(l, input); return input; };
  content.className = 'artwork-editor';
  const title = !registration || state.settings.askTitle ? field('workTitle', '작품 제목', work.title) : null;
  const name = !registration || state.settings.askAuthor ? field('workAuthor', '작가 이름', work.name) : null;
  const description = !registration || state.settings.askDescription ? field('workDescription', '작품 설명', work.description, true) : null;
  const save = document.createElement('button'); save.className = 'primary'; save.textContent = '작품 정보 저장';
  save.onclick = async () => { if (busy && !registration) return; save.disabled = true; const works = state.works.slice(); works[slot] = { ...works[slot], title: title ? title.value.trim() : (work.title || ''), name: name ? name.value.trim() : (work.name || ''), description: description ? description.value.trim() : (work.description || '') }; if (await commit({ ...state, works })) { render(); closeModal(); toast('작품 정보를 저장했어요.'); } else save.disabled = false; }; content.append(save);
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
  openModal('전시관 설정', '<form id="settingsForm"><label for="settingTitle">전시관 이름</label><input id="settingTitle" maxlength="60" required><label for="settingCount">작품 칸 수</label><input id="settingCount" type="number" max="40" required><p id="countHelp" class="small"></p><fieldset class="theme-field"><legend>전시관 분위기</legend><div id="settingThemes" class="theme-choices"></div></fieldset><label for="settingCamera">카메라 선택</label><select id="settingCamera"></select><label class="inline-label"><input id="settingAuto" type="checkbox">자동 촬영</label><label class="inline-label"><input id="settingKiosk" type="checkbox">자동 게시 모드 · 카메라를 항상 켜 두고 QR을 비추면 클릭 없이 바로 전시</label><label class="inline-label"><input id="settingSound" type="checkbox">등록 효과음</label><fieldset><legend>촬영 후 입력할 작품 정보 (선택)</legend><p class="small">모두 끄면 자동 크롭 후 입력 대기 없이 바로 전시합니다. 사진 일괄 업로드는 항상 바로 등록되며, 액자를 두 번 누르면 세 항목을 나중에 편집할 수 있어요.</p><label class="inline-label"><input id="settingWorkTitle" type="checkbox">작품 제목 적기</label><label class="inline-label"><input id="settingAuthor" type="checkbox">작가 이름 적기</label><label class="inline-label"><input id="settingDescription" type="checkbox">작품 설명 적기</label></fieldset><label for="settingOrientation">촬영 방향</label><select id="settingOrientation"><option value="landscape">가로</option><option value="portrait">세로</option></select><p class="small">선택한 방향으로 화면 전체를 회전해 촬영해요. 미리보기를 보며 작품 방향을 맞춰 주세요.</p><div id="advancedSettings"></div><p class="small">작품은 이 기기의 브라우저에만 저장됩니다.<br>브라우저의 사이트 데이터를 지우면 작품도 삭제됩니다.</p><div class="row"><button type="submit" class="primary">설정 저장</button></div></form><div class="settings-danger"><p>이 전시관과 안에 걸린 작품을 모두 지워요. 다른 전시관은 그대로 남아요.</p><button type="button" id="deleteRoomBtn">이 전시관 삭제</button></div>');
  $('deleteRoomBtn').onclick = () => deleteRoom({ id: state.id, title: s.title, occupied: occupied() });
  $('settingTitle').value = s.title; $('settingCount').value = s.count; $('settingCount').min = highest;
  $('countHelp').textContent = `빈 자리를 유지하기 위해 마지막 작품이 있는 ${highest}번 칸까지는 남겨 두어요.`;
  themeChoices($('settingThemes'), 'settingTheme', s.theme);
  $('settingAuto').checked = s.auto; $('settingKiosk').checked = s.kiosk !== false; $('settingSound').checked = s.sound; $('settingWorkTitle').checked = !!s.askTitle; $('settingAuthor').checked = !!s.askAuthor; $('settingDescription').checked = !!s.askDescription; $('settingOrientation').value = s.cameraOrientation || 'landscape';
  $('settingCamera').replaceChildren(...[...$('cameraSelect').options].map(o => o.cloneNode(true))); $('settingCamera').value = s.device;
  deviceList().catch(() => {});
  if (window.MuseumAdvanced) MuseumAdvanced.settingsUI(s);
  $('settingsForm').onsubmit = async e => {
    e.preventDefault(); if (busy) return;
    const title = $('settingTitle').value.trim(), count = Number($('settingCount').value); if (!title || !Number.isInteger(count) || count < highest || count > 40) { toast('전시관 이름과 작품 수를 확인해 주세요.'); return; }
    const settings = { ...s, title, count, theme: document.querySelector('[name=settingTheme]:checked').value, device: $('settingCamera').value, auto: $('settingAuto').checked, kiosk: $('settingKiosk').checked, sound: $('settingSound').checked, askTitle: $('settingWorkTitle').checked, askAuthor: $('settingAuthor').checked, askDescription: $('settingDescription').checked, cameraOrientation: $('settingOrientation').value, ...(window.MuseumAdvanced ? MuseumAdvanced.settingsValues() : {}) };
    const wasOn = !!stream, changeCamera = settings.device !== s.device || settings.cameraOrientation !== s.cameraOrientation;
    busy = true;
    try { if (await commit({ ...state, settings, works: Array.from({ length: count }, (_, i) => state.works[i] || null) })) { if (settings.sound) { try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); await audioContext.resume(); } catch {} } render(); closeModal(); toast('설정을 저장했어요.'); } }
    finally { busy = false; updateBusy(); }
    if (changeCamera && wasOn) await startCamera();
    if (kioskOn()) ensureKioskCamera(); else { if (state.settings.kiosk === false && stream && $('cameraPanel').hidden) stopCamera(); updateLiveMonitor(); }
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
  ready = false; $('liveMonitor').hidden = true; releaseWakeLock(); document.body.classList.remove('inside-museum'); $('welcome').hidden = false; $('exhibition').hidden = true; $('settingsBtn').hidden = true;
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
const shareToken = new URLSearchParams(location.search).get('share');

async function initSharedExhibition() {
  try {
    const response = await fetch(
      `https://nbrnfelktphyvjwuftyz.supabase.co/functions/v1/share-exhibition?token=${encodeURIComponent(shareToken)}`
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || '공유 전시관을 불러오지 못했습니다.');
    }

    const exhibition = data.exhibition;
    const works = data.works || [];
    const count = Number(exhibition.settings?.count) || works.length || 1;

    state = {
      id: exhibition.id,
      version: 2,
      shareToken: exhibition.share_token || shareToken,
      settings: {
        ...DEFAULTS,
        ...(exhibition.settings || {}),
        title: exhibition.title || '우리 반 기억 박물관',
        theme: exhibition.theme || 'museum',
        count
      },
      works: Array(count).fill(null)
    };

    for (const work of works) {
      if (Number.isInteger(work.slot) && work.slot >= 0 && work.slot < count) {
        let blob = null;

        if (work.image_url) {
          try {
            const imageResponse = await fetch(work.image_url);
            if (imageResponse.ok) {
              blob = await imageResponse.blob();
            }
          } catch {}
        }

        state.works[work.slot] = {
          id: work.id,
          slot: work.slot,
          name: work.name || '',
          title: work.title || '',
          description: work.description || '',
          imagePath: work.image_path || '',
          width: work.width || 700,
          height: work.height || 1000,
          blob
        };
      }
    }

    document.body.classList.add('share-mode');
    document.body.classList.add('inside-museum');

    $('welcome').hidden = true;
    $('exhibition').hidden = false;
    $('settingsBtn').hidden = true;

    ready = true;
    kioskPaused = true;

    render();

    MuseumWalk.setActive(true);
    updateLiveMonitor();

  } catch (error) {
    console.error(error);

    $('welcome').hidden = true;
    $('exhibition').hidden = false;
    $('galleryTitle').textContent = '전시관을 불러오지 못했어요.';
    $('galleryHint').textContent =
      error.message || '공유 링크를 확인해 주세요.';
  }
}

if (shareToken) {
  window.museumAuthReady.then(() => initSharedExhibition());
} else if (navigator.locks) {
  navigator.locks.request(
    'memory-museum-editor',
    { ifAvailable: true },
    async lock => {
      if (!lock) {
        $('setupForm').querySelector('[type=submit]').disabled = true;
        $('saveStatus').textContent =
          '다른 탭에서 전시관이 열려 있어요. 그 탭을 닫은 뒤 이 화면을 새로고침해 주세요.';
        return;
      }

      await window.museumAuthReady;
      await init();
      await new Promise(resolve => {
        releaseLock = resolve;
      });
    }
  );
} else {
  window.museumAuthReady.then(() => init());
}

window.addEventListener('pagehide', () => { stopCamera(); releaseLock?.(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelCapture++; gate.lock(performance.now()); } else updateLiveMonitor(); });
$('liveStartBtn').onclick = () => { lastCameraError = ''; kioskPaused = false; ensureKioskCamera(); };

// 감상 모드는 번호 순서대로 3초마다 전환합니다. 닫을 때 타이머를 정리합니다.
$('slideshowBtn').onclick = () => {
  if (!occupied() || busy) return;
  slideIndex = 0; slidePaused = false;
  openModal('작품 감상', '<img id="slideImage" class="view-image" alt=""><p id="slideCaption"></p><div class="row"><button id="slidePrev">이전</button><button id="slidePause">일시정지</button><button id="slideNext">다음</button><button id="slideEnd">종료</button></div>');
  const works = state.works.map((work, slot) => ({ work, slot })).filter(x => x.work);
  const draw = () => { const { work, slot } = works[slideIndex]; $('slideImage').src = imageURL(work); $('slideImage').alt = `전시물 ${number(slot)}`; $('slideCaption').textContent = `전시물 ${number(slot)}${work.title ? ' · ' + work.title : ''}${work.name ? ' · ' + work.name : ''}${work.description ? ' — ' + work.description : ''} (${slideIndex + 1} / ${works.length})`; };
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
$('shareBtn').onclick = () => {
  if (!state?.id || !state?.shareToken) {
    toast('먼저 전시관을 저장해 주세요.');
    return;
  }

  const shareUrl =
    `${location.origin}${location.pathname}?share=${encodeURIComponent(state.shareToken)}`;

  openModal(
    '전시관 공유',
    `<p>아래 링크를 다른 사람에게 보내면 이 전시관을 공유할 수 있어요.</p>
     <input id="shareUrlInput" type="text" readonly>
     <div class="row">
       <button id="copyShareUrl" class="primary">링크 복사</button>
       <button id="makeShareQR">공유용 QR 만들기</button>
     </div>
     <p class="small">공유용 QR을 스캔하면 전시관 링크로 이동합니다.</p>`
  );

  $('shareUrlInput').value = shareUrl;

  $('copyShareUrl').onclick = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast('전시관 공유 링크를 복사했어요.');
    } catch {
      $('shareUrlInput').select();
      document.execCommand('copy');
      toast('전시관 공유 링크를 복사했어요.');
    }
  };

  $('makeShareQR').onclick = () => {
    const canvas = MuseumQR.canvas(shareUrl);
    const qrImage = canvas.toDataURL('image/png');

    openModal(
      '공유용 QR',
      `<p>이 QR을 스캔하면 이 전시관으로 이동합니다.</p>
       <div class="qr-item">
         <img src="${qrImage}" alt="전시관 공유용 QR">
         <button id="saveShareQR" class="primary">QR 이미지 저장</button>
       </div>`
    );

    $('saveShareQR').onclick = async () => {
      try {
        const blob = await new Promise((resolve, reject) =>
          canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG')), 'image/png')
        );
        download(blob, '전시관-공유-QR.png');
      } catch {
        toast('QR 이미지를 저장하지 못했어요. 다시 시도해 주세요.');
      }
    };
  };
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


