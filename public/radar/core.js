(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.BeyspotCore = core;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FRESH_MS = 5 * 60 * 1000;
  const MAX_SHARE_MS = 6 * 60 * 60 * 1000;
  const clean = value => String(value ?? '').trim();
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const coordinate = (value, min, max) => value !== null && value !== undefined && clean(value) !== '' && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max;
  const validPoint = p => !!p && coordinate(p.lat, -90, 90) && coordinate(p.lng, -180, 180);
  function validShare(p, time = Date.now()) {
    if (!validPoint(p)) return false;
    const updated = Date.parse(p.updated_at), expires = Date.parse(p.expires_at);
    return Number.isFinite(updated) && Number.isFinite(expires) && expires > time && (p.kind === 'checkin' || updated > time - FRESH_MS) && updated <= time + 120000;
  }
  function coarse(lat, lng) {
    if (!validPoint({lat, lng})) throw Error('座標が不正です');
    // Longitude cells depend on the rounded latitude, never the original latitude.
    const step = 500 / 111320;
    const roundedLat = Math.max(-90, Math.min(90, Math.round(Number(lat) / step) * step));
    const lngStep = step / Math.max(0.01, Math.cos(roundedLat * Math.PI / 180));
    const roundedLng = Math.max(-180, Math.min(180, Math.round(Number(lng) / lngStep) * lngStep));
    return {lat: roundedLat, lng: roundedLng};
  }
  function directCoordinates(value) {
    const m = clean(value).match(/^(-?\d+(?:\.\d+)?)\s*[,、]\s*(-?\d+(?:\.\d+)?)$/);
    return m && validPoint({lat:m[1],lng:m[2]}) ? {lat:Number(m[1]),lng:Number(m[2])} : null;
  }
  function coordsFromMapUrl(value) {
    const direct = directCoordinates(value); if (direct) return direct;
    try {
      const url = new URL(value), host = url.hostname.toLowerCase();
      if (!['https:', 'http:'].includes(url.protocol) || !/(^|\.)(google\.com|google\.co\.jp|maps\.apple\.com|openstreetmap\.org)$/.test(host)) return null;
      const text = decodeURIComponent(value);
      let m = text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) || text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
      if (m && validPoint({lat:m[1],lng:m[2]})) return {lat:Number(m[1]),lng:Number(m[2])};
      for (const key of ['ll','sll','q','query']) { const p=directCoordinates(url.searchParams.get(key)); if(p)return p; }
      m = url.hash.match(/map=\d+\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);
      if (m && validPoint({lat:m[1],lng:m[2]})) return {lat:Number(m[1]),lng:Number(m[2])};
    } catch (_) {}
    return null;
  }
  function localDateTime(date, time) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
    const [y,m,d] = date.split('-').map(Number), [h,min] = time.split(':').map(Number);
    const value = new Date(y,m-1,d,h,min);
    return value.getFullYear() === y && value.getMonth() === m-1 && value.getDate() === d && value.getHours() === h && value.getMinutes() === min ? value : null;
  }
  function eventRecord(draft, userId, time = Date.now()) {
    const title=clean(draft.title), place=clean(draft.place), details=clean(draft.details);
    if (!userId) throw Error('ログインしてください');
    if (!title || !place) throw Error('タイトルと場所を入力してください');
    if (title.length>60 || place.length>100 || details.length>300) throw Error('入力できる文字数を超えています');
    if (!validPoint(draft)) throw Error('地図上の位置を指定してください');
    const starts=localDateTime(draft.date,draft.start), ends=localDateTime(draft.endDate || draft.date,draft.end);
    if (!starts || !ends || ends<=starts) throw Error('終了日時は開始日時より後に設定してください');
    if (+ends<=time) throw Error('終了日時が過去になっています');
    return {user_id:userId,title,place_name:place,details,lat:Number(draft.lat),lng:Number(draft.lng),starts_at:starts.toISOString(),ends_at:ends.toISOString()};
  }
  function validateConnection(url, key) {
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(clean(url))) throw Error('接続先URLを確認してください');
    key = clean(key);
    if (/^sb_publishable_[\w-]+$/.test(key)) return true;
    try {
      const part=key.split('.')[1], raw=part.replace(/-/g,'+').replace(/_/g,'/');
      const payload=JSON.parse(atob(raw.padEnd(Math.ceil(raw.length/4)*4,'=')));
      if (key.split('.').length===3 && payload.role==='anon') return true;
    } catch (_) {}
    throw Error('公開用のpublishable / anonキーを指定してください');
  }
  // In-flight writes finish before a stop/delete. Late GPS callbacks are discarded.
  function createShareQueue() {
    let generation=0, tail=Promise.resolve();
    return {
      begin() { return ++generation; },
      current(token) { return token===generation; },
      enqueue(token, write) {
        const task=tail.catch(()=>{}).then(()=>token===generation ? write() : false);
        tail=task.catch(()=>{}); return task;
      },
      async stop(remove) { ++generation; await tail; if(remove) await remove(); }
    };
  }
  return {FRESH_MS,MAX_SHARE_MS,clean,escapeHtml,coordinate,validPoint,validShare,coarse,directCoordinates,coordsFromMapUrl,localDateTime,eventRecord,validateConnection,createShareQueue};
});
