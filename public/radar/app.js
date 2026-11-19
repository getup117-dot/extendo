'use strict';
(() => {
  const C = window.BeyspotCore, $ = id => document.getElementById(id);
  const esc = C.escapeHtml, clean = C.clean;
  const config = window.BEYSPOT_CONFIG || {}, TOKYO = [35.6895, 139.6917];
  const DEMO_KEY = 'beybe-radar-demo-v1', CONFIG_KEY = 'beyspot-connection-1';
  const SPOTS_KEY = 'beybe-radar-saved-places-v1';
  const STADIUM_OPTIONS = {
    unset: '未設定',
    owned: '持っている',
    not_owned: '持っていない',
    store: '店舗のものを使う'
  };
  const EVENT_STADIUM={unset:'未設定',bring:'主催者が持参',store:'店舗のものを使う',wanted:'持参できる人を募集'};
  const RANK_OPTIONS = {
    unset: '未設定',
    beginner: 'ビギナー',
    bronze: 'ブロンズ',
    silver: 'シルバー',
    gold: 'ゴールド',
    master: 'マスター'
  };
  const cache = {};
  const storage = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? cache[key] ?? fallback; } catch (_) { return cache[key] ?? fallback; } },
    set(key, value) { cache[key] = value; try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} }
  };
  const dateYMD = d => [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
  const fmtDate = d => new Intl.DateTimeFormat('ja-JP', {month:'numeric',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(d));
  const timeText = d => new Date(d).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
  const iso = () => new Date().toISOString();
  const uid = () => window.crypto?.randomUUID?.() || 'demo-'+Math.random().toString(36).slice(2);
  const initial = name => Array.from(clean(name) || '?')[0];
  const ago = d => { const minutes = Math.max(0, Math.floor((Date.now()-Date.parse(d))/60000)); return minutes < 1 ? 'たった今' : minutes+'分前'; };
  function at(day, hour) { const d=new Date(); d.setDate(d.getDate()+day); d.setHours(hour,0,0,0); return d.toISOString(); }
  function seedDemo() {
    return {
      profiles: [
        {id:'sample1',display_name:'カイ',battle_ready:true,stadium_status:'owned',rank_level:'silver'},
        {id:'sample2',display_name:'コマ好き',stadium_status:'not_owned',rank_level:'beginner'},
        {id:'sample3',display_name:'Xブレーダー',stadium_status:'store',rank_level:'gold'},
        {id:'demo-me',display_name:'あなた',stadium_status:'unset',rank_level:'unset'}
      ],
      positions: [
        {user_id:'sample1',lat:35.6998,lng:139.7709,precision:'approx'},
        {user_id:'sample2',lat:35.697,lng:139.7021,precision:'approx'},
        {user_id:'sample3',lat:35.662,lng:139.6654,precision:'approx'}
      ].map(p=>({...p,updated_at:iso(),expires_at:new Date(Date.now()+3600000).toISOString()})),
      events: [
        {id:'sample-event-today-'+dateYMD(new Date()),user_id:'sample2',title:'初心者歓迎のフリーバトル',place_name:'新宿駅東口周辺（架空の会場）',lat:35.6914,lng:139.7018,starts_at:at(0,18),ends_at:at(0,24),stadium_plan:'store',details:'初対戦の方も気軽にどうぞ。※試用版の架空の予定です。'},
        {id:'sample-event-1',user_id:'sample1',title:'秋葉原でフリーバトル',place_name:'秋葉原駅周辺',lat:35.6984,lng:139.7731,starts_at:at(1,18),ends_at:at(1,20),details:'初心者歓迎！ 気軽に対戦しましょう。※試用版の架空の予定です。'},
        {id:'sample-event-2',user_id:'sample3',title:'週末ベイ交流会',place_name:'新宿駅周辺',lat:35.6903,lng:139.7005,starts_at:at(3,14),ends_at:at(3,17),details:'対戦相手募集中。※試用版の架空の予定です。'}
      ], rsvps: []
    };
  }
  function readDemo() {
    const saved=storage.get(DEMO_KEY,null);
    if (!saved || !['profiles','positions','events','rsvps'].every(k=>Array.isArray(saved[k]))) return seedDemo();
    const fresh=seedDemo();
    for (const profile of fresh.profiles) {
      const index = saved.profiles.findIndex(existing => existing.id === profile.id);
      if (index < 0) saved.profiles.push(profile);
      else saved.profiles[index] = { ...profile, ...saved.profiles[index] };
    }
    saved.positions=saved.positions.filter(p=>p.user_id==='demo-me').concat(fresh.positions);
    const alive=saved.events.filter(e=>!e.id.startsWith('sample-event-') || Date.parse(e.ends_at)>Date.now());
    for(const sample of fresh.events){
      const family=sample.id+'-';
      if(alive.some(e=>e.id===sample.id || e.id.startsWith(family)))continue;
      // Legacy samples keep their IDs and dates. A replacement is a new meeting.
      if(!sample.id.includes('today') && saved.events.length)
        sample.id=family+dateYMD(new Date(sample.starts_at));
      alive.push(sample);
    }
    saved.events=alive;
    const ids=new Set(alive.map(e=>e.id));
    saved.rsvps=saved.rsvps.filter(r=>ids.has(r.event_id));
    return saved;
  }
  let demo=readDemo(), savedConnection=storage.get(CONFIG_KEY,null);
  const state = {
    mode:'demo', tab:'now', filter:'all', listQueries:{now:'',plans:''}, sb:null, user:null, authSub:null,
    profiles:[], positions:[], events:[], rsvps:[], map:null, mapReady:false, markers:[],
    pickMode:null, draft:null, chosen:null, share:null, geowatch:null, expiry:null,
    stopFailed:false, loading:false, error:'', status:'', connected:false, refreshTimer:null,
    request:0, revision:0, lastHits:[], searchAt:0, searchCache:{}, searchRequest:0,
    renderKey:'', sheetCollapsed:false, previousFocus:null, confirmResolve:null,
    lastPosition:0, lastPush:0, freshRequest:false, selected:null, selectedMarker:null,
    mapSearchRequest:0, mapHits:[], tileLoaded:0, tileErrors:0, selectedEventId:null
  };
  const shares=C.createShareQueue();
  const selfId=()=>state.mode==='demo'?'demo-me':state.user?.id;
  const logged=()=>state.mode==='demo'||!!state.user;
  const nameFor=id=>state.profiles.find(p=>p.id===id)?.display_name||'ブレーダー';
  const selfName=()=>nameFor(selfId());
  function profileBadges(userId) {
    const profile = state.profiles.find(person => person.id === userId) || {};
    const stadium = STADIUM_OPTIONS[profile.stadium_status] || STADIUM_OPTIONS.unset;
    const rank = RANK_OPTIONS[profile.rank_level] || RANK_OPTIONS.unset;
    return `<div class="profile-badges">${profile.battle_ready?'<span class="profile-badge ready-badge">対戦歓迎</span>':''}<span class="profile-badge stadium-badge">スタジアム · ${esc(stadium)}</span><span class="profile-badge rank-badge">ランク（仮） · ${esc(rank)}</span></div>`;
  }
  function profileOptions(options, selectedValue) {
    return Object.entries(options).map(([value, label]) =>
      `<option value="${value}"${value === selectedValue ? ' selected' : ''}>${esc(label)}</option>`
    ).join('');
  }
  function participantInfo(event) {
    const participants = attendees(event);
    if (participants.length < 2) return '';
    return `<details class="participant-details" data-event-participants="${esc(event.id)}"><summary>参加者の情報を見る（${participants.length}人）</summary><div class="participant-list">${participants.map(userId => `<div class="participant"><strong>${esc(nameFor(userId))}${userId === event.user_id ? '（主催）' : ''}</strong>${profileBadges(userId)}</div>`).join('')}</div></details>`;
  }
  const isMobile=()=>window.matchMedia('(max-width:800px)').matches;
  const savedSpots=()=>{const places=storage.get(SPOTS_KEY+':'+selfId(),[]);return Array.isArray(places)?places.filter(C.validPoint):[];};
  const placeKey=p=>Number(p.lat).toFixed(5)+','+Number(p.lng).toFixed(5);
  const activePeople=()=>logged()?state.positions.filter(p=>C.validShare(p)):[];
  const activeEvents=()=>logged()?state.events.filter(e=>Date.parse(e.ends_at)>Date.now()).sort((a,b)=>a.starts_at.localeCompare(b.starts_at)):[];
  const attendees=event=>[...new Set([event.user_id,...state.rsvps.filter(r=>r.event_id===event.id).map(r=>r.user_id)])];
  function notify(message) {
    $('toast').textContent=message; $('toast').classList.add('show');
    clearTimeout(state.toastTimer); state.toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4200);
  }
  function sourceDemo() {
    state.profiles=demo.profiles.slice(); state.positions=demo.positions.slice();
    state.events=demo.events.slice(); state.rsvps=demo.rsvps.slice();
  }
  let demoLockDb;
  function lockDatabase(){
    if(!demoLockDb)demoLockDb=new Promise((resolve,reject)=>{
      const request=indexedDB.open('beybe-radar-write-lock',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('writes');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
    return demoLockDb;
  }
  async function updateDemo(change){
    function write(){
      const latest=readDemo();
      change(latest);
      storage.set(DEMO_KEY,latest);
      demo=latest;
      sourceDemo();
    }
    if(navigator.locks?.request)await navigator.locks.request(DEMO_KEY,write);
    else if(window.indexedDB){
      const db=await lockDatabase();
      await new Promise((resolve,reject)=>{
        const tx=db.transaction('writes','readwrite');
        tx.objectStore('writes').get(DEMO_KEY).onsuccess=()=>{
          try{write();}catch(error){tx.abort();reject(error);}
        };
        tx.oncomplete=resolve;
        tx.onabort=()=>reject(tx.error||Error('保存を完了できませんでした'));
      });
    }else write();
    render();
  }
  function setStatus(message='', bad=false) {
    state.error=bad?message:''; state.status=bad?'':message;
    const el=$('connectionStatus'); el.textContent=message;
    el.classList.toggle('bad',bad); el.hidden=!message;
  }
  function initMap() {
    if (!window.L) { $('mapFallback').classList.add('show'); return; }
    state.map=L.map('map',{zoomControl:false}).setView(TOKYO,12);
    const tiles=L.tileLayer(config.tileUrl||'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:config.tileAttribution||'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',maxZoom:19
    }).addTo(state.map);
    tiles.on('tileload',()=>{state.tileLoaded++;$('mapLoadStatus').hidden=true;});
    tiles.on('tileerror',()=>{if(++state.tileErrors>=4&&!state.tileLoaded){$('mapLoadStatus').textContent='地図を読み込めません。インターネット接続を確認してください。';$('mapLoadStatus').hidden=false;}});
    L.control.zoom({position:'topright'}).addTo(state.map);
    // スマホで指が少しずれてもタップとして扱う（地図のドラッグ扱いでピンが刺さらないのを防ぐ）
    {const box=state.map.getContainer();let tap=null,lastTap=0;
      box.addEventListener('pointerdown',e=>{if(tap&&e.pointerId!==tap.id){tap.multi=true;return;}tap={id:e.pointerId,x:e.clientX,y:e.clientY,t:Date.now(),multi:!e.isPrimary};});
      box.addEventListener('pointercancel',()=>{tap=null;});
      box.addEventListener('pointerup',e=>{const s=tap;if(!s||e.pointerId!==s.id)return;tap=null;
        if(s.multi||Math.hypot(e.clientX-s.x,e.clientY-s.y)>14||Date.now()-s.t>700)return;
        if(e.target.closest('.leaflet-marker-icon,.leaflet-control,.leaflet-popup'))return;
        lastTap=Date.now();const ll=state.map.mouseEventToLatLng(e);chooseMapPoint({lat:ll.lat,lng:ll.lng},false);});
      state.map.on('click',e=>{if(Date.now()-lastTap<800)return;chooseMapPoint({lat:e.latlng.lat,lng:e.latlng.lng},false);});}
    state.mapReady=true;
  }
  function chooseMapPoint(place, move) {
    const forEvent=state.pickMode==='event';
    endPick();
    if (!forEvent) {selectPlace(place,move);return;}
    state.draft={...state.draft,lat:place.lat,lng:place.lng,place:venueName(state.draft.place,place.name),autoPlace:place.name||''};
    $('mapSearchResults').hidden=true;
    $('mapSearch').blur();
    restoreEvent();
  }
  function markerOptions(kind, label, mine=false,ready=false) {
    const event=kind==='event';
    const icon=L.divIcon({
      className:'radar-hit',
      html:`<span aria-hidden="true" class="${event?'battle-pin':'radar-blip'}${mine?' is-mine':''}${ready?' is-ready':''}"></span>`,
      iconSize:[44,44],iconAnchor:event?[22,40]:[22,22],popupAnchor:[0,-17]
    });
    return {icon,title:label,alt:label};
  }
  function labelMarker(marker,label) {
    marker.getElement()?.setAttribute('aria-label',label);
  }
  function renderMap() {
    const people=activePeople(), events=activeEvents();
    $('mapPeople').textContent=`いまいる ${people.length}人`;
    $('mapPlans').textContent=`出没予定 ${events.length}件`;
    if(state.sheetCollapsed)updateSheetLabel();
    if(state.selectedEventId)renderMapEvent(events.find(event=>event.id===state.selectedEventId));
    if (!state.mapReady) return;
    const data=JSON.stringify([people,events,state.profiles,selfId()]);
    if (data===state.markerKey) return; state.markerKey=data;
    state.markers.forEach(m=>m.remove()); state.markers=[];
    people.forEach(p=>{
      if(!C.validPoint(p))return;
      const ready=!!state.profiles.find(profile=>profile.id===p.user_id)?.battle_ready;
      const label='現在地：'+nameFor(p.user_id)+(ready?'（対戦歓迎）':'');
      const m=L.marker([p.lat,p.lng],markerOptions('person',label,p.user_id===selfId(),ready)).addTo(state.map)
        .bindPopup(`<div class="popup-title">${esc(nameFor(p.user_id))}${p.user_id===selfId()?'（あなた）':''}</div>${profileBadges(p.user_id)}<div>${p.precision==='approx'?'約500mの概略位置':'詳細位置'}を共有中</div><div class="popup-muted">${esc(ago(p.updated_at))}更新</div>`);
      labelMarker(m,label);
      m.on('click',()=>{
        closePlace();
        if(state.pickMode){m.closePopup();chooseMapPoint(p,false);}
        else if(isMobile())setSheet(true);
      });
      state.markers.push(m);
    });
    events.forEach(ev=>{
      if(!C.validPoint(ev))return;
      const label='出没予定：'+ev.title;
      const m=L.marker([ev.lat,ev.lng],markerOptions('event',label)).addTo(state.map);
      labelMarker(m,label);
      m.on('click',()=>{
        if(state.pickMode)chooseMapPoint({lat:ev.lat,lng:ev.lng,name:ev.place_name},false);
        else openMapEvent(ev);
      });
      state.markers.push(m);
    });
  }
  function preserveFields() {
    const panel=$('panelContent'), key=state.mode+':'+(selfId()||'')+':'+state.tab+':'+(state.profiles.some(p=>p.id===selfId())?'p':'-');
    if (state.renderKey!==key) { state.renderKey=key; panel.scrollTop=0; return null; }
    const fields=[...panel.querySelectorAll('input,select,textarea')].map(el=>({id:el.id,value:el.value}));
    const active=panel.contains(document.activeElement)?document.activeElement:null;
    const expandedParticipants = [...panel.querySelectorAll('[data-event-participants][open]')].map(detail => detail.dataset.eventParticipants);
    return {fields,active:active?.id,start:active?.selectionStart,end:active?.selectionEnd,scroll:panel.scrollTop,expandedParticipants};
  }
  function restoreFields(saved) {
    if(!saved)return;
    saved.fields.forEach(({id,value})=>{if($(id))$(id).value=value;});
    $('panelContent').querySelectorAll('[data-event-participants]').forEach(detail => {
      detail.open = saved.expandedParticipants.includes(detail.dataset.eventParticipants);
    });
    $('panelContent').scrollTop=saved.scroll;
    const el=$(saved.active); if(el){el.focus({preventScroll:true});try{el.setSelectionRange(saved.start,saved.end);}catch(_){}}
  }
  function render() {
    if(state.mode==='demo')sourceDemo();
    const saved=preserveFields();
    $('modeBadge').textContent=state.mode==='demo'?'試用版':'ライブ';
    $('modeBadge').classList.toggle('live',state.mode==='live');
    $('mapTypeBadge').textContent=state.mode==='demo'?'架空のサンプルデータ':logged()?'登録ユーザーの情報':'ログインしてください';
    document.querySelectorAll('button[data-tab]').forEach(el=>{el.classList.toggle('active',el.dataset.tab===state.tab);el.setAttribute('aria-current',el.dataset.tab===state.tab?'page':'false');});
    $('panelTitle').textContent=state.tab==='now'?'いま、誰がいる？':state.tab==='plans'?'いつ、どこに集まる？':'マイページ';
    $('panelDesc').textContent=state.tab==='now'?'近くのブレーダーを見つけよう。':state.tab==='plans'?'対戦の予定を立てて、集まろう。':'プロフィールと現在地共有の設定';
    $('filterBar').hidden=state.tab==='account'||!logged();
    $('planFilters').hidden=state.tab!=='plans';
    const query=state.listQueries[state.tab]||'';
    if($('listSearch').value!==query)$('listSearch').value=query;
    const listLabel=state.tab==='now'?'ブレーダー名で検索':'場所・名前・予定を検索';
    $('listSearch').placeholder=listLabel;
    $('listSearch').setAttribute('aria-label',listLabel);
    document.querySelectorAll('[data-filter]').forEach(el=>{el.classList.toggle('active',el.dataset.filter===state.filter);el.setAttribute('aria-pressed',String(el.dataset.filter===state.filter));});
    $('panelContent').innerHTML=!logged()?loginWall():state.tab==='now'?renderNow():state.tab==='plans'?renderPlans():renderAccount();
    document.body.dataset.tab=state.tab;
    restoreFields(saved); renderMap(); updateShareIndicator();
  }
  const REPORT_HIDE_AT = 3;
  const isAdmin = () => state.mode === 'live' && !!state.profiles.find(p => p.id === selfId())?.is_admin;
  const reportCount = (type, id) => new Set((state.reports||[]).filter(r => r.target_type === type && r.target_id === String(id)).map(r => r.reporter)).size;
  const reportedByMe = (type, id) => (state.reports||[]).some(r => r.target_type === type && r.target_id === String(id) && r.reporter === selfId()) || !!(state.localReports||{})[type + ':' + id];
  function reportTools(type, id, ownerId) {
    if (ownerId === selfId()) return '';
    const mine = reportedByMe(type, id)
      ? '<span class="report-done">通報済み</span>'
      : `<button class="tiny-btn report-btn" data-action="report" data-type="${type}" data-id="${esc(id)}">通報</button>`;
    if (!isAdmin()) return mine;
    const n = reportCount(type, id);
    return `${n ? `<span class="report-badge">⚠ 通報${n}件${n >= REPORT_HIDE_AT ? '・非表示中' : ''}</span>` : ''}${mine}<button class="tiny-btn report-btn" data-action="admin-delete-${type}" data-id="${esc(id)}">管理者として消す</button>`;
  }
  function renderNow() {
    const people = activePeople().filter(person => nameFor(person.user_id).toLowerCase().includes(state.listQueries.now.toLowerCase()));
    const sample = state.mode === 'demo' ? '<div class="notice demo-notice">試用版です。表示中の人・予定は架空で、操作はこのブラウザにだけ保存されます。</div>' : '';
    const cards = people.map(person => `
      <div class="card person-card">
        <div class="person-top">
          <span class="avatar">${esc(initial(nameFor(person.user_id)))}</span>
          <div class="person-name">
            <strong>${esc(nameFor(person.user_id))}${person.user_id === selfId() ? '（あなた）' : ''}</strong>
            <div class="person-sub">${esc(ago(person.updated_at))}更新・${person.precision === 'approx' ? '約500m表示' : '詳細表示'}</div>
          </div>
          <span class="pill">共有中</span>
        </div>
        ${profileBadges(person.user_id)}
        <div class="card-buttons"><button class="tiny-btn" data-action="go-person" data-id="${esc(person.user_id)}">地図で見る</button>${reportTools('user', person.user_id, person.user_id)}</div>
      </div>`).join('');
    const empty = `<div class="empty">${state.listQueries.now ? '該当するブレーダーはいません。' : '現在地を共有している人はまだいません。'}</div>`;
    return `${sample}
      <div class="statstrip"><div class="stat"><b>${activePeople().length}</b><span>現在地を共有中</span></div><div class="stat"><b>${activeEvents().length}</b><span>これからの出没予定</span></div></div>
      <button class="btn teal wide" data-action="go-account">${state.share ? '現在地の共有状況を見る' : '自分の現在地を共有する'}</button>
      <div class="section-title">いまいるブレーダー <span class="count">${people.length}</span></div>
      ${cards || empty}
      <p class="help">位置共有は任意です。更新が5分以上止まると、地図から自動で消えます。</p>`;
  }

  function filteredEvents() {
    const q=state.listQueries.plans.toLowerCase(), today=dateYMD(new Date());
    return activeEvents().filter(ev=>{
      if(state.filter==='mine'&&ev.user_id!==selfId())return false;
      if(state.filter==='joined'&&!attendees(ev).includes(selfId()))return false;
      if(state.filter==='today'&&!(dateYMD(new Date(ev.starts_at))<=today&&dateYMD(new Date(ev.ends_at))>=today))return false;
      return [ev.title,ev.place_name,ev.details,nameFor(ev.user_id)].join(' ').toLowerCase().includes(q);
    });
  }
  function renderPlans() {
    const events = filteredEvents();
    const cards = events.map(event => {
      const mine = event.user_id === selfId();
      const joined = state.rsvps.some(rsvp => rsvp.event_id === event.id && rsvp.user_id === selfId());
      const status = Date.parse(event.starts_at) <= Date.now() ? '開催中' : mine ? '自分の予定' : '出没予定';
      const actions = mine
        ? `<button class="tiny-btn" data-action="edit-event" data-id="${esc(event.id)}">編集</button><button class="tiny-btn" data-action="delete-event" data-id="${esc(event.id)}">削除</button>`
        : `<button class="tiny-btn ${joined ? 'joined' : ''}" data-action="rsvp" data-id="${esc(event.id)}">${joined ? '✓ 参加予定' : '参加する'}</button>`;
      return `<article class="card event-card">
        <div class="event-top">
          <div class="event-copy">
            <div class="card-headline">${esc(event.title)}</div>
            <div class="card-detail">${esc(eventTimeRange(event))}</div>
            <div class="card-detail">⌖ ${esc(event.place_name)}</div>
          </div>
          <span class="pill plan">${status}</span>
        </div>
        <p class="event-stadium">${esc(stadiumText(event))}</p>
        ${event.details ? `<p class="card-note">${esc(event.details)}</p>` : ''}
        <div class="host-profile"><p class="event-owner">主催：${esc(nameFor(event.user_id))}</p>${profileBadges(event.user_id)}</div>
        <div class="event-foot">
          <div class="event-owner">参加予定 ${attendees(event).length}人（主催者含む）</div>
          <div class="event-actions"><button class="tiny-btn" data-action="go-event" data-id="${esc(event.id)}">地図</button>${actions}${reportTools('event', event.id, event.user_id)}</div>
        </div>
        ${participantInfo(event)}
      </article>`;
    }).join('');
    const empty = '<div class="empty">該当する予定はありません。<br>「＋ 出没予定を登録」から作ってみましょう。</div>';
    return `<div class="section-title">これからの出没予定 <span class="count">${events.length}</span></div>${cards || empty}<p class="help">施設の利用ルールや周囲への配慮を守って集まりましょう。</p>`;
  }
  function loginWall() {
    return `<div class="setting-card form-col"><h2 class="login-heading">ニックネームではじめる</h2><p class="hint">メール登録は不要です。ニックネームを入れると、共有中の現在地や出没予定を見たり登録したりできます。</p><form id="startForm" class="form-col"><div class="field"><label for="startName">ニックネーム</label><input type="text" id="startName" required maxlength="32" placeholder="例：しょうた" autocomplete="nickname"></div><label class="agree"><input type="checkbox" id="startAgree" required> 18歳以上で、公園など公共の場所で会うことに同意します</label><button class="btn teal wide" type="submit">はじめる</button></form><p class="help">この端末のブラウザに記録されます。ブラウザのデータを消したり、別の端末で開いたりすると、新しい人として始まります。ニックネームはあとからマイページで変えられます。</p></div>`;
  }
  function renderAccount() {
    const mine=activePeople().find(p=>p.user_id===selfId()), sharing=!!state.share||!!mine;
    const profile = state.profiles.find(person => person.id === selfId()) || {};
    return `${state.mode==='demo'?'<div class="notice demo-notice">試用版では、位置や予定はこのブラウザ内にだけ保存されます。ほかの人には共有されません。</div>':''}
      <div class="setting-card">
        <div class="section-title">プロフィール <span class="tag">${state.mode==='demo'?'試用版':'ログイン中'}</span></div>
        <form id="profileForm" class="form-col">
          <div class="field"><label for="displayName">ニックネーム</label><input id="displayName" maxlength="32" required value="${esc(selfName())}" autocomplete="nickname"></div>
          <div class="field"><label for="battleReady">対戦歓迎の表示</label><select id="battleReady">${profileOptions({no:'表示しない',yes:'対戦歓迎'},profile.battle_ready?'yes':'no')}</select><p class="help">位置を共有している間、地図の丸が二重リングになります。</p></div>
          <div class="field"><label for="stadiumStatus">スタジアム</label><select id="stadiumStatus">${profileOptions(STADIUM_OPTIONS, profile.stadium_status || 'unset')}</select></div>
          <div class="field"><label for="rankLevel">ランク（仮）</label><select id="rankLevel" aria-describedby="rankHelp">${profileOptions(RANK_OPTIONS, profile.rank_level || 'unset')}</select><p class="help" id="rankHelp">今は自己申告で選べます。</p></div>
          <button class="btn dark wide" type="submit">プロフィールを保存</button>
        </form>
      </div>
      <div class="setting-card"><div class="toggle-line"><strong>現在地の共有</strong><span class="pill" id="sharePill">${sharing?'共有中':'OFF'}</span></div><div class="separator"></div>
      ${sharing?`<div class="share-active" id="shareStatus"></div><button class="btn outline wide" style="margin-top:12px" data-action="stop-share">${state.stopFailed?'公開停止をもう一度試す':'位置共有を停止する'}</button>`:`<p class="hint">共有は初期OFF。時間と位置の精度を選んで開始します。</p><div class="grid2 share-settings"><div class="field"><label for="shareDuration">共有する時間</label><select id="shareDuration"><option value="30">30分</option><option value="60" selected>1時間</option><option value="120">2時間</option><option value="360">6時間</option></select></div><div class="field"><label for="sharePrecision">位置の精度</label><select id="sharePrecision"><option value="approx">概略（約500m）</option><option value="exact">詳細位置</option></select></div></div><button class="btn teal wide" data-action="start-share">GPSで現在地を共有</button><button class="btn outline wide manual-button" data-action="manual-share">地図で選んだ地点を共有</button><p class="help">地図で指定した地点は5分間共有されます。</p>`}
      <p class="help" style="margin-top:12px">${state.mode==='demo'?'試用版のため、位置情報が他の利用者に送られることはありません。':'ログイン済みの利用者全員に表示されます。自宅付近での詳細位置の共有は避けてください。'}</p></div>
      <div class="setting-card"><strong>保存した場所</strong><div class="saved-places">${savedSpots().map((p,i)=>`<button class="saved-place" data-action="open-saved" data-index="${i}"><span>☆</span><span>${esc(p.name)}</span><span>地図</span></button>`).join('')||'<p class="hint">地図をタップ、または場所を検索して保存できます。</p>'}</div></div>
      <div class="setting-card"><strong>位置情報について</strong><p class="hint">GPSはアプリを開いている間に更新されます。画面を閉じたり、更新が5分以上止まったりすると地図から消えます。概略表示では、端末内で丸めた座標だけを共有します。</p></div>
      ${state.mode==='demo'?'<button class="btn outline wide" data-action="reset-demo">試用データを最初に戻す</button>':'<button class="btn outline wide" data-action="logout">ログアウト</button>'}`;
  }
  function updateShareIndicator() {
    const el=$('shareStatus'); if(!el)return;
    const share=state.share, mine=activePeople().find(p=>p.user_id===selfId());
    if(state.stopFailed){el.textContent='GPS更新は止まりました。通信が戻ったら公開停止を再試行してください。更新から5分で地図から消えます。';return;}
    if(!share&&mine?.kind==='checkin'){el.textContent=`選んだ地点を共有中。残り約${Math.max(0,Math.ceil((Date.parse(mine.expires_at)-Date.now())/60000))}分。自動更新はありません。`;return;}
    if(!share){el.textContent='前に共有した位置が表示されています。この端末ではGPSを更新していません。';return;}
    const remaining=Math.max(0,Math.ceil((share.until-Date.now())/60000));
    if(share.phase==='locating'){el.textContent='位置情報を取得しています。ブラウザの許可を確認してください。';return;}
    const stale=!mine||(share.kind!=='manual'&&Date.now()-Date.parse(mine.updated_at)>C.FRESH_MS);
    el.textContent=`${share.kind==='manual'?'選んだ地点':'GPSの現在地'}を共有${stale?'待機中':'中'}。残り約${remaining}分。${stale?'新しい位置情報を取得できていません。':share.kind==='gps'?'画面を閉じると更新が止まることがあります。':'自動更新はありません。'}`;
  }
  function mapGo(lat,lng) {
    if(!state.mapReady){notify('地図を読み込めませんでした');return;}
    if(window.matchMedia('(max-width:800px)').matches)setSheet(true);
    state.map.flyTo([lat,lng],15,{duration:.45});
  }
  function setSheet(collapsed) {
    state.sheetCollapsed=collapsed; $('sidePanel').classList.toggle('collapsed',collapsed);
    document.body.classList.toggle('side-collapsed',collapsed);
    updateSheetLabel();
  }
  function updateSheetLabel() {
    const button=document.querySelector('.sheet-handle');
    const names={now:`いまいる人を見る（${activePeople().length}人）`,plans:'出没予定を見る',account:'マイページを見る'};
    button.textContent=state.sheetCollapsed?names[state.tab]:'地図を広く見る';
    button.setAttribute('aria-label',button.textContent);
    button.setAttribute('aria-expanded',String(!state.sheetCollapsed));
  }
  function openModal(name) {
    state.previousFocus=document.activeElement;
    $(name+'Overlay').classList.add('open');
    setTimeout(()=>$(name+'Overlay').querySelector('input:not([type="hidden"]),button')?.focus(),0);
  }
  function closeModal(name) { $(name+'Overlay').classList.remove('open');state.previousFocus?.focus?.({preventScroll:true}); }
  function askConfirm(message, title='予定を削除', label='削除する') {
    $('confirmTitle').textContent=title;$('confirmMessage').textContent=message;$('confirmYes').textContent=label;
    openModal('confirm');return new Promise(resolve=>{state.confirmResolve=resolve;});
  }
  function resolveConfirm(value) { closeModal('confirm');state.confirmResolve?.(value);state.confirmResolve=null; }
  function defaultDraft() { const d=new Date();d.setDate(d.getDate()+1);return {id:'',title:'',date:dateYMD(d),endDate:dateYMD(d),start:'18:00',end:'20:00',place:'',details:'',lat:null,lng:null}; }
  function gatherDraft() {
    state.draft={...state.draft,id:$('editId').value,title:$('eventTitle').value,date:$('eventDate').value,endDate:$('eventEndDate').value,start:$('eventStart').value,end:$('eventEnd').value,place:$('eventPlace').value,details:$('eventDetail').value,stadiumPlan:$('eventStadium').value,lat:state.chosen?.lat??null,lng:state.chosen?.lng??null};
  }
  function restoreEvent() {
    const d=state.draft;
    for(const [id,key] of Object.entries({editId:'id',eventTitle:'title',eventDate:'date',eventEndDate:'endDate',eventStart:'start',eventEnd:'end',eventPlace:'place',eventDetail:'details'}))$(id).value=d[key]||'';
    $('eventStadium').value=d.stadiumPlan||'unset';
    state.chosen=C.validPoint(d)?{lat:Number(d.lat),lng:Number(d.lng)}:null;
    $('eventDialogTitle').textContent=d.id?'出没予定を編集':'出没予定を登録';$('eventSave').textContent=d.id?'変更を保存':'予定を登録する';
    updateCoords();openModal('event');
  }
  function newEvent(event) {
    if(!logged()){state.tab='account';render();notify('予定の登録にはログインしてください');return;}
    if(event){const start=new Date(event.starts_at),end=new Date(event.ends_at);state.draft={id:event.id,title:event.title,date:dateYMD(start),endDate:dateYMD(end),start:timeText(start),end:timeText(end),place:event.place_name,autoPlace:event.auto_place??event.place_name,stadiumPlan:event.stadium_plan,details:event.details,...{lat:event.lat,lng:event.lng}};}
    else state.draft=defaultDraft();
    $('placeQuery').value='';$('placeResults').innerHTML='';restoreEvent();
  }
  function venueName(current, candidate){
    return !current.trim() || current===state.draft.autoPlace ? candidate||'' : current;
  }
  function updateCoords() { const p=state.chosen;$('coordText').textContent=p?`選択済み：緯度 ${p.lat.toFixed(5)}／経度 ${p.lng.toFixed(5)}`:'地図上の位置を選んでください。'; }
  async function saveEvent() {
    gatherDraft();const draft=state.draft, record={...C.eventRecord(draft,selfId()),stadium_plan:draft.stadiumPlan||'unset',auto_place:draft.autoPlace||''};
    if(draft.id&&!state.events.some(ev=>ev.id===draft.id&&ev.user_id===selfId()))throw Error('自分の予定のみ編集できます');
    if(state.mode==='demo') {
      await updateDemo(latest=>{
        if(!draft.id){latest.events.push({id:uid(),...record});return;}
        const event=latest.events.find(ev=>ev.id===draft.id&&ev.user_id===selfId());
        if(!event)throw Error('この予定は削除されています');
        Object.assign(event,record);
      });
    } else {
      const q=draft.id?state.sb.from('events').update(record).eq('id',draft.id).eq('user_id',selfId()):state.sb.from('events').insert(record);
      const {error}=await q.select('id').single();if(error)throw error;await loadLive();
    }
    closeModal('event');closePlace();state.draft=null;state.tab='plans';state.filter='all';state.listQueries.plans='';setSheet(false);render();notify(draft.id?'予定を更新しました':'出没予定を登録しました');
  }
  async function deleteEvent(id) {
    const ev=state.events.find(e=>e.id===id&&e.user_id===selfId());if(!ev)return;
    if(!await askConfirm(`「${ev.title}」を削除しますか？`))return;
    if(state.mode==='demo'){await updateDemo(latest=>{latest.events=latest.events.filter(e=>e.id!==id);latest.rsvps=latest.rsvps.filter(r=>r.event_id!==id);});}
    else {const {data,error}=await state.sb.from('events').delete().eq('id',id).eq('user_id',selfId()).select('id');if(error)throw error;if(!data?.length)throw Error('削除できませんでした。予定を再読み込みしてください');await loadLive();}
    notify('予定を削除しました');
  }
  async function rsvp(id) {
    const ev=activeEvents().find(e=>e.id===id);if(!logged()||!ev||ev.user_id===selfId())return;
    const exists=state.rsvps.some(r=>r.event_id===id&&r.user_id===selfId());
    if(state.mode==='demo'){await updateDemo(latest=>{latest.rsvps=latest.rsvps.filter(r=>!(r.event_id===id&&r.user_id===selfId()));if(!exists&&latest.events.some(e=>e.id===id))latest.rsvps.push({event_id:id,user_id:selfId()});});}
    else {const q=exists?state.sb.from('rsvps').delete().eq('event_id',id).eq('user_id',selfId()):state.sb.from('rsvps').insert({event_id:id,user_id:selfId()});const {error}=await q;if(error)throw error;await loadLive();}
    notify(exists?'参加予定を取り消しました':'参加予定に登録しました');
  }
  function selectedPoint() {
    if(!state.selected)return null;
    return {...state.selected,name:clean($('selectedName').value)||state.selected.name||'選んだ場所'};
  }
  function showMapTab() {
    state.tab='now';render();if(isMobile())setSheet(true);
  }
  function stadiumText(event){return '当日のスタジアム：'+(EVENT_STADIUM[event.stadium_plan]||'未設定');}
  function eventTimeRange(event) {
    const sameDay=dateYMD(new Date(event.starts_at))===dateYMD(new Date(event.ends_at));
    return fmtDate(event.starts_at)+' 〜 '+(sameDay?timeText(event.ends_at):fmtDate(event.ends_at));
  }
  function renderMapEvent(event) {
    if(!event){closePlace();return;}
    const mine=event.user_id===selfId();
    const participants=attendees(event);
    const joined=!mine&&participants.includes(selfId());
    $('mapEventStatus').textContent=Date.parse(event.starts_at)<=Date.now()?'開催中':'出没予定';
    $('mapEventTitle').textContent=event.title;
    $('mapEventTime').textContent=eventTimeRange(event);
    const placeLink=$('mapEventPlace');
    placeLink.textContent=event.place_name;
    placeLink.href='https://www.google.com/maps/search/?api=1&query='+Number(event.lat)+','+Number(event.lng);
    placeLink.setAttribute('aria-label',event.place_name+'をマップアプリで開く');
    $('mapEventStadium').textContent=stadiumText(event);
    $('mapEventNote').textContent=event.details;
    $('mapEventNote').hidden=!event.details;
    $('mapEventHost').textContent='主催：'+nameFor(event.user_id);
    $('mapEventBadges').innerHTML=profileBadges(event.user_id);
    $('mapEventCount').textContent='参加予定 '+participants.length+'人（主催含む）';
    const action=$('mapEventAction');
    action.dataset.id=event.id;
    action.dataset.action=mine?'edit-event':'rsvp';
    action.textContent=mine?'予定を編集':joined?'参加を取り消す':'参加する';
    action.classList.toggle('is-joined',joined);
  }
  function openMapEvent(event) {
    closePlace();
    state.map.closePopup();
    $('mapSearchResults').hidden=true;
    $('mapSearch').blur();
    showMapTab();
    state.selectedEventId=event.id;
    renderMapEvent(event);
    $('mapEvent').hidden=false;
    document.body.classList.add('place-selected');
    $('mapEvent').querySelector('.map-event-scroll').scrollTop=0;
    $('mapEventTitle').focus({preventScroll:true});
    state.map.setView([event.lat,event.lng],Math.max(state.map.getZoom(),15),{animate:false});
    updateOverlaySizes();
    if(isMobile())state.map.panBy([0,$('mapEvent').offsetHeight/2],{animate:false});
  }
  function selectPlace(place, move=true) {
    if(!C.validPoint(place))return;
    closePlace();
    state.selected={lat:Number(place.lat),lng:Number(place.lng),name:clean(place.name)||'地図で選んだ場所',address:clean(place.address)};
    showMapTab();$('mapSearch').blur();$('mapSearchResults').hidden=true;
    $('selectedName').value=state.selected.name;
    $('selectedDetail').textContent=state.selected.address||`緯度 ${state.selected.lat.toFixed(5)} ・ 経度 ${state.selected.lng.toFixed(5)}`;
    $('selectedPlace').hidden=false;document.body.classList.add('place-selected');
    {const saved=Number(storage.get(CHECKIN_KEY,60));if(CHECKIN_CHOICES.includes(saved))$('checkinDuration').value=String(saved);}
    updateCheckinNote();
    updateSavedButton();
    if(state.mapReady){
      state.selectedMarker?.remove();
      state.selectedMarker=L.marker([state.selected.lat,state.selected.lng],{icon:L.divIcon({className:'selected-marker',html:'<span class="selected-pin"></span>',iconSize:[32,40],iconAnchor:[16,34]})}).addTo(state.map);
      if(move)state.map.setView([state.selected.lat,state.selected.lng],16);
      requestAnimationFrame(()=>{
        updateOverlaySizes();
        // Keep the selected pin in the unobscured portion of the map.
        if(move&&isMobile())state.map.panBy([0,$('selectedPlace').offsetHeight/2],{animate:false});
      });
    }
  }
  function closePlace() {
    state.selectedMarker?.remove();state.selectedMarker=null;state.selected=null;
    state.selectedEventId=null;
    $('selectedPlace').hidden=true;$('mapEvent').hidden=true;
    document.body.classList.remove('place-selected');updateOverlaySizes();
  }
  function updateSavedButton() {
    if(!state.selected)return;
    const exists=savedSpots().some(p=>placeKey(p)===placeKey(state.selected));
    $('saveSpotButton').textContent=exists?'★ 保存済み（タップで解除）':'☆ この場所を保存';
    $('saveSpotButton').setAttribute('aria-pressed',String(exists));
  }
  function saveSelected() {
    const place=selectedPoint();if(!place)return;
    const key=SPOTS_KEY+':'+selfId(),spots=savedSpots(),exists=spots.some(p=>placeKey(p)===placeKey(place));
    const next=spots.filter(p=>placeKey(p)!==placeKey(place));
    if(!exists){if(next.length>=100)throw Error('保存できる場所は100件までです');next.unshift(place);}
    storage.set(key,next);state.selected=place;updateSavedButton();render();notify(exists?'場所の保存を解除しました':'場所をこの端末に保存しました');
  }
  const CHECKIN_KEY='beyspot_checkin_minutes';
  const CHECKIN_CHOICES=[30,60,120,180,360];
  const minutesLabel=m=>m<60?`${m}分`:`${m/60}時間`;
  function checkinMinutes(){const v=Number($('checkinDuration')?.value);return CHECKIN_CHOICES.includes(v)?v:60;}
  function updateCheckinNote(){const m=checkinMinutes();$('selectedNote').textContent=state.mode==='demo'?`「ここにいる」は約500mの概略位置を${minutesLabel(m)}、端末内に登録します。`:`「ここにいる」は約500mの概略位置を${minutesLabel(m)}、利用者に共有します。あとから停止できます。`;}
  async function registerHere() {
    const place=selectedPoint();if(!place)return;
    if(!logged())throw Error('ログインしてください');
    if(state.share||activePeople().some(p=>p.user_id===selfId()))await stopShare(true);
    const minutes=checkinMinutes();storage.set(CHECKIN_KEY,minutes);
    const token=shares.begin();state.share={token,until:Date.now()+minutes*60000,kind:'manual',privacy:'approx',phase:'locating'};
    try{
      const sent=await publishLocation(place,Date.now(),token);if(!sent)throw Error('地点を登録できませんでした');
      state.stopFailed=false;closePlace();showMapTab();notify(state.mode==='demo'?`この場所にいる状態を${minutesLabel(minutes)}登録しました`:`この場所を${minutesLabel(minutes)}共有します`);
    }catch(error){state.share=null;throw error;}
  }
  function eventHere() {
    const place=selectedPoint();if(!place)return;
    newEvent();if(!state.draft)return;
    state.draft={...state.draft,place:place.name,autoPlace:place.name,lat:place.lat,lng:place.lng};closePlace();restoreEvent();
  }
  function updateOverlaySizes() {
    const activeCard=$('mapEvent').hidden?$('selectedPlace'):$('mapEvent');
    document.documentElement.style.setProperty('--place-height',activeCard.hidden?'0px':activeCard.offsetHeight+'px');
    document.documentElement.style.setProperty('--sheet-height',$('sidePanel').offsetHeight+'px');
  }
  async function lookupPlaces(query) {
    const q=clean(query);if(!q)throw Error('場所名や住所を入力してください');
    const direct=C.coordsFromMapUrl(q);
    if(direct)return [{...direct,name:'指定した地点',address:`緯度 ${direct.lat.toFixed(5)} ・ 経度 ${direct.lng.toFixed(5)}`}];
    if(/^https?:\/\//i.test(q))throw Error('短縮URLは展開できません。場所名・住所・緯度,経度で検索できます');
    const local=savedSpots().filter(p=>(p.name+' '+p.address).toLowerCase().includes(q.toLowerCase()));
    if(state.searchCache[q])return mergePlaces(local,state.searchCache[q]);
    if(Date.now()-state.searchAt<1100)throw Error('少し待ってからもう一度検索してください');
    state.searchAt=Date.now();
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{
      const url=new URL(config.searchUrl||'https://nominatim.openstreetmap.org/search');
      for(const [key,value] of Object.entries({format:'jsonv2',limit:'6','accept-language':'ja',countrycodes:'jp',q}))url.searchParams.set(key,value);
      const response=await fetch(url,{headers:{Accept:'application/json'},signal:controller.signal});
      if(!response.ok)throw Error('場所の検索サービスに接続できません');
      const data=await response.json();if(!Array.isArray(data))throw Error('検索結果を取得できません');
      const places=data.filter(p=>C.validPoint({lat:p.lat,lng:p.lon})).map(p=>({lat:Number(p.lat),lng:Number(p.lon),name:clean(p.name)||clean(p.display_name).split(',')[0],address:clean(p.display_name)}));
      state.searchCache[q]=places;return mergePlaces(local,places);
    }catch(error){if(local.length)return local;throw Error(error.name==='AbortError'?'検索に時間がかかっています。地図をタップしても登録できます':'検索できませんでした。地図をタップしても登録できます');}
    finally{clearTimeout(timer);}
  }
  function mergePlaces(first,second) {
    const seen=new Set();return [...first,...second].filter(p=>{const key=placeKey(p);if(seen.has(key))return false;seen.add(key);return true;}).slice(0,8);
  }
  function placeResultsHTML(places,action) {
    return places.map((p,i)=>`<button type="button" class="place-result" data-action="${action}" data-index="${i}"><span class="place-result-icon" aria-hidden="true">⌖</span><span><strong>${esc(p.name)}</strong><small>${esc(p.address)}</small></span></button>`).join('');
  }
  async function searchMap() {
    const request=++state.mapSearchRequest,area=$('mapSearchResults');
    const q=clean($('mapSearch').value);if(!q){showSavedResults();return;}
    closePlace();showMapTab();area.hidden=false;area.innerHTML='<p class="search-message">場所を検索しています…</p>';
    try{
      const places=await lookupPlaces(q);if(request!==state.mapSearchRequest)return;state.mapHits=places;
      area.innerHTML=places.length?placeResultsHTML(places,'select-map-place'):'<p class="search-message">見つかりませんでした。住所で検索するか、地図をタップしてください。</p>';
    }catch(error){if(request===state.mapSearchRequest)area.innerHTML=`<p class="search-message">${esc(error.message)}</p>`;}
    $('mapSearch').blur();
  }
  function showSavedResults() {
    if(clean($('mapSearch').value))return;
    state.mapHits=savedSpots().slice(0,8);const area=$('mapSearchResults');area.hidden=false;
    area.innerHTML=state.mapHits.length?'<p class="search-caption">保存した場所</p>'+placeResultsHTML(state.mapHits,'select-map-place'):'<p class="search-message">駅名・施設名・住所を検索できます。地図をタップして場所を選ぶこともできます。</p>';
  }
  function locateMe() {
    if(!navigator.geolocation||!window.isSecureContext){notify('この開き方ではGPSを使えません。場所検索か地図タップで登録できます');return;}
    notify('現在地を取得しています…');
    navigator.geolocation.getCurrentPosition(position=>selectPlace({lat:position.coords.latitude,lng:position.coords.longitude,name:'現在地'}),()=>notify('現在地を取得できません。Safariの位置情報の許可を確認するか、地図から指定してください'),{enableHighAccuracy:true,timeout:15000,maximumAge:10000});
  }
  async function searchPlace() {
    const request=++state.searchRequest,area=$('placeResults');area.innerHTML='<p class="search-message">検索中…</p>';
    try{const places=await lookupPlaces($('placeQuery').value);if(request!==state.searchRequest)return;state.lastHits=places;
      area.innerHTML=places.length?placeResultsHTML(places,'select-event-place'):'<p class="search-message">見つかりませんでした。地図から指定できます。</p>';
    }catch(error){if(request===state.searchRequest)area.innerHTML=`<p class="search-message">${esc(error.message)}</p>`;}
  }
  function pickEvent() { gatherDraft();if(!state.mapReady){notify('地図が利用できません。検索または緯度,経度で指定してください');return;}closePlace();closeModal('event');state.pickMode='event';$('pickPrompt').hidden=false;$('pickText').textContent='予定を登録する地点をタップ';setSheet(true); }
  function endPick() { state.pickMode=null;$('pickPrompt').hidden=true; }
  function cancelPick() { const was=state.pickMode;endPick();if(was==='event')restoreEvent();else{setSheet(false);render();} }
  function shareSettings() { return {minutes:Number($('shareDuration')?.value||60),privacy:$('sharePrecision')?.value||'approx'}; }
  function clearWatch() { if(state.geowatch!==null){navigator.geolocation?.clearWatch(state.geowatch);state.geowatch=null;}state.freshRequest=false; }
  async function publishLocation(point, measuredAt, token) {
    const share=state.share;if(!share||!shares.current(token)||share.token!==token||Date.now()>=share.until)return false;
    if(!C.validPoint(point)||!Number.isFinite(measuredAt)||Date.now()-measuredAt>60000||measuredAt>Date.now()+10000)return false;
    const mode=state.mode,client=state.sb,userId=selfId();
    const location=share.privacy==='approx'?C.coarse(point.lat,point.lng):point;
    const record={user_id:userId,lat:Number(location.lat),lng:Number(location.lng),precision:share.privacy,kind:share.kind==='manual'?'checkin':'live',updated_at:new Date(measuredAt).toISOString(),expires_at:new Date(share.until).toISOString()};
    return shares.enqueue(token,async()=>{
      if(mode==='demo'){await updateDemo(latest=>{
        if(share.written && !latest.positions.some(p=>p.user_id===userId && p.session===share.session))return;
        share.session ||= uid();share.written=true;
        latest.positions=latest.positions.filter(p=>p.user_id!==userId);
        latest.positions.push({...record,session:share.session});
      });}
      else{const {error}=await client.from('positions').upsert(record);if(error)throw error;}
      if(!shares.current(token))return false;
      state.lastPush=Date.now();share.phase='active';
      if(mode==='live')await loadLive();else render();return true;
    });
  }
  async function stopShare(silent=false) {
    const mode=state.mode,client=state.sb,userId=selfId();clearWatch();state.share=null;endPick();
    try{
      await shares.stop(async()=>{
        if(mode==='demo'){await updateDemo(latest=>{latest.positions=latest.positions.filter(p=>p.user_id!==userId);});}
        else if(client&&userId){const {error}=await client.from('positions').delete().eq('user_id',userId);if(error)throw error;}
      });
      state.stopFailed=false;if(mode==='live'&&client===state.sb&&state.user)await loadLive();render();if(!silent)notify('位置共有を停止しました');
    }catch(error){state.stopFailed=true;render();throw Error('GPS更新は停止しました。公開停止に失敗しました。通信を確認して再試行してください');}
  }
  function receiveGps(position, token) {
    const share=state.share;if(!share||share.token!==token||!shares.current(token)||document.hidden)return;
    const timestamp=Number(position.timestamp);state.lastPosition=Date.now();
    if(Date.now()-state.lastPush<12000&&share.phase==='active')return;
    const first=share.phase!=='active';
    publishLocation({lat:position.coords.latitude,lng:position.coords.longitude},timestamp,token).then(sent=>{
      if(sent&&first){notify('現在地の共有を開始しました');if(state.mapReady)state.map.setView([position.coords.latitude,position.coords.longitude],14);}
    }).catch(error=>notify('位置を更新できません：'+error.message));
  }
  function gpsError(error,token) {
    if(!state.share||state.share.token!==token)return;
    if(error.code===1){stopShare(true).catch(e=>notify(e.message));notify('位置情報が許可されていません。地図からの指定も使えます');}
    else{state.share.phase=state.lastPush?'active':'locating';notify('GPSを取得できません。窓際で試すか、地図から指定してください');}
    render();
  }
  function startGps() {
    if(!logged())throw Error('ログインしてください');
    if(state.share)return;
    if(!navigator.geolocation||!window.isSecureContext)throw Error('GPSにはHTTPSまたはlocalhostで開く必要があります。地図からの指定も使えます');
    const settings=shareSettings(),token=shares.begin();
    state.share={token,until:Date.now()+Math.min(360,Math.max(1,settings.minutes))*60000,privacy:settings.privacy,kind:'gps',phase:'locating'};
    state.stopFailed=false;state.lastPosition=0;state.lastPush=0;
    state.geowatch=navigator.geolocation.watchPosition(p=>receiveGps(p,token),e=>gpsError(e,token),{enableHighAccuracy:settings.privacy==='exact',maximumAge:10000,timeout:15000});render();
  }
  function freshGps() {
    const share=state.share;if(!share||share.kind!=='gps'||state.freshRequest||document.hidden)return;
    state.freshRequest=true;
    navigator.geolocation.getCurrentPosition(p=>{state.freshRequest=false;receiveGps(p,share.token);},e=>{state.freshRequest=false;gpsError(e,share.token);},{enableHighAccuracy:share.privacy==='exact',maximumAge:10000,timeout:15000});
  }
  function manualShare() {
    if(!state.mapReady)throw Error('地図が利用できません');
    closePlace();showMapTab();state.privacy=shareSettings().privacy;state.pickMode='manual';$('pickText').textContent='登録したい地点をタップ';$('pickPrompt').hidden=false;setSheet(true);notify('場所を検索するか、地図をタップして選んでください');
  }
  async function setProfile() {
    const displayName = clean($('displayName').value);
    const stadiumStatus = $('stadiumStatus').value;
    const rankLevel = $('rankLevel').value;
    if (!displayName || displayName.length > 32) throw Error('ニックネームは1〜32文字で入力してください');
    if (!Object.hasOwn(STADIUM_OPTIONS, stadiumStatus) || !Object.hasOwn(RANK_OPTIONS, rankLevel)) {
      throw Error('スタジアムとランクを選び直してください');
    }
    const record = {id:selfId(), display_name:displayName, stadium_status:stadiumStatus, rank_level:rankLevel,battle_ready:$('battleReady').value==='yes'};
    if (state.mode === 'demo') {
      await updateDemo(latest=>Object.assign(latest.profiles.find(person=>person.id===selfId()),record));
    } else {
      const {error} = await state.sb.from('profiles').upsert(record).select('id').single();
      if (error) throw error;
      await loadLive();
    }
    notify('プロフィールを保存しました');
  }
  async function sendReport(reason) {
    const target=state.pendingReport;closeModal('report');if(!target)return;
    if(state.mode==='demo'){state.localReports={...(state.localReports||{}),[target.type+':'+target.id]:1};render();notify('通報しました（試用版では保存されません）');return;}
    const {error}=await state.sb.from('reports').insert({reporter:selfId(),target_type:target.type,target_id:String(target.id),reason});
    if(error&&error.code!=='23505')throw error;
    await loadLive();notify('通報しました。ご協力ありがとうございます');
  }
  async function loadLive() {
    const client=state.sb,userId=selfId(),revision=state.revision,request=++state.request;if(!client||!state.user)return;
    const results=await Promise.all([
      client.from('profiles').select('id,display_name,stadium_status,rank_level,battle_ready,is_admin').limit(1000),
      client.from('positions').select('user_id,lat,lng,precision,updated_at,expires_at,kind').gt('expires_at',iso()).or(`kind.eq.checkin,updated_at.gt.${new Date(Date.now()-C.FRESH_MS).toISOString()}`).limit(1000),
      client.from('events').select('*').gt('ends_at',iso()).order('starts_at',{ascending:true}).limit(300),
      client.from('rsvps').select('event_id,user_id').limit(10000),
      client.from('reports').select('target_type,target_id,reporter').limit(10000)
    ]);
    if(client!==state.sb||userId!==selfId()||revision!==state.revision||request!==state.request)return;
    const error=results.find(r=>r.error)?.error;if(error){setStatus('データを更新できません。通信状態と接続設定を確認してください。',true);throw error;}
    [state.profiles,state.positions,state.events,state.rsvps,state.reports]=results.map(r=>r.data||[]);setStatus();render();
  }
  function scheduleLoad() { clearTimeout(state.loadTimer);state.loadTimer=setTimeout(()=>loadLive().catch(e=>console.error(e)),200); }
  function startRealtime() {
    const client=state.sb;if(!client||!state.user)return;
    client.removeAllChannels();let channel=client.channel('beybe-radar');
    for(const table of ['positions','events','rsvps','profiles','reports'])channel=channel.on('postgres_changes',{event:'*',schema:'public',table},scheduleLoad);
    channel.subscribe(status=>{if(client!==state.sb)return;state.connected=status==='SUBSCRIBED';if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')setStatus('接続し直しています。定期更新で情報を確認中です。');});
    clearInterval(state.refreshTimer);state.refreshTimer=setInterval(()=>loadLive().catch(()=>{}),30000);
  }
  async function ensureProfile(client,user) {
    const {data,error}=await client.from('profiles').select('id').eq('id',user.id).maybeSingle();if(error)throw error;
    if(!data){const meta=user.user_metadata||{};const display=String(state.pendingName||meta.name||meta.full_name||meta.user_name||meta.preferred_username||'ブレーダー').trim().slice(0,32)||'ブレーダー';const {error}=await client.from('profiles').upsert({id:user.id,display_name:display},{onConflict:'id',ignoreDuplicates:true});if(error)throw error;}
  }
  async function disconnect() {
    ++state.revision;++state.request;state.authSub?.unsubscribe();state.authSub=null;
    clearInterval(state.refreshTimer);clearTimeout(state.loadTimer);
    if(state.sb){await state.sb.removeAllChannels();state.sb.auth.stopAutoRefresh();}state.sb=null;state.user=null;
    state.profiles=[];state.positions=[];state.events=[];state.rsvps=[];state.renderKey='';
  }
  async function startSupabase(url,key) {
    C.validateConnection(url,key);if(!window.supabase?.createClient)throw Error('認証ライブラリを読み込めません');
    await stopShare(true);await disconnect();state.mode='live';state.tab='account';setStatus('接続しています…');render();
    const client=window.supabase.createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});state.sb=client;
    const {data,error}=await client.auth.getSession();if(error)throw error;state.user=data.session?.user||null;
    state.authSub=client.auth.onAuthStateChange((event,session)=>{
      if(client!==state.sb)return;const previous=state.user?.id;state.user=session?.user||null;
      if(previous!==state.user?.id){clearWatch();state.share=null;shares.stop();++state.request;state.positions=[];state.profiles=[];state.events=[];state.rsvps=[];state.renderKey='';render();}
      setTimeout(async()=>{
        if(client!==state.sb)return;
        if(state.user){try{await ensureProfile(client,state.user);await loadLive();if(event!=='TOKEN_REFRESHED')startRealtime();}catch(e){setStatus('データを読み込めません。接続設定を確認してください。',true);}}
        else{clearInterval(state.refreshTimer);await client.removeAllChannels();render();}
      },0);
    }).data.subscription;
    if(state.user){await ensureProfile(client,state.user);await loadLive();startRealtime();}else{setStatus();render();}
  }
  async function startAnon() {
    if(!state.sb)throw Error('接続を確認してください');
    const name=clean($('startName').value).slice(0,32);if(!name)throw Error('ニックネームを入れてください');
    if(!$('startAgree').checked)throw Error('同意のチェックを入れてください');
    state.pendingName=name;
    const {error}=await state.sb.auth.signInAnonymously({options:{data:{name}}});
    if(error)throw Error('はじめられませんでした。少し時間をおいて試してください');
    notify(`${name}さん、ようこそ！`);
  }
  async function logout() { await stopShare(true);const {error}=await state.sb.auth.signOut();if(error)throw error;state.user=null;state.tab='account';state.profiles=[];state.positions=[];state.events=[];state.rsvps=[];render();notify('ログアウトしました'); }
  async function switchDemo() { await stopShare(true);await disconnect();state.mode='demo';state.tab='now';setStatus();closeModal('settings');demo=readDemo();render(); }
  async function runBusy(button,action) { if(button?.disabled)return;if(button)button.disabled=true;try{await action();}catch(error){console.error(error);notify(error.message||'操作できませんでした');}finally{if(button?.isConnected)button.disabled=false;} }
  function attachEvents() {
    document.addEventListener('click',async e=>{
      const t=e.target.closest('button[data-action],button[data-tab],button[data-filter]');if(!t)return;
      if(t.dataset.tab){closePlace();endPick();$('mapSearchResults').hidden=true;state.tab=t.dataset.tab;setSheet(isMobile()&&state.tab==='now');render();return;}
      if(t.dataset.filter){state.filter=t.dataset.filter;render();return;}
      const action=t.dataset.action,id=t.dataset.id;
      if(action==='confirm-no'){resolveConfirm(false);return;}if(action==='confirm-yes'){resolveConfirm(true);return;}
      await runBusy(t,async()=>{
        if(action==='new-event')newEvent();
        else if(action==='close-event'){closeModal('event');endPick();state.draft=null;}
        else if(action==='pick-map')pickEvent();else if(action==='cancel-pick')cancelPick();
        else if(action==='toggle-sheet')setSheet(!state.sheetCollapsed);
        else if(action==='show-people'||action==='show-plans'){closePlace();endPick();state.tab=action==='show-people'?'now':'plans';setSheet(false);render();}
        else if(action==='close-place')closePlace();
        else if(action==='save-spot')saveSelected();
        else if(action==='register-here')await registerHere();
        else if(action==='event-here')eventHere();
        else if(action==='select-map-place'){const p=state.mapHits[Number(t.dataset.index)];if(p)chooseMapPoint(p,true);}
        else if(action==='open-saved'){const p=savedSpots()[Number(t.dataset.index)];if(p)selectPlace(p);}
        else if(action==='search-place')await searchPlace();
        else if(action==='select-event-place'){const p=state.lastHits[Number(t.dataset.index)];if(p&&C.validPoint(p)){state.chosen={lat:Number(p.lat),lng:Number(p.lng)};$('eventPlace').value=venueName($('eventPlace').value,p.name);state.draft.autoPlace=p.name;updateCoords();$('placeResults').innerHTML='';if(state.mapReady)state.map.setView([state.chosen.lat,state.chosen.lng],15);}}
        else if(action==='go-event'){const p=activeEvents().find(ev=>ev.id===id);if(p&&state.mapReady)openMapEvent(p);else notify('地図を読み込めませんでした');}
        else if(action==='go-person'){const p=activePeople().find(p=>p.user_id===id);if(p)mapGo(p.lat,p.lng);}
        else if(action==='edit-event'){const p=state.events.find(ev=>ev.id===id&&ev.user_id===selfId());if(p)newEvent(p);}
        else if(action==='report'){state.pendingReport={type:t.dataset.type,id};openModal('report');}
        else if(action==='close-report')closeModal('report');
        else if(action==='report-reason')await sendReport(t.dataset.reason);
        else if(action==='admin-delete-event'){if(await askConfirm('この予定を管理者として削除します。元に戻せません。','管理者削除','削除する')){const {error}=await state.sb.from('events').delete().eq('id',id);if(error)throw error;await loadLive();notify('予定を削除しました');}}
        else if(action==='admin-delete-user'){if(await askConfirm('この人の位置共有を管理者として消します。','管理者削除','消す')){const {error}=await state.sb.from('positions').delete().eq('user_id',id);if(error)throw error;await loadLive();notify('位置共有を消しました');}}
        else if(action==='delete-event')await deleteEvent(id);else if(action==='rsvp')await rsvp(id);
        else if(action==='go-account'){state.tab='account';setSheet(false);render();}
        else if(action==='start-share')startGps();else if(action==='manual-share')manualShare();else if(action==='stop-share')await stopShare();
        else if(action==='center-map')mapGo(...TOKYO);
        else if(action==='go-gps')locateMe();
        else if(action==='logout'){if(state.user?.is_anonymous&&!(await askConfirm('ニックネームで始めた場合、ログアウトすると同じアカウントには戻れません。予定や参加情報も自分では編集できなくなります。','ログアウトしますか？','ログアウトする')))return;await logout();}
        else if(action==='reset-demo'){if(await askConfirm('プロフィール・現在地・予定・参加情報を初期化します。保存した場所は残ります。','試用データをリセット','リセットする')){await stopShare(true);state.renderKey='';await updateDemo(latest=>Object.assign(latest,seedDemo()));notify('最初の状態に戻しました');}}
        else if(action==='settings'){$('sbUrl').value=config.supabaseUrl||savedConnection?.url||'';$('sbKey').value=config.supabasePublicKey||savedConnection?.key||'';openModal('settings');}
        else if(action==='close-settings')closeModal('settings');else if(action==='use-demo')await switchDemo();
        else if(action==='connect-supabase'){const url=clean($('sbUrl').value),key=clean($('sbKey').value);await startSupabase(url,key);savedConnection={url,key};storage.set(CONFIG_KEY,savedConnection);closeModal('settings');}
      });
    });
    document.addEventListener('submit',e=>{
      if(!['mapSearchForm','eventForm','profileForm','loginForm','startForm'].includes(e.target.id))return;e.preventDefault();
      runBusy(e.submitter,async()=>{
        if(e.target.id==='startForm')await startAnon();else if(e.target.id==='mapSearchForm')await searchMap();else if(e.target.id==='eventForm')await saveEvent();else if(e.target.id==='profileForm')await setProfile();
        else{const email=clean($('loginEmail').value);if(!state.sb)throw Error('接続を確認してください');const redirect=location.protocol.startsWith('http')?location.origin+location.pathname:undefined;const {error}=await state.sb.auth.signInWithOtp({email,options:redirect?{emailRedirectTo:redirect}:{}});if(error)throw error;notify('ログインメールを送りました。受信箱を確認してください');}
      });
    });
    $('listSearch').addEventListener('input',()=>{state.listQueries[state.tab]=$('listSearch').value;render();});
    $('mapSearch').addEventListener('focus',()=>{if(state.selected||!$('mapEvent').hidden)closePlace();if(isMobile())setSheet(true);showSavedResults();});
    $('checkinDuration').addEventListener('change',updateCheckinNote);
    $('mapSearch').addEventListener('input',()=>{++state.mapSearchRequest;$('mapSearchResults').hidden=true;});
    document.addEventListener('pointerdown',e=>{if(!$('mapSearchPanel').contains(e.target))$('mapSearchResults').hidden=true;});
    $('selectedName').addEventListener('change',()=>{if(state.selected)state.selected.name=clean($('selectedName').value)||state.selected.name;});
    $('placeQuery').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();runBusy(document.querySelector('[data-action="search-place"]'),searchPlace);}});
    $('eventDate').addEventListener('change',()=>{if($('eventEndDate').value<$('eventDate').value)$('eventEndDate').value=$('eventDate').value;});
    for(const name of ['event','settings','confirm','report'])$(name+'Overlay').addEventListener('click',e=>{if(e.target!==$(name+'Overlay'))return;if(name==='confirm')resolveConfirm(false);else closeModal(name);});
    document.addEventListener('keydown',e=>{
      const open=[...document.querySelectorAll('.modaloverlay.open')].pop();
      if(e.key==='Escape'){if(state.confirmResolve)resolveConfirm(false);else if(open)open.classList.remove('open');else if(state.pickMode)cancelPick();else if(!$('mapSearchResults').hidden)$('mapSearchResults').hidden=true;else closePlace();}
      if(e.key==='Tab'&&open){const items=[...open.querySelectorAll('button:not(:disabled),input:not([type="hidden"]),select,textarea,a[href]')].filter(el=>el.offsetParent!==null),first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
    });
    window.addEventListener('storage',e=>{
      if(state.mode!=='demo'||e.key!==DEMO_KEY)return;
      demo=readDemo();
      if(state.share?.written&&!demo.positions.some(p=>p.user_id===selfId()&&p.session===state.share.session)){
        clearWatch();state.share=null;shares.stop();
      }
      render();
    });
    window.addEventListener('offline',()=>setStatus('オフラインです。通信が戻ると最新情報を取得します。',true));
    window.addEventListener('online',()=>{setStatus();if(state.mode==='live')loadLive().catch(()=>{});freshGps();});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(state.mode==='live')loadLive().catch(()=>{});freshGps();render();}});
    window.addEventListener('pagehide',clearWatch);
    window.addEventListener('pageshow',e=>{if(e.persisted){state.share=null;render();}});
  }
  async function boot() {
    $('eventStadium').innerHTML=profileOptions(EVENT_STADIUM,'unset');
    attachEvents();sourceDemo();initMap();render();await updateDemo(()=>{});
    if(isMobile())setSheet(true);
    const updateViewport=()=>{
      document.documentElement.style.setProperty('--app-height',(window.visualViewport?.height||window.innerHeight)+'px');
      const active=document.activeElement;
      document.body.classList.toggle('keyboard-open',!!active&&['INPUT','TEXTAREA'].includes(active.tagName)&&(window.visualViewport?.height||window.innerHeight)<window.innerHeight-100);
      updateOverlaySizes();state.map?.invalidateSize({pan:false});
    };
    window.addEventListener('resize',updateViewport);window.visualViewport?.addEventListener('resize',updateViewport);
    if(window.ResizeObserver){const observer=new ResizeObserver(updateOverlaySizes);observer.observe($('sidePanel'));observer.observe($('selectedPlace'));observer.observe($('mapEvent'));}
    updateViewport();
    // Live wiring is optional during the hands-on preview.
    const url=!config.previewOnly&&(config.supabaseUrl||savedConnection?.url),key=!config.previewOnly&&(config.supabasePublicKey||savedConnection?.key);
    if(config.previewOnly||config.supabaseUrl&&config.supabasePublicKey)document.querySelector('[data-action="settings"]').hidden=true;
    if(config.previewOnly)$('eventForm').querySelector('.notice').textContent='試用版です。登録した予定はこのブラウザ内にだけ保存されます。ほかの人には公開されません。';
    if(url&&key){try{await startSupabase(url,key);}catch(error){setStatus('接続できませんでした：'+error.message,true);}}
    let lastShape='';
    state.expiry=setInterval(()=>{
      if(state.share&&Date.now()>=state.share.until){stopShare(true).then(()=>notify('共有時間が終了しました')).catch(e=>notify(e.message));}
      updateShareIndicator();const shape=JSON.stringify([activePeople().map(p=>p.user_id),activeEvents().map(e=>e.id)]);
      if(shape!==lastShape){lastShape=shape;render();}
      if(state.share?.kind==='gps'&&Date.now()-state.lastPosition>30000)freshGps();
    },1000);
    setInterval(()=>{
      if(state.mode==='demo'){demo=readDemo();sourceDemo();}render();
    },60000);
  }
  boot().catch(error=>{console.error(error);notify('起動できませんでした：'+error.message);});
})();
