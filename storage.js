/* 하나의 트랜잭션으로 설정과 작품을 함께 저장합니다.
   저장 실패 시 화면의 기존 데이터를 유지하도록 호출 측에서 먼저 await 합니다. */
window.MuseumStore = (() => {
  let db;
  async function open() {
    if (db) return db;
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('memory-museum-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('exhibitions');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('blocked'));
    });
    db.onversionchange = () => { db.close(); db = null; };
    return db;
  }
  async function read() {
    const database = await open();
    return new Promise((resolve, reject) => {
      const r = database.transaction('exhibitions').objectStore('exhibitions').get('current');
      r.onsuccess = () => resolve(r.result || null); r.onerror = () => reject(r.error);
    });
  }
  async function write(value) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('exhibitions', 'readwrite');
      const records = tx.objectStore('exhibitions');
      value.id ||= crypto.randomUUID();
      records.put(value, 'current');
      records.put(value, 'room:' + value.id);
      const index = records.get('rooms');
      index.onsuccess = () => {
        const rooms = index.result || [];
        const info = { id: value.id, title: value.settings.title, theme: value.settings.theme, count: value.settings.count, occupied: value.works.filter(Boolean).length };
        const at = rooms.findIndex(r => r.id === value.id);
        if (at < 0) rooms.push(info); else rooms[at] = info;
        records.put(rooms, 'rooms');
      };
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  }
  async function list() {
    const current = await read();
    if (current && !current.id) await write(current);
    const database = await open();
    return new Promise((resolve, reject) => {
      const r = database.transaction('exhibitions').objectStore('exhibitions').get('rooms');
      r.onsuccess = () => resolve(r.result || []); r.onerror = () => reject(r.error);
    });
  }
  async function room(id) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const r = database.transaction('exhibitions').objectStore('exhibitions').get('room:' + id);
      r.onsuccess = () => resolve(r.result || null); r.onerror = () => reject(r.error);
    });
  }
  // 전시관 하나만 지웁니다. 지운 전시관이 마지막으로 연 전시관이면 ‘current’도 함께 비웁니다.
  async function remove(id) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('exhibitions', 'readwrite');
      const records = tx.objectStore('exhibitions');
      records.delete('room:' + id);
      const index = records.get('rooms');
      index.onsuccess = () => records.put((index.result || []).filter(r => r.id !== id), 'rooms');
      const current = records.get('current');
      current.onsuccess = () => { if (current.result?.id === id) records.delete('current'); };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  }
  return { read, write, list, room, remove };
})();
