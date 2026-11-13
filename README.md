# エクステン堂

しょうたのゲームをまとめたサイト。https://extendo.getup117.workers.dev

| 場所 | 中身 |
| --- | --- |
| `public/index.html` | サイトのトップ（ゲームの棚） |
| `public/img/` | カバー画像とシェア用画像 |
| `src/` | ワーカー（`/api/` だけ担当。神経ド衰弱のAIお題生成） |
| `public/<ゲーム名>/` | 各ゲーム（shinkei / miyanashi / pizza / tekishoku / osouji / matcha / dopagaki / koukai / tenten / ehon） |

新しいゲームは `public/` にフォルダを1つ足して、トップにカードを1枚足す。
このリポジトリに変更が入ると、Cloudflare が自動でデプロイします。

神経ド衰弱のAIお題生成には、Cloudflare のシークレット `ANTHROPIC_API_KEY`（Claude API のキー）が必要です。

サイキョウ・ロワイヤルは鑑定サーバーがあるので、別のリポジトリ（saikyo-royale）で管理しています。
