// Claude側で接続先を設定。どちらも公開用の値だけを指定します。
// 未設定ならブラウザ内だけで保存するデモになります。
window.BEYSPOT_CONFIG = Object.freeze({
  previewOnly: false,
  supabaseUrl: 'https://ulnuwlvayctgvifnacwt.supabase.co',
  supabasePublicKey: 'sb_publishable_PXoCtb7nHew3_bnfU1kNMA_k9DrpmVS',
  // 住所検索は小規模な動作確認向け。多数ユーザーでの運用前に配信先を変更してください。
  searchUrl: 'https://nominatim.openstreetmap.org/search',
  // CARTOの無料キー（carto.com/basemaps/apikey で取得）。入っていればCARTO Voyager、空なら国土地理院の淡色地図
  cartoKey: '',
  tileUrl: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',
  tileAttribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>'
});
