# エクステン堂

しょうたのゲームをまとめたサイト。https://extendo.getup117.workers.dev

| 場所 | 中身 |
| --- | --- |
| `public/index.html` | サイトのトップ（ゲームの棚） |
| `public/img/` | カバー画像とシェア用画像 |
| `public/<ゲーム名>/` | 各ゲーム（miyanashi / pizza / tekishoku / osouji / matcha / dopagaki / koukai / tenten / ehon） |

新しいゲームは `public/` にフォルダを1つ足して、トップにカードを1枚足す。
このリポジトリに変更が入ると、Cloudflare が自動でデプロイします。

サイキョウ・ロワイヤルは鑑定サーバーがあるので、別のリポジトリ（saikyo-royale）で管理しています。
