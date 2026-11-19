# Beybe Radar（/radar/）

- 公開ファイル：`public/radar/`（入口 index.html、ビルド不要）
- 接続設定：`public/radar/config.js`（previewOnly / supabaseUrl / supabasePublicKey）
- DB設定：`schema.sql` を Supabase の SQL Editor で実行（通報・管理者・招待制向けの追加分を含む）
- GPT（Codex）からの引き継ぎ文書：`README_GPT引き継ぎ.md`
- `work/` はGPT版の自動テスト。元の配置（beyspot/ が隣にある構成）を前提にしているため、実行するときはその形に置き直す

決めたこと（2026-11-19）
- 公開先はエクステン堂の /radar/、招待制（Supabase Auth で新規登録を停止し、招待メールで追加）
- 位置共有はGPT版のまま（共有中はGPSで自動更新、最大6時間、概略約500m／詳細）
- 3人から通報で自動非表示。管理者は profiles.is_admin = true
- 旧「ベイ出没マップ」（/bey/）はRadarの本番接続後に置きかえ
- （同日変更）招待制はやめて全員公開に。ログインはニックネーム入力＋Supabaseの匿名ログイン（Allow anonymous sign-ins をON）。メールは予備（画面からは外した）。Xログインは見送り
- Supabase プロジェクト：beybe-radar（ref ulnuwlvayctgvifnacwt、Tokyo）。X の Callback URL は https://ulnuwlvayctgvifnacwt.supabase.co/auth/v1/callback
