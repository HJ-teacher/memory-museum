/* 이미지가 입혀진 실제 크기의 벽·바닥을 원근 공간에 놓습니다.
   카메라 위치와 시선을 이동하므로 작품들이 함께 움직이며 깊이감이 생깁니다.
   모든 사진과 작품은 로컬 파일/브라우저 안에서만 사용합니다. */
window.MuseumWalk = (() => {
  const $ = id => document.getElementById(id);
  const BAY = 1000, WIDTH = 1300, HEIGHT = 667;
  let data, getURL, onOpen, active = false, pending = -1, selected = -1;
  let camera = { x: 0, z: 430, yaw: 0, pitch: -2 }, target = { ...camera };
  let clickTimer;
  let depth = 3000, tween, last = 0, tour = false, tourAt = 0, pointer, dragged = false;
  const keys = new Set(), reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pad = i => String(i + 1).padStart(2, '0');
  function surface(className, w, h, transform) {
    const el = document.createElement('div'); el.className = className;
    Object.assign(el.style, { width: w + 'px', height: h + 'px', left: -w / 2 + 'px', top: -h / 2 + 'px', transform }); return el;
  }
  function render(next, url, open) {
    clearTimeout(clickTimer); data = next; getURL = url; onOpen = open;
    depth = Math.max(2, Math.ceil(data.settings.count / 2)) * BAY;
    const world = $('museumWorld'); world.replaceChildren();
    world.append(surface('museum-floor', WIDTH, depth + 1300, `translate3d(0,${HEIGHT / 2}px,${-depth / 2 + 450}px) rotateX(90deg)`));
    world.append(surface('museum-ceiling', WIDTH, depth + 1300, `translate3d(0,${-HEIGHT / 2}px,${-depth / 2 + 450}px) rotateX(-90deg)`));
    const bays = Math.max(2, Math.ceil(data.settings.count / 2));
    for (let bay = 0; bay < bays; bay++) for (let side = 0; side < 2; side++) {
      const slot = bay * 2 + side, left = side === 0, work = data.works[slot];
      const el = surface('museum-bay', BAY, HEIGHT, `translate3d(${left ? -WIDTH / 2 : WIDTH / 2}px,0,${-(bay + .5) * BAY}px) rotateY(${left ? 90 : -90}deg)`);
      const wall = document.createElement('img'); wall.src = 'museum-wall-panel.png'; wall.alt = ''; wall.className = 'museum-wall-photo'; wall.draggable = false; el.append(wall);
      // 설정 수를 넘는 벽은 사진의 빈 벽 부분만 보여 주어 가짜 작품 칸을 만들지 않습니다.
      if (slot >= data.settings.count) { el.classList.add('unassigned-wall'); }
      if (slot < data.settings.count) {
        el.dataset.wallSlot = slot;
        const painting = document.createElement('button'); painting.className = 'wall-painting'; painting.dataset.painting = slot;
        painting.setAttribute('aria-label', work ? `전시물 ${pad(slot)} 크게 보기` : `전시물 ${pad(slot)} 빈 액자`);
        painting.tabIndex = 0;
        if (work) { const img = document.createElement('img'); img.src = getURL(work); img.alt = `전시물 ${pad(slot)}`; img.draggable = false; painting.append(img); }
        else { const blank = document.createElement('span'); blank.className = 'wall-empty'; blank.textContent = pad(slot); painting.append(blank); }
        if (pending === slot) painting.classList.add('awaiting-hang');

        painting.onclick = () => { if (dragged || pending >= 0) return; clearTimeout(clickTimer); clickTimer = setTimeout(() => { stopTour(); focus(slot, 650); }, 450); };
        painting.ondblclick = () => { clearTimeout(clickTimer); if (dragged || pending >= 0 || !work) return; stopTour(); onOpen(slot); };
        painting.onkeydown = e => { if (e.key === 'F2' && work && pending < 0) { e.preventDefault(); onOpen(slot); } };
        painting.title = '한 번 누르면 정면 감상 · 두 번 누르면 편집 (키보드 F2)';
        const label = document.createElement('div'); label.className = 'wall-caption'; label.textContent = work?.title || `전시물 ${pad(slot)}`; if (work?.name) { const name = document.createElement('span'); name.textContent = work.name; label.append(name); }
        if (data.settings.useDescription && work?.description) { const description = document.createElement('span'); description.className = 'wall-description'; description.textContent = work.description; label.append(description); }
        el.append(painting, label);
        const sizeFrame = (w,h) => { const scale = Math.min(520 / w, 380 / h); Object.assign(painting.style,{width:(w*scale+64)+'px',height:(h*scale+64)+'px'}); painting.dataset.orientation = h > w ? 'portrait' : 'landscape'; };
        sizeFrame(work?.width || 700,work?.height || 1000);
        if(work) { const image = painting.querySelector('img'); image.onload = () => sizeFrame(image.naturalWidth,image.naturalHeight); }
      }
      world.append(el);
    }
    // 입구 문과 첫 번째 벽 사이의 빈 구간도 같은 벽으로 채웁니다.
    for (const left of [true, false]) {
      const side = surface('museum-bay unassigned-wall entry-side', 800, HEIGHT, `translate3d(${left ? -WIDTH / 2 : WIDTH / 2}px,0,400px) rotateY(${left ? 90 : -90}deg)`);
      const photo = document.createElement('img'); photo.src = 'museum-wall-panel.png'; photo.alt = ''; photo.className = 'museum-wall-photo'; photo.draggable = false; side.append(photo); world.append(side);
    }
    for (const exit of [false,true]) {
      const end = surface(exit ? 'museum-door-wall exit-wall' : 'museum-door-wall entry-wall', WIDTH, HEIGHT, exit ? `translate3d(0,0,${-depth}px)` : 'translate3d(0,0,800px) rotateY(180deg)');
      const door = document.createElement('button'); door.className = 'museum-door'; door.setAttribute('aria-label', exit ? '출구 문 · 전시관 로비로 나가기' : '입구 문 · 전시관 로비로 나가기');
      const label = document.createElement('span'); label.textContent = exit ? '출구 · 로비로 나가기' : '입구 · 로비로 나가기'; door.append(label);
      door.onclick = () => { if (!dragged && pending < 0) window.dispatchEvent(new Event('museum-exit')); }; end.append(door); world.append(end);
    }
    target.z = clamp(target.z, -depth + 380, 500); camera.z = clamp(camera.z, -depth + 380, 500); if (selected >= data.settings.count) selected = -1;
    const jump = $('jumpToWall'); jump.replaceChildren(new Option('번호로 이동', ''));
    for (let i = 0; i < data.settings.count; i++) jump.add(new Option(`전시물 ${pad(i)}${data.works[i] ? ' · 등록됨' : ''}`, i));
    updatePosition(); draw();
  }
  function setActive(value) { active = value; $('walkGallery').hidden = !value; document.body.classList.toggle('walk-mode', value); document.body.classList.toggle('grid-mode', !value); $('galleryViewBtn').setAttribute('aria-pressed', value); $('gridViewBtn').setAttribute('aria-pressed', !value); if (!value) stopTour(); draw(); }
  function draw() {
    if (!active) return;
    const focal = Math.max(220, Math.min($('museumViewport').clientWidth * .68, $('museumViewport').clientHeight * 1.05, 920));
    $('museumViewport').style.perspective = focal + 'px';
    $('museumWorld').style.transform = `translateZ(${focal}px) rotateX(${camera.pitch}deg) rotateY(${camera.yaw}deg) translate3d(${-camera.x}px,0,${-camera.z}px)`;
  }
  function updatePosition() { $('roomPosition').textContent = selected < 0 ? '전시관 입구' : `전시물 ${pad(selected)} / ${data.settings.count} · ${selected % 2 ? '오른쪽 벽' : '왼쪽 벽'}`; $('jumpToWall').value = selected < 0 ? '' : String(selected); }
  function stopTween() { if (tween) { tween.resolve(); tween = null; } }
  function move(to, duration = 1600) {
    stopTween(); target = { ...to };
    if (reduced()) { camera = { ...target }; draw(); return Promise.resolve(); }
    return new Promise(resolve => { tween = { from: { ...camera }, to: { ...to }, started: performance.now(), duration, resolve }; });
  }
  async function focus(slot, duration = 1600) {
    if (!data || slot < 0 || slot >= data.settings.count) return;
    selected = slot; updatePosition();
    const side = slot % 2 ? 1 : -1, bay = Math.floor(slot / 2);
    await move({ x: -side * 180, z: -(bay + .5) * BAY, yaw: side * 90, pitch: 0 }, duration);
  }
  function stopTour() { tour = false; $('tourBtn').textContent = '천천히 둘러보기'; $('tourBtn').setAttribute('aria-pressed', 'false'); }
  function stop() { clearTimeout(clickTimer); stopTour(); stopTween(); pointer = null; keys.clear(); }
  async function navigate(step) {
    if (pending >= 0 || !data) return;
    stopTour(); const slot = selected < 0 ? (step > 0 ? 0 : data.settings.count - 1) : (selected + step + data.settings.count) % data.settings.count; await focus(slot);
  }
  function entrance() { if (pending >= 0) return; stopTour(); selected = -1; updatePosition(); return move({ x: 0, z: 430, yaw: 0, pitch: -2 }); }
  function prepareArrival(slot) { pending = slot; stopTour(); setActive(true); }
  async function reveal(slot, work) {
    const overlay = $('arrival'), image = overlay.querySelector('img'); image.src = getURL(work); overlay.querySelector('strong').textContent = `전시물 ${pad(slot)}`; overlay.hidden = false; overlay.classList.remove('hanging');
    await image.decode().catch(() => {});
    // 이미지가 로드된 시점부터 5초 동안 크게 보여 줍니다.
    const shown = performance.now(); overlay.dataset.shownAt = shown;
    overlay.querySelector('.reveal-progress').animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 5000, fill: 'forwards' });
    await Promise.all([sleep(5000), (async () => { await sleep(3300); await focus(slot, 1600); })()]);
    const destination = document.querySelector(`[data-painting="${slot}"]`), end = destination?.getBoundingClientRect(), start = image.getBoundingClientRect();
    overlay.classList.add('hanging');
    if (end && !reduced()) {
      // 큰 작품의 현재 위치에서 벽 속 실제 이미지 위치로 이동합니다.
      const dx = end.x + end.width / 2 - start.x - start.width / 2, dy = end.y + end.height / 2 - start.y - start.height / 2;
      try { await image.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(${Math.min(end.width / start.width, end.height / start.height)})`, opacity: 1 }], { duration: 1250, easing: 'cubic-bezier(.25,.7,.25,1)', fill: 'forwards' }).finished; } catch {}
    } else await sleep(250);
    destination?.classList.remove('awaiting-hang'); destination?.classList.add('just-hung');
    overlay.dataset.finishedAt = performance.now(); overlay.hidden = true; image.getAnimations().forEach(a => a.cancel()); pending = -1;
    setTimeout(() => destination?.classList.remove('just-hung'), 1500);
  }
  function interactive() { return active && !document.hidden && !$('modal').open && !$('cropDialog').open && !$('cameraPanel').matches(':not([hidden])') && pending < 0; }
  function tick(now) {
    const dt = Math.min(.04, (now - (last || now)) / 1000); last = now;
    if (active && !document.hidden) {
      if (tween) { const t = clamp((now - tween.started) / tween.duration, 0, 1), ease = t * t * (3 - 2 * t); for (const k of ['x', 'z', 'yaw', 'pitch']) camera[k] = tween.from[k] + (tween.to[k] - tween.from[k]) * ease; if (t >= 1) { const done = tween.resolve; tween = null; done(); } }
      else if (interactive()) {
        if (keys.size) {
          stopTour(); const yaw = camera.yaw * Math.PI / 180, step = 340 * dt;
          if (keys.has('forward')) { target.x += Math.sin(yaw) * step; target.z -= Math.cos(yaw) * step; }
          if (keys.has('back')) { target.x -= Math.sin(yaw) * step; target.z += Math.cos(yaw) * step; }
          if (keys.has('left')) target.yaw -= 65 * dt;
          if (keys.has('right')) target.yaw += 65 * dt;
          target.x = clamp(target.x, -420, 420); target.z = clamp(target.z, -depth + 380, 500); target.yaw = clamp(target.yaw, -170, 170);
        }
        const smooth = reduced() ? 1 : 1 - Math.exp(-dt * 10); for (const k of ['x', 'z', 'yaw', 'pitch']) camera[k] += (target[k] - camera[k]) * smooth;
      }
      if (tour && interactive() && !tween && now >= tourAt) { const slots = data.works.map((w, i) => w ? i : -1).filter(i => i >= 0); if (!slots.length) slots.push(...data.works.map((_, i) => i)); const index = slots.indexOf(selected); focus(slots[(index + 1) % slots.length], 2200); tourAt = now + 8200; }
      draw();
    }
    requestAnimationFrame(tick);
  }
  const mapping = { ArrowUp: 'forward', w: 'forward', W: 'forward', ArrowDown: 'back', s: 'back', S: 'back', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right' };
  document.addEventListener('keydown', e => { if (!interactive() || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || !mapping[e.key]) return; e.preventDefault(); stopTween(); keys.add(mapping[e.key]); });
  document.addEventListener('keyup', e => { if (mapping[e.key]) keys.delete(mapping[e.key]); });
  window.addEventListener('blur', () => keys.clear()); document.addEventListener('visibilitychange', () => { keys.clear(); tourAt = performance.now() + 3000; });
  $('museumViewport').addEventListener('pointerdown', e => { if (!interactive()) return; dragged = false; pointer = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, yaw: target.yaw, pitch: target.pitch }; });
  window.addEventListener('pointermove', e => { if (!pointer || !interactive()) return; const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y; if (Math.abs(dx) + Math.abs(dy) > 5) { dragged = true; stopTour(); stopTween(); } target.yaw = clamp(pointer.yaw - dx * .13, -170, 170); target.pitch = clamp(pointer.pitch + dy * .09, -22, 22); });
  window.addEventListener('pointerup', () => { pointer = null; setTimeout(() => { dragged = false; }, 0); keys.clear(); });
  window.addEventListener('pointercancel', () => { pointer = null; keys.clear(); });
  for (const button of document.querySelectorAll('[data-walk]')) { button.addEventListener('pointerdown', e => { if (!interactive()) return; e.preventDefault(); stopTween(); keys.add(button.dataset.walk); button.setPointerCapture(e.pointerId); }); button.addEventListener('pointerup', () => keys.clear()); button.addEventListener('lostpointercapture', () => keys.clear()); }
  $('previousWall').onclick = () => navigate(-1); $('nextWall').onclick = () => navigate(1); $('entranceBtn').onclick = entrance;
  $('lastWallBtn').onclick = () => { if (pending >= 0 || !data) return; stopTour(); focus(data.settings.count - 1, 650); };
  $('jumpToWall').onchange = () => { if (pending >= 0 || !data || $('jumpToWall').value === '') return; const slot = Number($('jumpToWall').value); stopTour(); focus(slot, 650); };
  $('tourBtn').onclick = () => { if (pending >= 0) return; if (tour) return stopTour(); tour = true; tourAt = 0; $('tourBtn').textContent = '산책 멈추기'; $('tourBtn').setAttribute('aria-pressed', 'true'); };
  window.addEventListener('resize', draw); requestAnimationFrame(tick);
  return { render, setActive, prepareArrival, reveal, focus, stop, entrance, getState: () => ({ active, selected, pending, camera: { ...camera }, tour }) };
})();

