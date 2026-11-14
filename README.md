# エクステン堂

しょうたのゲームをまとめたサイト。https://extendo.getup117.workers.dev

| 場所 | 中身 |
| --- | --- |
| `public/index.html` | サイトのトップ（ゲームの棚） |
| `public/img/` | カバー画像とシェア用画像 |
| `src/` | ワーカー（`/api/` だけ担当。神経ド衰弱のAIお題生成、聖地カメラのAI） |
| `public/<ゲーム名>/` | 各ゲーム（seichi / shinkei / miyanashi / pizza / tekishoku / osouji / matcha / dopagaki / koukai / tenten / ehon） |

新しいゲームは `public/` にフォルダを1つ足して、トップにカードを1枚足す。
このリポジトリに変更が入ると、Cloudflare が自動でデプロイします。

神経ド衰弱のAIお題生成には、Cloudflare のシークレット `ANTHROPIC_API_KEY`（Claude API のキー）が必要です。

どこでも聖地カメラ（`/seichi/`）は2つのAIを使います。
- 架空アニメの設定の捏造：`ANTHROPIC_API_KEY`（神経ド衰弱と共用）
- 聖地巡礼写真の生成：`OPENAI_API_KEY`（OpenAI の API キー。画像モデルは組織の本人確認が必要）
  画像モデルを固定したいときは、変数 `OPENAI_IMAGE_MODEL` にモデル名を入れる。

サイキョウ・ロワイヤルは鑑定サーバーがあるので、別のリポジトリ（saikyo-royale）で管理しています。
