const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {Window} = require('happy-dom');

// Use the bundled application and Leaflet's normal DOM event handlers.
module.exports = async function checkMapActions() {
  const window = new Window({url:'http://localhost:8765/',width:390,height:844,settings:{
    enableJavaScriptEvaluation:false,disableJavaScriptFileLoading:true,
    disableCSSFileLoading:true,disableIframePageLoading:true
  }});
  const doc = window.document;
  const byId = id => doc.getElementById(id);
  const click = async selector => {
    const target = doc.querySelector(selector);
    assert.ok(target, selector);
    target.click();
    await new Promise(setImmediate);
  };
  const input = (id, value) => {
    const field = byId(id);
    field.value = value;
    field.dispatchEvent(new window.Event('input',{bubbles:true}));
  };
  const saved = () => JSON.parse(window.localStorage.getItem('beybe-radar-demo-v1'));
  const checks = [];
  try {
    doc.write(fs.readFileSync(path.join(__dirname,'../outputs/Beybe_Radar_preview.html'),'utf8'));
    for (const script of doc.querySelectorAll('script:not([type])')) window.eval(script.textContent);
    await new Promise(setImmediate);

    await click('#map');
    assert.equal(byId('selectedPlace').hidden,false);
    await click('#selectedName');
    assert.equal(byId('selectedPlace').hidden,false);
    input('selectedName','待ち合わせ会場');
    await click('#saveSpotButton');
    const spots = JSON.parse(window.localStorage.getItem('beybe-radar-saved-places-v1:demo-me'));
    assert.equal(spots[0].name,'待ち合わせ会場');
    checks.push('地図タップ、地点名編集、保存');

    await click('.mobile-nav [data-tab="account"]');
    input('displayName','レーダーテスト');
    byId('stadiumStatus').value='store';
    byId('rankLevel').value='silver';
    byId('battleReady').value='yes';
    await click('#profileForm button[type="submit"]');
    const profile = saved().profiles.find(p=>p.id==='demo-me');
    assert.deepEqual([profile.display_name,profile.stadium_status,profile.rank_level],['レーダーテスト','store','silver']);
    assert.equal(profile.battle_ready,true);
    assert.match(byId('toast').textContent,/プロフィールを保存/);
    await click('.mobile-nav [data-tab="now"]');
    await click('#map');
    await click('[data-action="register-here"]');
    assert.ok(doc.querySelector('[aria-label="現在地：レーダーテスト（対戦歓迎）"] .is-ready'));
    await click('.mobile-nav [data-tab="account"]');
    await click('[data-action="stop-share"]');
    checks.push('プロフィールの保存ボタンで3項目が永続化');

    await click('.mobile-nav [data-tab="plans"]');
    input('listSearch','秋葉原');
    assert.equal(doc.querySelectorAll('.event-card').length,1);
    await click('[data-action="show-people"]');
    assert.equal(doc.querySelectorAll('.person-card').length,3);
    assert.equal(byId('listSearch').value,'');
    await click('[data-action="show-plans"]');
    assert.equal(byId('listSearch').value,'秋葉原');
    checks.push('予定と人の検索条件が独立');

    await click('.mobile-nav [data-tab="now"]');
    await click('[aria-label="出没予定：秋葉原でフリーバトル"]');
    assert.equal(byId('mapEvent').hidden,false);
    assert.match(byId('mapEventNote').textContent,/初心者歓迎/);
    assert.match(byId('mapEventBadges').textContent,/シルバー/);
    assert.equal(byId('mapEventAction').textContent,'参加する');
    await click('#mapEventAction');
    assert.equal(byId('mapEvent').hidden,false);
    assert.equal(byId('mapEventAction').textContent,'参加を取り消す');
    assert.match(byId('mapEventCount').textContent,/2人/);
    assert.ok(saved().rsvps.some(r=>r.user_id==='demo-me' && r.event_id==='sample-event-1'));
    await click('[data-action="show-plans"]');
    assert.match(doc.querySelector('.event-card [data-action="rsvp"]').textContent,/参加予定/);
    await click('.event-card [data-action="go-event"]');
    await click('#mapEventAction');
    assert.equal(byId('mapEventAction').textContent,'参加する');
    assert.match(byId('mapEventCount').textContent,/1人/);
    assert.equal(saved().rsvps.length,0);
    checks.push('実際の予定ピンから参加・一覧に同期・取り消し');
    await click('[data-action="show-plans"]');
    input('listSearch','');
    await click('[data-filter="today"]');
    assert.match(byId('panelContent').textContent,/初心者歓迎のフリーバトル/);
    await click('[aria-label="出没予定：初心者歓迎のフリーバトル"]');
    assert.match(byId('mapEventStadium').textContent,/店舗のものを使う/);
    await click('#mapEvent [data-action="close-place"]');
    await click('#map');
    await click('[data-action="event-here"]');
    input('eventTitle','持参の募集テスト');
    byId('eventStadium').value='wanted';
    await click('#eventSave');
    const entry=saved().events.find(event=>event.title==='持参の募集テスト');
    assert.equal(entry.stadium_plan,'wanted');
    await click('[aria-label="出没予定：持参の募集テスト"]');
    assert.match(byId('mapEventStadium').textContent,/持参できる人を募集/);
    await click('#mapEventAction');
    assert.equal(byId('eventStadium').value,'wanted');
    checks.push('今日のデモと当日のスタジアムを作成・地図・編集で確認');
    return checks;
  } finally {
    await window.happyDOM.abort();
    window.close();
  }
};
