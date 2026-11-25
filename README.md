# エクステン堂

しょうたのゲームをまとめたサイト。https://extendo.getup117.workers.dev

| 場所 | 中身 |
| --- | --- |
| `public/index.html` | サイトのトップ（ゲームの棚） |
| `public/img/` | カバー画像とシェア用画像 |
| `src/` | ワーカー（`/api/` だけ担当。神経ド衰弱のAIお題生成、聖地巡礼スナップのAI） |
| `public/<ゲーム名>/` | 各ゲーム（yaocho / ningen / seichi / shinkei / miyanashi / pizza / tekishoku / osouji / matcha / dopagaki / koukai / tenten / ehon） |

新しいゲームは `public/` にフォルダを1つ足して、トップにカードを1枚足す。
このリポジトリに変更が入ると、Cloudflare が自動でデプロイします。

神経ド衰弱のAIお題生成には、Cloudflare のシークレット `ANTHROPIC_API_KEY`（Claude API のキー）が必要です。

八百長クイズ（`/yaocho/`）の自由解答も `ANTHROPIC_API_KEY` を共用します（`src/yaocho-api.js`）。
問題集は `public/yaocho/questions.json`。分岐の `from`〜`until` は、その答えが使える公開行数の範囲（`from` は省略すると1）。
どんな答えでも必ず正解にする。AIはまず自然な「続き」を書き、別の役割のAIが事実・正解・つながりを審査する。同時に「強引モード」（短く強引に、うそはNG）も作り、先に合格した方を使う。12秒を超えたら、それでもだめなら「司会者の切り札」（封筒の言葉は何でしょう？などの定型文）で正解にする。

どこでも聖地巡礼スナップ（`/seichi/`）は2つのAIを使います。
- 架空アニメの設定の捏造：`ANTHROPIC_API_KEY`（神経ド衰弱と共用）
- 聖地巡礼写真の生成：`OPENAI_API_KEY`（OpenAI の API キー。画像モデルは組織の本人確認が必要）
  画像モデルを固定したいときは、変数 `OPENAI_IMAGE_MODEL` にモデル名を入れる。

サイキョウ・ロワイヤルは鑑定サーバーがあるので、別のリポジトリ（saikyo-royale）で管理しています。

## 私は人間です。の台本シート

台詞はすべて Claude の Sheets「『私は人間です。』台本シート」（https://claude.ai/artifact/CxgPWDcZTypL2NaDjWyZ49）に書き出してある。
しょうたが「直した文」「メモ」列に書き込み、「台本シート反映して」と頼んだら：

1. シートの「台本」を読み、「直した文」か「メモ」が入っている行を集める。
2. `public/ningen/index.html` の中で、その行の「いまの文」と完全に一致する文字列（' か ` で囲まれた部分）を探して置き換える。改行は「\n」、表示上の「／」区切りは元の書き方に合わせる。`${…}` や `<b>` は残す。
3. 「削除」は台詞の配列から外す。メモだけの行は指示に沿って書き直す。
4. 通しで遊べるか確かめてからコミット。反映した行の「いまの文」を新しい文に、「直した文」を空に戻す。

`tools/ningen-daihon-extract.py` は index.html から台詞を抜き出す（シートを作り直すとき用）。

### 前半の2件（田中・アイ）のオン／オフ
`public/ningen/index.html` の `const USE_PRELUDE = false;` を `true` にすると、律の前に2件の検査が入る。データ（P1/P2）と処理は残してあるので、この1行だけで切り替わる。
オフのままでも、URLの末尾に `#cases` を付ければ2件つきで遊べる（確認用）。
