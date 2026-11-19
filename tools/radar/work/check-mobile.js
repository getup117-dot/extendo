const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {Window} = require('happy-dom');

module.exports = async function checkMobile() {
  const root=path.resolve(__dirname,'..'), checks=[];
  const window=new Window({url:'http://localhost:8765/',width:390,height:844,settings:{enableJavaScriptEvaluation:false,disableJavaScriptFileLoading:true,disableCSSFileLoading:true,disableIframePageLoading:true}});
  const document=window.document;
  document.write(fs.readFileSync(path.join(root,'beyspot/index.html'),'utf8'));
  window.BEYSPOT_CONFIG={previewOnly:true};
  window.localStorage.setItem('beybe-radar-demo-v1', JSON.stringify({
    profiles: [
      {id:'sample1',display_name:'カイ'},
      {id:'sample2',display_name:'コマ好き'},
      {id:'sample3',display_name:'Xブレーダー'},
      {id:'demo-me',display_name:'以前の名前'}
    ],
    positions:[], events:[], rsvps:[]
  }));
  let clock=Date.now(), requests=0;
  window.Date=class extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
  window.setInterval=()=>1;window.requestAnimationFrame=fn=>{fn(clock);return 1;};
  const map={handlers:{},setView(p){this.center=p;return this;},flyTo(p){this.center=p;return this;},on(name,fn){this.handlers[name]=fn;return this;},invalidateSize(){},panBy(){}};
  const tiles={addTo(){return this;},on(){return this;}};
  let tileURL='';
  const popups=[];
  window.L={map:()=>map,tileLayer:url=>{tileURL=url;return tiles;},control:{zoom:()=>({addTo(){}})},divIcon:options=>options,marker:()=>({addTo(){return this;},bindPopup(html){popups.push(html);return this;},getElement(){return null;},on(){return this;},remove(){}})};
  window.fetch=async url=>{requests++;const q=new URL(url).searchParams.get('q');if(q==='通信失敗')throw Error('offline');return {ok:true,json:async()=>[{lat:'35.6903',lon:'139.7005',name:'新宿駅',display_name:'新宿駅, 新宿区, 東京都, 日本'}]};};
  for(const name of ['core.js','app.js'])window.eval(fs.readFileSync(path.join(root,'beyspot',name),'utf8'));
  const flush=async()=>{clock+=1500;for(let i=0;i<4;i++)await new Promise(setImmediate);};
  const click=async selector=>{const el=document.querySelector(selector);assert.ok(el,'Missing '+selector);el.click();await flush();};
  const submit=async id=>{const form=document.getElementById(id);form.dispatchEvent(new window.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:form.querySelector('button[type="submit"]')}));await flush();};
  const input=(id,value)=>{const el=document.getElementById(id);el.value=value;el.dispatchEvent(new window.Event('input',{bubbles:true}));};
  try {
    await flush();
    assert.equal(document.querySelector('.side').classList.contains('collapsed'),true);
    assert.equal(document.querySelector('.mobile-nav [data-tab="now"]').classList.contains('active'),true);
    assert.match(tileURL,/tile\.openstreetmap\.org/);
    checks.push('スマホでは地図を主役にして起動・実際の地図配信先を使用');
    const migrated=JSON.parse(window.localStorage.getItem('beybe-radar-demo-v1'));
    const oldProfile=migrated.profiles.find(profile=>profile.id==='demo-me');
    assert.equal(oldProfile.display_name,'以前の名前');
    assert.equal(oldProfile.stadium_status,'unset');
    assert.equal(oldProfile.rank_level,'unset');
    assert.match(popups.find(html=>html.includes('カイ')),/持っている/);
    assert.match(popups.find(html=>html.includes('カイ')),/シルバー/);
    checks.push('旧データのニックネームを保持し、新しい項目は未設定から開始');
    await click('.mobile-nav [data-tab="account"]');
    assert.equal(document.getElementById('stadiumStatus').value,'unset');
    assert.equal(document.getElementById('rankLevel').value,'unset');
    for(const stadium of ['owned','not_owned','store']) {
      document.getElementById('stadiumStatus').value=stadium;
      document.getElementById('rankLevel').value='gold';
      await submit('profileForm');
      const savedProfile=JSON.parse(window.localStorage.getItem('beybe-radar-demo-v1')).profiles.find(profile=>profile.id==='demo-me');
      assert.equal(savedProfile.stadium_status,stadium);
      assert.equal(savedProfile.rank_level,'gold');
    }
    await click('.mobile-nav [data-tab="now"]');
    checks.push('スタジアムの3択と仮ランクをプロフィールに保存');
    input('mapSearch','新宿駅');await submit('mapSearchForm');
    assert.match(document.getElementById('mapSearchResults').textContent,/新宿駅/);
    await click('[data-action="select-map-place"]');
    assert.equal(document.getElementById('selectedPlace').hidden,false);
    assert.equal(document.getElementById('selectedName').value,'新宿駅');
    assert.deepEqual(Array.from(map.center),[35.6903,139.7005]);
    checks.push('場所検索の結果を選び、地図と地点カードに反映');
    await click('[data-action="save-spot"]');
    const saved=JSON.parse(window.localStorage.getItem('beybe-radar-saved-places-v1:demo-me'));
    assert.equal(saved[0].name,'新宿駅');
    await click('[data-action="register-here"]');
    const demo=JSON.parse(window.localStorage.getItem('beybe-radar-demo-v1'));
    const own=demo.positions.find(p=>p.user_id==='demo-me');
    assert.ok(own);assert.equal(own.precision,'approx');assert.notEqual(own.lat,35.6903);
    assert.equal(requests,1);
    checks.push('デモでも地点登録が成功・概略位置だけを端末内に保存');
    await click('[data-action="show-people"]');
    const personCard=[...document.querySelectorAll('.person-card')].find(card=>card.textContent.includes('以前の名前'));
    assert.match(personCard.textContent,/店舗のものを使う/);
    assert.match(personCard.textContent,/ゴールド/);
    const ownPopup=popups.findLast(html=>html.includes('以前の名前'));
    assert.match(ownPopup,/店舗のものを使う/);
    assert.match(ownPopup,/ゴールド/);
    checks.push('人の一覧と地図の吹き出しにスタジアムとランクを反映');
    await click('.mobile-nav [data-tab="account"]');
    assert.match(document.querySelector('.saved-places').textContent,/新宿駅/);
    await click('[data-action="open-saved"]');
    assert.equal(document.getElementById('selectedName').value,'新宿駅');
    await click('[data-action="event-here"]');
    assert.equal(document.getElementById('eventPlace').value,'新宿駅');
    input('eventTitle','モバイル操作のテスト予定');await submit('eventForm');
    assert.equal(document.getElementById('eventOverlay').classList.contains('open'),false);
    assert.match(document.getElementById('panelContent').textContent,/モバイル操作のテスト予定/);
    checks.push('保存した場所を再表示し、位置を引き継いで出没予定を登録');
    const ownEvent=[...document.querySelectorAll('.event-card')].find(card=>card.textContent.includes('モバイル操作のテスト予定'));
    assert.match(ownEvent.querySelector('.host-profile').textContent,/店舗のものを使う/);
    assert.match(ownEvent.querySelector('.host-profile').textContent,/ゴールド/);
    const eventCard=[...document.querySelectorAll('.event-card')].find(card=>card.textContent.includes('秋葉原でフリーバトル'));
    eventCard.querySelector('[data-action="rsvp"]').click();await flush();
    const details=document.querySelector('[data-event-participants="sample-event-1"]');
    assert.match(details.textContent,/店舗のものを使う/);
    assert.match(details.textContent,/ゴールド/);
    details.open=true;
    input('listSearch','秋葉原');await flush();
    assert.equal(document.querySelector('[data-event-participants="sample-event-1"]').open,true);
    input('listSearch','');await flush();
    checks.push('予定の主催者と参加者の情報を表示し、更新後も参加者欄の開閉を維持');
    await click('.mobile-nav [data-tab="now"]');
    await map.handlers.click({latlng:{lat:35.66,lng:139.66}});await flush();
    assert.equal(document.getElementById('selectedPlace').hidden,false);
    assert.match(document.getElementById('selectedDetail').textContent,/35.66000/);
    checks.push('地図タップからも地点を選択できる');
    input('mapSearch','通信失敗');await submit('mapSearchForm');
    assert.match(document.getElementById('mapSearchResults').textContent,/地図をタップ/);
    checks.push('検索通信が失敗したときに地図タップを案内');
    await click('.mobile-nav [data-tab="account"]');
    await click('[data-action="stop-share"]');
    const after=JSON.parse(window.localStorage.getItem('beybe-radar-demo-v1'));
    assert.equal(after.positions.some(p=>p.user_id==='demo-me'),false);
    checks.push('登録した現在地を停止・削除できる');
    return checks;
  } finally { await window.happyDOM.abort(); window.close(); }
};
