// Claude側で接続先を設定。どちらも公開用の値だけを指定します。
// 未設定ならブラウザ内だけで保存するデモになります。
window.BEYSPOT_CONFIG = Object.freeze({
  previewOnly: true,
  supabaseUrl: '',
  supabasePublicKey: '',
  // 住所検索は小規模な動作確認向け。多数ユーザーでの運用前に配信先を変更してください。
  searchUrl: 'https://nominatim.openstreetmap.org/search',
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
});
