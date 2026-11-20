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
        {user_id:'sample1',lat:35.6998,lng:139.7709,precision:'exact'},
        {user_id:'sample2',lat:35.697,lng:139.7021,precision:'exact'},
        {user_id:'sample3',lat:35.662,lng:139.6654,precision:'exact'}
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
    mapSearchRequest:0, mapHits:[], tileLoaded:0, tileErrors:0, selectedEventId:null,
    areas:[], battles:[], extras:false, battleDraft:null, seenBumped:false, knownRequests:null
  };
  const shares=C.createShareQueue();
  const selfId=()=>state.mode==='demo'?'demo-me':state.user?.id;
  const logged=()=>state.mode==='demo'||!!state.user;
  const nameFor=id=>state.profiles.find(p=>p.id===id)?.display_name||'ブレーダー';
  const selfName=()=>nameFor(selfId());
  // ---- 出没エリア・対戦記録（2026-11-20） ----
  const AREA_MAX=3, AREA_STALE_MS=30*86400000, REQUEST_DAYS=14;
  const tagFor=id=>state.profiles.find(p=>p.id===id)?.tag||'';
  const fullName=id=>nameFor(id)+(tagFor(id)?'#'+tagFor(id):'');
  const meters=(a,b)=>{const R=6371000,r=x=>x*Math.PI/180,dLat=r(b.lat-a.lat),dLng=r(b.lng-a.lng);const h=Math.sin(dLat/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLng/2)**2;return 2*R*Math.asin(Math.sqrt(h));};
  const RESULT_TEXT={win:'勝ち',lose:'負け',draw:'引き分け'};
  const flipResult=r=>r==='win'?'lose':r==='lose'?'win':'draw';
  // 自分から見た結果に直す（相手が登録した記録は勝ち負けとスコアを入れかえる）
  function battleView(b,me=selfId()){
    const mineSide=b.reporter===me;
    return {result:mineSide?b.result:flipResult(b.result),my:mineSide?b.my_score:b.their_score,their:mineSide?b.their_score:b.my_score,
      other:mineSide?b.opponent:b.reporter,otherName:b.status==='memo'?b.opponent_name:fullName(mineSide?b.opponent:b.reporter)};
  }
  function recordOf(userId){
    const r={win:0,lose:0,draw:0};
    for(const b of state.battles){if(b.status!=='confirmed'||(b.reporter!==userId&&b.opponent!==userId))continue;r[battleView(b,userId).result]++;}
    r.total=r.win+r.lose+r.draw;return r;
  }
  const recordText=r=>`${r.win}勝${r.lose}敗${r.draw?r.draw+'分':''}`;
  const scoreText=v=>(v.my??'')!==''&&v.my!==null&&v.their!==null&&v.their!==undefined?` ${v.my}-${v.their}`:'';
  const myAreas=()=>state.areas.filter(a=>a.user_id===selfId());
  const areaStale=a=>Date.now()-Date.parse(a.seen_at||a.created_at)>AREA_STALE_MS;
  const incomingRequests=()=>state.battles.filter(b=>b.status==='pending'&&b.opponent===selfId()&&Date.now()-Date.parse(b.created_at)<REQUEST_DAYS*86400000);
  const myBattles=()=>state.battles.filter(b=>b.reporter===selfId()||(b.opponent===selfId()&&b.status==='confirmed')).sort((a,b)=>b.played_at.localeCompare(a.played_at));
  function profileBadges(userId) {
    const profile = state.profiles.find(person => person.id === userId) || {};
    const stadium = STADIUM_OPTIONS[profile.stadium_status] || STADIUM_OPTIONS.unset;
    const rank = RANK_OPTIONS[profile.rank_level] || RANK_OPTIONS.unset;
    const rec=state.extras?recordOf(userId):{total:0};
    return `<div class="profile-badges">${rec.total?`<span class="profile-badge record-badge">戦績 ${recordText(rec)}</span>`:''}${profile.battle_ready?'<span class="profile-badge ready-badge">対戦歓迎</span>':''}<span class="profile-badge stadium-badge">スタジアム · ${esc(stadium)}</span><span class="profile-badge rank-badge">ランク（仮） · ${esc(rank)}</span></div>`;
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
  const viewing=()=>logged()||(state.mode==='live'&&!!state.sb);
  const activePeople=()=>viewing()?state.positions.filter(p=>C.validShare(p)):[];
  const activeEvents=()=>viewing()?state.events.filter(e=>Date.parse(e.ends_at)>Date.now()).sort((a,b)=>a.starts_at.localeCompare(b.starts_at)):[];
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
  function radarScan(){
    if(!state.mapReady||!state.selected||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    document.querySelector('.radar-scan')?.remove();
    const wrap=document.querySelector('.map-wrap'),c=state.map.latLngToContainerPoint([state.selected.lat,state.selected.lng]);
    const R=Math.round(Math.min(160,wrap.clientWidth*0.42)),T=1400,me=selfId(),hits=new Map();
    const cands=activePeople().filter(p=>p.user_id!==me).map(p=>({id:p.user_id,lat:p.lat,lng:p.lng})).concat(state.extras?state.areas.filter(a=>a.user_id!==me&&C.validPoint(a)).map(a=>({id:a.user_id,lat:a.lat,lng:a.lng})):[]);
    const el=document.createElement('div');el.className='radar-scan';el.style.cssText=`left:${c.x-R}px;top:${c.y-R}px;width:${R*2}px;height:${R*2}px`;
    let blips='';
    cands.forEach(p=>{const q=state.map.latLngToContainerPoint([p.lat,p.lng]),dx=q.x-c.x,dy=q.y-c.y;if(Math.hypot(dx,dy)>R*0.92)return;hits.set(p.id,1);
      const ang=(Math.atan2(dx,-dy)*180/Math.PI+360)%360;blips+=`<img class="scan-blip" src="assets/scan-blip.png" alt="" style="left:${R+dx}px;top:${R+dy}px;animation-delay:${Math.round(ang/360*T)}ms">`;});
    el.innerHTML=`<img class="scan-bg" src="assets/scan-radar.png" alt=""><div class="scan-sweep"></div>${blips}`;
    wrap.appendChild(el);
    setTimeout(()=>{el.classList.add('done');setTimeout(()=>el.remove(),500);notify(hits.size?`近くに${hits.size}人いるよ`:'近くには誰もいないみたい');},T+250);
  }
  function chooseMapPoint(place, move) {
    const forEvent=state.pickMode==='event', forArea=state.pickMode==='area';
    endPick();
    if(forArea){openArea({lat:place.lat,lng:place.lng,name:place.name||''});return;}
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
    const areas=state.extras?state.areas.filter(C.validPoint):[];
    if($('mapAreas')){$('mapAreas').textContent=`出没エリア ${areas.length}件`;$('mapAreas').parentElement.hidden=!state.extras;}
    const data=JSON.stringify([people,events,areas,state.profiles,selfId(),state.battles.length]);
    if (data===state.markerKey) return; state.markerKey=data;
    state.markers.forEach(m=>m.remove()); state.markers=[];
    areas.forEach(a=>{
      const stale=areaStale(a),mine=a.user_id===selfId(),label=`出没エリア：${a.name}（${nameFor(a.user_id)}）`;
      const circle=L.circle([a.lat,a.lng],{radius:160,color:mine?'#152a34':'#7a5cff',weight:2,dashArray:'5 6',opacity:stale?.35:.8,fillColor:'#7a5cff',fillOpacity:stale?.05:.14,interactive:true}).addTo(state.map);
      const m=L.marker([a.lat,a.lng],{icon:L.divIcon({className:'area-hit',html:`<span class="area-dot${stale?' is-stale':''}${mine?' is-mine':''}" aria-hidden="true">${esc(initial(nameFor(a.user_id)))}</span>`,iconSize:[30,30],iconAnchor:[15,15],popupAnchor:[0,-12]}),title:label,alt:label,zIndexOffset:-500}).addTo(state.map);
      const pop=`<div class="popup-title">${esc(fullName(a.user_id))}${mine?'（あなた）':''}の出没エリア</div><div><strong>${esc(a.name)}</strong></div>${a.when_text?`<div>よくいる：${esc(a.when_text)}</div>`:''}${stale?'<div class="popup-muted">最近は来ていないかも</div>':''}${profileBadges(a.user_id)}`;
      m.bindPopup(pop);circle.bindPopup(pop);labelMarker(m,label);
      m.on('click',()=>{closePlace();if(state.pickMode){m.closePopup();chooseMapPoint({lat:a.lat,lng:a.lng,name:a.name},false);}});
      state.markers.push(circle,m);
    });
    people.forEach(p=>{
      if(!C.validPoint(p))return;
      const ready=!!state.profiles.find(profile=>profile.id===p.user_id)?.battle_ready;
      const label='現在地：'+nameFor(p.user_id)+(ready?'（対戦歓迎）':'');
      const m=L.marker([p.lat,p.lng],markerOptions('person',label,p.user_id===selfId(),ready)).addTo(state.map)
        .bindPopup(`<div class="popup-title">${esc(nameFor(p.user_id))}${p.user_id===selfId()?'（あなた）':''}</div>${profileBadges(p.user_id)}<div>${p.precision==='approx'?'約500mの概略位置':p.kind==='checkin'?'選んだ地点':'詳細位置'}を共有中</div><div class="popup-muted">${esc(ago(p.updated_at))}更新</div>`);
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
    $('mapTypeBadge').textContent=state.mode==='demo'?'架空のサンプルデータ':logged()?'登録ユーザーの情報':'見るだけモード';
    document.querySelectorAll('button[data-tab]').forEach(el=>{el.classList.toggle('active',el.dataset.tab===state.tab);el.setAttribute('aria-current',el.dataset.tab===state.tab?'page':'false');});
    $('panelTitle').textContent=state.tab==='now'?'いま、誰がいる？':state.tab==='plans'?'いつ、どこに集まる？':'マイページ';
    $('panelDesc').textContent=state.tab==='now'?'近くのブレーダーを見つけよう。':state.tab==='plans'?'対戦の予定を立てて、集まろう。':'プロフィールと現在地共有の設定';
    $('filterBar').hidden=state.tab==='account'||!viewing();
    $('planFilters').hidden=state.tab!=='plans';
    const query=state.listQueries[state.tab]||'';
    if($('listSearch').value!==query)$('listSearch').value=query;
    const listLabel=state.tab==='now'?'ブレーダー名で検索':'場所・名前・予定を検索';
    $('listSearch').placeholder=listLabel;
    $('listSearch').setAttribute('aria-label',listLabel);
    document.querySelectorAll('[data-filter]').forEach(el=>{el.classList.toggle('active',el.dataset.filter===state.filter);el.setAttribute('aria-pressed',String(el.dataset.filter===state.filter));});
    $('panelContent').innerHTML=!logged()&&(state.tab==='account'||!viewing())?loginWall():(!logged()?viewBanner():'')+(state.tab==='now'?renderNow():state.tab==='plans'?renderPlans():renderAccount());
    document.body.dataset.tab=state.tab;
    if(document.body.dataset.lastTab!==state.tab){document.body.dataset.lastTab=state.tab;document.body.classList.remove('scrolled-down');}
    {const m=$('mainAction');if(state.tab==='now'){m.dataset.action='go-gps';m.textContent='📍 いまここにいる';m.className='btn teal wide';}else{m.dataset.action='new-event';m.textContent='＋ 出没予定を登録';m.className='btn primary wide';}}
    document.querySelectorAll('[data-tab="account"]').forEach(el=>el.classList.toggle('has-alert',state.extras&&incomingRequests().length>0));
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
    return `${n ? `<span class="report-badge">⚠ 通報${n}件${n >= REPORT_HIDE_AT ? '・非表示中' : ''}</span>` : ''}${mine}<button class="tiny-btn report-btn" data-action="admin-delete-${type}" data-id="${esc(id)}">管理削除</button>`;
  }
  function renderNow() {
    const people = activePeople().filter(person => nameFor(person.user_id).toLowerCase().includes(state.listQueries.now.toLowerCase()));
    const sample = state.mode === 'demo' ? '<div class="notice demo-notice">試用版です。表示中の人・予定は架空で、操作はこのブラウザにだけ保存されます。</div>' : '';
    const cards = people.map(person => `
      <div class="card person-card">
        <div class="person-top">
          <span class="avatar">${esc(initial(nameFor(person.user_id)))}</span>
          <div class="person-name">
            <strong>${esc(nameFor(person.user_id))}${tagFor(person.user_id)?`<span class="name-tag">#${esc(tagFor(person.user_id))}</span>`:''}${person.user_id === selfId() ? '（あなた）' : ''}</strong>
            <div class="person-sub">${esc(ago(person.updated_at))}更新・${person.precision === 'approx' ? '約500m表示' : person.kind === 'checkin' ? '地点を指定' : '詳細表示'}</div>
          </div>
          <span class="pill">共有中</span>
        </div>
        ${profileBadges(person.user_id)}
        <div class="card-buttons"><button class="tiny-btn" data-action="go-person" data-id="${esc(person.user_id)}">地図で見る</button>${state.extras&&state.user&&person.user_id!==selfId()?`<button class="tiny-btn" data-action="new-battle" data-id="${esc(person.user_id)}">対戦を記録</button>`:''}${reportTools('user', person.user_id, person.user_id)}</div>
      </div>`).join('');
    const empty = `<div class="empty">${state.listQueries.now ? '該当するブレーダーはいません。' : '現在地を共有している人はまだいません。'}</div>`;
    return `${sample}
      <div class="statstrip"><div class="stat"><b>${activePeople().length}</b><span>現在地を共有中</span></div><div class="stat"><b>${activeEvents().length}</b><span>これからの出没予定</span></div></div>
      <div class="section-title">いまいるブレーダー <span class="count">${people.length}</span></div>
      ${cards || empty}
      ${areaListHTML()}
`;
  }

  function areaListHTML(){
    if(!state.extras)return '';
    const q=state.listQueries.now.toLowerCase();
    const list=state.areas.filter(a=>[a.name,a.when_text,fullName(a.user_id)].join(' ').toLowerCase().includes(q)).sort((a,b)=>areaStale(a)-areaStale(b)||b.seen_at.localeCompare(a.seen_at));
    const cards=list.slice(0,60).map(a=>`<div class="card area-card${areaStale(a)?' is-stale':''}"><div class="person-top"><span class="avatar area-avatar">${esc(initial(nameFor(a.user_id)))}</span><div class="person-name"><strong>${esc(a.name)}</strong><div class="person-sub">${esc(fullName(a.user_id))}${a.user_id===selfId()?'（あなた）':''}${a.when_text?' ・ '+esc(a.when_text):''}${areaStale(a)?' ・ 最近は来ていないかも':''}</div></div><span class="pill area-pill">出没エリア</span></div><div class="card-buttons"><button class="tiny-btn" data-action="go-area" data-id="${esc(a.id)}">地図で見る</button>${a.user_id!==selfId()&&logged()?`<button class="tiny-btn" data-action="new-battle" data-id="${esc(a.user_id)}">対戦を記録</button>`:''}</div></div>`).join('');
    return `<div class="section-title">出没エリア <span class="count">${list.length}</span></div>${cards||`<div class="empty">${q?'該当する出没エリアはありません。':'まだありません。'}</div>`}`;
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
          <div class="event-owner">参加 ${attendees(event).length}人</div>
          <div class="event-actions"><button class="tiny-btn" data-action="go-event" data-id="${esc(event.id)}">地図</button>${actions}${reportTools('event', event.id, event.user_id)}</div>
        </div>
        ${participantInfo(event)}
      </article>`;
    }).join('');
    const empty = '<div class="empty">予定はありません。</div>';
    return `<div class="section-title">これからの出没予定 <span class="count">${events.length}</span></div>${cards || empty}`;
  }
  function viewBanner(){return `<div class="notice view-notice">見るだけモードです。<button class="linklike" data-action="go-account">ニックネームではじめる</button></div>`;}
  function loginWall() {
    return `<div class="setting-card form-col"><h2 class="login-heading">ニックネームではじめる</h2><p class="hint">メール登録は不要です。</p><form id="startForm" class="form-col"><div class="field"><label for="startNick">ニックネーム</label><input type="text" id="startNick" required maxlength="32" placeholder="例：しょうた" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></div><label class="agree"><input type="checkbox" id="startAgree" required> 18歳以上で、公園など公共の場所で会うことに同意します</label><button class="btn teal wide" type="submit">はじめる</button></form><p class="help">この端末のブラウザに記録されます。</p></div>`;
  }
  function renderAccount() {
    const mine=activePeople().find(p=>p.user_id===selfId()), sharing=!!state.share||!!mine;
    const profile = state.profiles.find(person => person.id === selfId()) || {};
    return `${state.mode==='demo'?'<div class="notice demo-notice">試用版では、位置や予定はこのブラウザ内にだけ保存されます。ほかの人には共有されません。</div>':''}
      ${battleAccountHTML()}
      <div class="setting-card">
        <div class="section-title">プロフィール <span class="tag">${state.mode==='demo'?'試用版':'ログイン中'}</span></div>
        <form id="profileForm" class="form-col">
          <div class="field"><label for="nickField">ニックネーム${tagFor(selfId())?` <span class="my-tag">#${esc(tagFor(selfId()))}</span>`:''}</label><input id="nickField" maxlength="32" required value="${esc(selfName())}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></div>
          <div class="field"><label for="battleReady">対戦歓迎の表示</label><select id="battleReady">${profileOptions({no:'表示しない',yes:'対戦歓迎'},profile.battle_ready?'yes':'no')}</select></div>
          <div class="field"><label for="stadiumStatus">スタジアム</label><select id="stadiumStatus">${profileOptions(STADIUM_OPTIONS, profile.stadium_status || 'unset')}</select></div>
          <div class="field"><label for="rankLevel">ランク（仮）</label><select id="rankLevel">${profileOptions(RANK_OPTIONS, profile.rank_level || 'unset')}</select></div>
          <button class="btn dark wide" type="submit">プロフィールを保存</button>
        </form>
      </div>
      <div class="setting-card"><div class="toggle-line"><strong>現在地の共有</strong><span class="pill" id="sharePill">${sharing?'共有中':'OFF'}</span></div><div class="separator"></div>
      ${sharing?`<div class="share-active" id="shareStatus"></div><button class="btn outline wide" style="margin-top:12px" data-action="stop-share">${state.stopFailed?'公開停止をもう一度試す':'位置共有を停止する'}</button>`:`<div class="field share-settings"><label for="shareDuration">共有する時間</label><select id="shareDuration"><option value="30">30分</option><option value="60" selected>1時間</option><option value="120">2時間</option><option value="360">6時間</option></select></div><button class="btn teal wide" data-action="start-share">GPSで現在地を共有</button><button class="btn outline wide manual-button" data-action="manual-share">地図で選んだ地点を共有</button>`}
      </div>
      ${areaAccountHTML()}
      <div class="setting-card"><strong>保存した場所</strong><div class="saved-places">${savedSpots().map((p,i)=>`<button class="saved-place" data-action="open-saved" data-index="${i}"><span>☆</span><span>${esc(p.name)}</span><span>地図</span></button>`).join('')||'<p class="hint">まだありません。</p>'}</div></div>
      ${state.mode==='demo'?'<button class="btn outline wide" data-action="reset-demo">試用データを最初に戻す</button>':'<button class="btn outline wide" data-action="logout">ログアウト</button>'}`;
  }
  function battleAccountHTML(){
    if(!state.extras||state.mode!=='live')return '';
    const reqs=incomingRequests(), rec=recordOf(selfId()), list=myBattles().slice(0,30);
    const reqHTML=reqs.length?`<div class="setting-card request-card"><div class="section-title">承認待ちの対戦 <span class="count">${reqs.length}</span></div>${reqs.map(b=>{const v=battleView(b);return `<div class="battle-row"><div><strong>${esc(fullName(b.reporter))}</strong> との対戦<div class="person-sub">あなたの${esc(RESULT_TEXT[v.result])} ・ ${esc(fmtDate(b.played_at))}</div></div><div class="battle-actions"><button class="tiny-btn joined" data-action="confirm-battle" data-id="${esc(b.id)}">OK</button><button class="tiny-btn" data-action="reject-battle" data-id="${esc(b.id)}">ちがう</button></div></div>`;}).join('')}</div>`:'';
    const rows=list.map(b=>{const v=battleView(b),st=b.status==='confirmed'?'確定':b.status==='memo'?'メモ':'承認待ち';return `<div class="battle-row"><div><span class="result-chip r-${v.result}">${esc(RESULT_TEXT[v.result])}</span> <strong>vs ${esc(v.otherName)}</strong><div class="person-sub">${esc(fmtDate(b.played_at))}</div></div><div class="battle-actions"><span class="pill status-${b.status}">${st}</span>${b.reporter===selfId()?`<button class="tiny-btn" data-action="delete-battle" data-id="${esc(b.id)}" aria-label="この記録を消す">消す</button>`:''}</div></div>`;}).join('');
    return `${reqHTML}<div class="setting-card"><div class="section-title">対戦記録 <span class="tag">戦績 ${recordText(rec)}</span></div><button class="btn primary wide" data-action="new-battle">＋ 対戦を記録</button>${rows?`<div class="battle-list">${rows}</div>`:'<p class="hint" style="margin-top:10px">まだ記録がありません。</p>'}</div>`;
  }
  function areaAccountHTML(){
    if(!state.extras||state.mode!=='live')return '';
    const list=myAreas();
    return `<div class="setting-card"><div class="section-title">出没エリア <span class="count">${list.length}/${AREA_MAX}</span></div>${list.map(a=>`<div class="battle-row"><div><strong>${esc(a.name)}</strong><div class="person-sub">${a.when_text?'よくいる：'+esc(a.when_text):'曜日・時間帯は未設定'}</div></div><div class="battle-actions"><button class="tiny-btn" data-action="go-area" data-id="${esc(a.id)}">地図</button><button class="tiny-btn" data-action="edit-area" data-id="${esc(a.id)}">編集</button><button class="tiny-btn" data-action="delete-area" data-id="${esc(a.id)}">消す</button></div></div>`).join('')||'<p class="hint">よく行くお店や公園を地図に出しておけます。</p>'}${list.length<AREA_MAX?'<button class="btn outline wide" style="margin-top:10px" data-action="add-area-map">地図で場所を選んで追加</button>':''}</div>`;
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
    return {...state.selected,name:clean($('selectedLabel').value)||state.selected.name||'選んだ場所'};
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
    $('selectedLabel').value=state.selected.name;
    $('selectedDetail').textContent=state.selected.address||`緯度 ${state.selected.lat.toFixed(5)} ・ 経度 ${state.selected.lng.toFixed(5)}`;
    $('selectedPlace').hidden=false;document.body.classList.add('place-selected');
    {const saved=Number(storage.get(CHECKIN_KEY,60));if(CHECKIN_CHOICES.includes(saved))$('checkinDuration').value=String(saved);}
    updateCheckinNote();
    updateSavedButton();
    $('areaHereButton').hidden=!(state.extras&&state.mode==='live');
    if(state.mapReady){
      state.selectedMarker?.remove();
      state.selectedMarker=L.marker([state.selected.lat,state.selected.lng],{icon:L.divIcon({className:'selected-marker',html:'<span class="selected-pin"></span>',iconSize:[32,40],iconAnchor:[16,34]})}).addTo(state.map);
      if(move)state.map.setView([state.selected.lat,state.selected.lng],16);
      requestAnimationFrame(()=>{
        updateOverlaySizes();
        // Keep the selected pin in the unobscured portion of the map.
        if(move&&isMobile())state.map.panBy([0,$('selectedPlace').offsetHeight/2],{animate:false});
      });
      setTimeout(radarScan,move?120:30);
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
  function updateCheckinNote(){return;const m=checkinMinutes();$('selectedNote').textContent=state.mode==='demo'?`「ここにいる」は選んだ地点を${minutesLabel(m)}、端末内に登録します。`:`「ここにいる」は選んだ地点を${minutesLabel(m)}、利用者に共有します。あとから停止できます。`;}
  async function registerHere() {
    const place=selectedPoint();if(!place)return;
    if(!logged())throw Error('ログインしてください');
    if(state.share||activePeople().some(p=>p.user_id===selfId()))await stopShare(true);
    const minutes=checkinMinutes();storage.set(CHECKIN_KEY,minutes);
    const token=shares.begin();state.share={token,until:Date.now()+minutes*60000,kind:'manual',privacy:'exact',phase:'locating'};
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
  function cancelPick() { const was=state.pickMode;endPick();if(was==='event')restoreEvent();else{if(was==='area')state.tab='account';setSheet(false);render();} }
  function shareSettings() { return {minutes:Number($('shareDuration')?.value||60),privacy:'exact'}; }
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
  // ---- 出没エリア ----
  function openArea(area){
    if(!state.user)throw Error('ニックネームではじめると登録できます');
    if(!area.id&&myAreas().length>=AREA_MAX)throw Error(`出没エリアは${AREA_MAX}か所までです。マイページで消してから追加してください`);
    state.areaDraft={id:area.id||'',lat:Number(area.lat),lng:Number(area.lng)};
    $('areaLabel').value=area.name&&area.name!=='地図で選んだ場所'&&area.name!=='現在地'?area.name:'';
    $('areaWhen').value=area.when_text||'';
    $('areaDialogTitle').textContent=area.id?'出没エリアを編集':'出没エリアに登録';
    $('areaSave').textContent=area.id?'変更を保存':'登録する';
    $('areaCount').textContent=area.id?'':`登録済み ${myAreas().length}/${AREA_MAX}`;
    closePlace();openModal('area');
  }
  function addAreaFromMap(){
    if(!state.mapReady)throw Error('地図が利用できません');
    if(myAreas().length>=AREA_MAX)throw Error(`出没エリアは${AREA_MAX}か所までです`);
    closePlace();state.tab='now';render();state.pickMode='area';$('pickText').textContent='出没エリアにする場所をタップ（検索も使えます）';$('pickPrompt').hidden=false;setSheet(true);
  }
  async function saveArea(){
    const d=state.areaDraft;if(!d)return;
    const name=clean($('areaLabel').value),when=clean($('areaWhen').value);
    if(!name)throw Error('場所の名前を入れてください');if(name.length>60||when.length>40)throw Error('入力できる文字数を超えています');
    const record={name,when_text:when,lat:d.lat,lng:d.lng};
    const q=d.id?state.sb.from('areas').update(record).eq('id',d.id).eq('user_id',selfId()):state.sb.from('areas').insert({...record,user_id:selfId()});
    const {error}=await q;if(error)throw Error(/3か所/.test(error.message)?'出没エリアは3か所までです':'登録できませんでした：'+error.message);
    closeModal('area');state.areaDraft=null;await loadLive();notify(d.id?'出没エリアを更新しました':'出没エリアに登録しました');
  }
  async function deleteArea(id){
    const a=myAreas().find(x=>x.id===id);if(!a)return;
    if(!await askConfirm(`「${a.name}」を出没エリアから消しますか？`,'出没エリアを消す','消す'))return;
    const {error}=await state.sb.from('areas').delete().eq('id',id).eq('user_id',selfId());if(error)throw error;await loadLive();notify('出没エリアを消しました');
  }
  // ---- 対戦記録 ----
  function battleCandidates(){
    const me=selfId(),q=clean(state.battleDraft?.query).toLowerCase().replace(/＃/g,'#');
    const valid=id=>id&&id!==me&&state.profiles.some(p=>p.id===id);
    if(q){
      const [namePart,tagPart]=q.includes('#')?[q.split('#')[0].trim(),q.split('#')[1].trim()]:[q,''];
      const digits=!tagPart&&/^\d{2,4}$/.test(namePart);
      const hit=p=>{const n=(p.display_name||'').toLowerCase(),t=p.tag||'';
        if(digits)return t.startsWith(namePart)||n.includes(namePart);
        return (!namePart||n.includes(namePart))&&(!tagPart||t.startsWith(tagPart));};
      return [{title:'検索結果',ids:state.profiles.filter(p=>p.id!==me&&hit(p)).slice(0,30).map(p=>p.id)}];
    }
    const groups=[],used=new Set();
    const add=(title,ids)=>{const list=[...new Set(ids)].filter(id=>valid(id)&&!used.has(id)).slice(0,8);list.forEach(id=>used.add(id));if(list.length)groups.push({title,ids:list});};
    const base=activePeople().find(p=>p.user_id===me)||myAreas()[0];
    const near=activePeople().filter(p=>p.user_id!==me);
    if(base)near.sort((a,b)=>meters(base,a)-meters(base,b));
    add('近くにいる人',near.map(p=>p.user_id));
    const mine=myAreas();add('同じ出没エリアの人',state.areas.filter(a=>a.user_id!==me&&mine.some(m=>meters(m,a)<800)).map(a=>a.user_id));
    add('最近対戦した人',myBattles().map(b=>battleView(b).other));
    return groups;
  }
  function renderBattleForm(){
    const d=state.battleDraft;if(!d)return;
    const box=$('battleOpponent');
    if(d.free){box.innerHTML=`<div class="field"><label for="battleFreeNick">相手のニックネーム</label><input autocomplete="off" id="battleFreeNick" maxlength="32" value="${esc(d.freeName||'')}" placeholder="例：ケイタ"></div><p class="help">自分だけのメモになります。</p><button type="button" class="linklike" data-action="battle-free">登録している人から選ぶ</button>`;}
    else if(d.opponent){box.innerHTML=`<div class="picked-opponent"><span class="avatar">${esc(initial(nameFor(d.opponent)))}</span><div><strong>${esc(fullName(d.opponent))}</strong>${profileBadges(d.opponent)}</div><button type="button" class="tiny-btn" data-action="pick-opponent" data-id="">変える</button></div>`;}
    else{
      const groups=battleCandidates();
      box.innerHTML=`<div class="field"><label for="battleSearch">対戦相手</label><input id="battleSearch" type="search" placeholder="ニックネームか #番号 で探す" autocomplete="off" value="${esc(d.query||'')}"></div><div id="battleCandidates" class="candidate-list">${candidateHTML(groups)}</div><button type="button" class="linklike" data-action="battle-free">相手がまだ登録していない</button>`;
      $('battleSearch').addEventListener('input',()=>{d.query=$('battleSearch').value;$('battleCandidates').innerHTML=candidateHTML(battleCandidates());});
    }
    document.querySelectorAll('[data-action="battle-result"]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.value===d.result)));
  }
  function candidateHTML(groups){
    return groups.map(g=>`<p class="candidate-title">${esc(g.title)}</p>${g.ids.map(id=>`<button type="button" class="candidate" data-action="pick-opponent" data-id="${esc(id)}"><span class="avatar">${esc(initial(nameFor(id)))}</span><span><strong>${esc(nameFor(id))}</strong><small>#${esc(tagFor(id)||'----')}${(()=>{const r=recordOf(id);return r.total?' ・ '+recordText(r):'';})()}</small></span></button>`).join('')}`).join('')||'<p class="hint">名前か #番号 で探してください。</p>';
  }
  function openBattle(opponent){
    if(!state.user)throw Error('ニックネームではじめると記録できます');
    state.battleDraft={opponent:opponent&&opponent!==selfId()?opponent:'',result:'',free:false,query:''};
    renderBattleForm();openModal('battle');
  }
  async function saveBattle(){
    const d=state.battleDraft;if(!d)return;
    if(d.free)d.freeName=clean($('battleFreeNick')?.value);
    if(!d.free&&!d.opponent)throw Error('対戦相手を選んでください');
    if(d.free&&!d.freeName)throw Error('相手のニックネームを入れてください');
    if(!d.result)throw Error('勝ち・負け・引き分けを選んでください');
    const record={reporter:selfId(),result:d.result,
      ...(d.free?{status:'memo',opponent:null,opponent_name:d.freeName.slice(0,32)}:{status:'pending',opponent:d.opponent,opponent_name:''})};
    const {error}=await state.sb.from('battles').insert(record);if(error)throw Error('記録できませんでした：'+error.message);
    closeModal('battle');state.battleDraft=null;await loadLive();
    notify(d.free?'メモとして記録しました':`記録しました。${nameFor(d.opponent)}さんがOKすると確定します`);
  }
  async function confirmBattle(id){
    const {error}=await state.sb.rpc('confirm_battle',{battle_id:id});if(error)throw Error('承認できませんでした');await loadLive();notify('対戦を確定しました');
  }
  async function removeBattle(id,reject){
    const b=state.battles.find(x=>x.id===id);if(!b)return;
    const ok=reject?await askConfirm(`${fullName(b.reporter)}さんが登録した対戦を「ちがう」として消しますか？`,'対戦記録を確認','ちがうので消す'):await askConfirm('この対戦記録を消しますか？確定済みの場合、相手の戦績からも消えます。','対戦記録を消す','消す');
    if(!ok)return;
    const {data,error}=await state.sb.from('battles').delete().eq('id',id).select('id');if(error)throw error;if(!data?.length)throw Error('消せませんでした');
    await loadLive();notify(reject?'記録を消しました':'対戦記録を消しました');
  }
  async function setProfile() {
    const displayName = clean($('nickField').value);
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
    const client=state.sb,userId=selfId(),revision=state.revision,request=++state.request;if(!client)return;
    const results=await Promise.all([
      client.from('profiles').select('*').limit(1000),
      client.from('positions').select('user_id,lat,lng,precision,updated_at,expires_at,kind').gt('expires_at',iso()).or(`kind.eq.checkin,updated_at.gt.${new Date(Date.now()-C.FRESH_MS).toISOString()}`).limit(1000),
      client.from('events').select('*').gt('ends_at',iso()).order('starts_at',{ascending:true}).limit(300),
      client.from('rsvps').select('event_id,user_id').limit(10000),
      state.user?client.from('reports').select('target_type,target_id,reporter').limit(10000):Promise.resolve({data:[]})
    ]);
    if(client!==state.sb||userId!==selfId()||revision!==state.revision||request!==state.request)return;
    const error=results.find(r=>r.error)?.error;if(error){setStatus('データを更新できません。通信状態と接続設定を確認してください。',true);throw error;}
    [state.profiles,state.positions,state.events,state.rsvps,state.reports]=results.map(r=>r.data||[]);
    // 出没エリア・対戦記録（DBの準備がまだなら、この機能だけ隠す）
    const extra=await Promise.all([
      client.from('areas').select('*').limit(3000),
      client.from('battles').select('*').order('played_at',{ascending:false}).limit(3000)
    ]);
    if(client!==state.sb||userId!==selfId()||request!==state.request)return;
    state.extras=!extra.some(r=>r.error);
    [state.areas,state.battles]=state.extras?extra.map(r=>r.data||[]):[[],[]];
    setStatus();noticeRequests();render();bumpAreas();
  }
  function noticeRequests(){
    if(!state.user)return;
    const ids=incomingRequests().map(b=>b.id);
    if(state.knownRequests&&ids.some(id=>!state.knownRequests.includes(id)))notify('対戦の承認リクエストが届きました（マイページ）');
    state.knownRequests=ids;
  }
  async function bumpAreas(){
    // 自分の出没エリアに「最近も使っている」しるしをつける（1日1回）
    if(state.seenBumped||!state.user||!state.extras)return;
    const old=myAreas().filter(a=>Date.now()-Date.parse(a.seen_at)>86400000);state.seenBumped=true;
    if(old.length)await state.sb.from('areas').update({seen_at:iso()}).in('id',old.map(a=>a.id)).eq('user_id',selfId());
  }
  function scheduleLoad() { clearTimeout(state.loadTimer);state.loadTimer=setTimeout(()=>loadLive().catch(e=>console.error(e)),200); }
  function startRealtime() {
    const client=state.sb;if(!client)return;
    // 前の接続を外し終えてから作り直す（同時に呼ばれても順番に処理する）
    state.rtChain=(state.rtChain||Promise.resolve()).then(()=>openRealtime(client)).catch(e=>console.error(e));
  }
  async function openRealtime(client) {
    if(client!==state.sb)return;
    await client.removeAllChannels();if(client!==state.sb)return;state.channelSeq=(state.channelSeq||0)+1;let channel=client.channel('beybe-radar-'+state.channelSeq+'-'+Date.now().toString(36));
    for(const table of state.user?['positions','events','rsvps','profiles','reports','areas','battles']:['positions','events','rsvps','profiles','areas','battles'])channel=channel.on('postgres_changes',{event:'*',schema:'public',table},scheduleLoad);
    state.channel=channel;
    channel.subscribe(status=>{if(client!==state.sb||channel!==state.channel)return;state.connected=status==='SUBSCRIBED';if(status==='SUBSCRIBED'&&/接続し直しています/.test($('connectionStatus')?.textContent||''))setStatus();if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')setStatus('接続し直しています。定期更新で情報を確認中です。');});
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
        else{try{await loadLive();startRealtime();}catch(e){render();}}
      },0);
    }).data.subscription;
    if(state.user){await ensureProfile(client,state.user);await loadLive();startRealtime();}else{state.tab='now';setStatus();try{await loadLive();startRealtime();}catch(e){render();}}
  }
  async function startAnon() {
    if(!state.sb)throw Error('接続を確認してください');
    const name=clean($('startNick').value).slice(0,32);if(!name)throw Error('ニックネームを入れてください');
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
      if(!logged()&&/^(new-event|event-here|register-here|manual-share|start-share|rsvp|report|report-reason|edit-event|delete-event|pick-map|save-spot|area-here|add-area-map|edit-area|delete-area|new-battle|confirm-battle|reject-battle|delete-battle)$/.test(action)){closePlace();endPick();state.tab='account';setSheet(isMobile());render();notify('登録や参加は、ニックネームではじめると使えます');return;}
      if(action==='confirm-no'){resolveConfirm(false);return;}if(action==='confirm-yes'){resolveConfirm(true);return;}
      await runBusy(t,async()=>{
        if(action==='new-event')newEvent();
        else if(action==='close-event'){closeModal('event');endPick();state.draft=null;}
        else if(action==='pick-map')pickEvent();else if(action==='cancel-pick')cancelPick();
        else if(action==='toggle-sheet')setSheet(!state.sheetCollapsed);
        else if(action==='show-people'||action==='show-plans'){closePlace();endPick();state.tab=action==='show-people'?'now':'plans';setSheet(false);render();}
        else if(action==='close-place')closePlace();
        else if(action==='area-here'){const p=selectedPoint();if(p)openArea(p);}
        else if(action==='add-area-map')addAreaFromMap();
        else if(action==='edit-area'){const a=myAreas().find(x=>x.id===id);if(a)openArea(a);}
        else if(action==='delete-area')await deleteArea(id);
        else if(action==='close-area'){closeModal('area');state.areaDraft=null;}
        else if(action==='go-area'){const a=state.areas.find(x=>x.id===id);if(a){mapGo(a.lat,a.lng);}}
        else if(action==='new-battle')openBattle(id);
        else if(action==='close-battle'){closeModal('battle');state.battleDraft=null;}
        else if(action==='pick-opponent'){if(state.battleDraft){state.battleDraft.opponent=id||'';renderBattleForm();}}
        else if(action==='battle-free'){if(state.battleDraft){state.battleDraft.free=!state.battleDraft.free;state.battleDraft.opponent='';renderBattleForm();}}
        else if(action==='battle-result'){if(state.battleDraft){state.battleDraft.result=t.dataset.value;renderBattleForm();}}
        else if(action==='confirm-battle')await confirmBattle(id);
        else if(action==='reject-battle')await removeBattle(id,true);
        else if(action==='delete-battle')await removeBattle(id,false);
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
      if(!['mapSearchForm','eventForm','profileForm','loginForm','startForm','areaForm','battleForm'].includes(e.target.id))return;e.preventDefault();
      runBusy(e.submitter,async()=>{
        if(e.target.id==='areaForm')await saveArea();else if(e.target.id==='battleForm')await saveBattle();else if(e.target.id==='startForm')await startAnon();else if(e.target.id==='mapSearchForm')await searchMap();else if(e.target.id==='eventForm')await saveEvent();else if(e.target.id==='profileForm')await setProfile();
        else{const email=clean($('loginEmail').value);if(!state.sb)throw Error('接続を確認してください');const redirect=location.protocol.startsWith('http')?location.origin+location.pathname:undefined;const {error}=await state.sb.auth.signInWithOtp({email,options:redirect?{emailRedirectTo:redirect}:{}});if(error)throw error;notify('ログインメールを送りました。受信箱を確認してください');}
      });
    });
    $('listSearch').addEventListener('input',()=>{state.listQueries[state.tab]=$('listSearch').value;render();});
    $('mapSearch').addEventListener('focus',()=>{if(state.selected||!$('mapEvent').hidden)closePlace();if(isMobile())setSheet(true);showSavedResults();});
    $('checkinDuration').addEventListener('change',updateCheckinNote);
    $('mapSearch').addEventListener('input',()=>{++state.mapSearchRequest;$('mapSearchResults').hidden=true;});
    document.addEventListener('pointerdown',e=>{if(!$('mapSearchPanel').contains(e.target))$('mapSearchResults').hidden=true;});
    $('selectedLabel').addEventListener('change',()=>{if(state.selected)state.selected.name=clean($('selectedLabel').value)||state.selected.name;});
    $('placeQuery').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();runBusy(document.querySelector('[data-action="search-place"]'),searchPlace);}});
    $('eventDate').addEventListener('change',()=>{if($('eventEndDate').value<$('eventDate').value)$('eventEndDate').value=$('eventDate').value;});
    for(const name of ['event','settings','confirm','report','area','battle'])$(name+'Overlay').addEventListener('click',e=>{if(e.target!==$(name+'Overlay'))return;if(name==='confirm')resolveConfirm(false);else closeModal(name);});
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
  const isTyping=el=>!!el&&(el.tagName==='TEXTAREA'||el.tagName==='SELECT'||(el.tagName==='INPUT'&&!['checkbox','radio','button','submit'].includes(el.type)));
  async function boot() {
    $('eventStadium').innerHTML=profileOptions(EVENT_STADIUM,'unset');
    attachEvents();sourceDemo();initMap();render();await updateDemo(()=>{});
    if(isMobile())setSheet(true);
    const updateViewport=()=>{
      document.documentElement.style.setProperty('--app-height',(window.visualViewport?.height||window.innerHeight)+'px');
      const active=document.activeElement;
      document.body.classList.toggle('keyboard-open',isMobile()&&isTyping(document.activeElement));
      updateOverlaySizes();state.map?.invalidateSize({pan:false});
    };
    window.addEventListener('resize',updateViewport);window.visualViewport?.addEventListener('resize',updateViewport);
    document.addEventListener('focusin',e=>{if(!isMobile()||!isTyping(e.target))return;updateViewport();setTimeout(()=>{window.scrollTo(0,0);e.target.scrollIntoView({block:'center'});},350);});
    document.addEventListener('focusout',()=>setTimeout(updateViewport,120));
    {let last=0;const sc=$('panelContent');sc.addEventListener('scroll',()=>{if(!isMobile())return;const y=sc.scrollTop,d=y-last;last=y;
      const hide=y>40&&d>0?true:(y<10||d<-8)?false:null;if(hide===null||document.body.classList.contains('scrolled-down')===hide)return;
      document.body.classList.toggle('scrolled-down',hide);setTimeout(updateViewport,0);},{passive:true});}
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
