// ベイ出没マップ API（Durable Object / SQLite に保存）
// GET    /api/bey/posts              … 終わっていない投稿の一覧（管理者キー付きなら通報数・非表示中も）
// POST   /api/bey/posts              … チェックイン・予定の登録（削除用トークンを返す）
// DELETE /api/bey/posts/:id          … 削除（本人の x-delete-token か、管理者の x-admin-key）
// POST   /api/bey/posts/:id/report   … 通報（3人から通報されると自動で非表示）
// POST   /api/bey/posts/:id/restore  … 非表示を戻す（管理者のみ）
// 管理者キーは Cloudflare のシークレット BEY_ADMIN_KEY に登録する
import { DurableObject } from "cloudflare:workers";

const HIDE_AT = 3; // この人数から通報されたら非表示
const REASONS = ["迷惑・いたずら", "個人の住所・職場", "不適切な内容", "その他"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

async function sha256(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

export class BeyStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS posts(
      id TEXT PRIMARY KEY, kind TEXT, name TEXT, comment TEXT, place TEXT,
      lat REAL, lng REAL, start INTEGER, "end" INTEGER, created INTEGER,
      token_hash TEXT, ip_hash TEXT, hidden INTEGER DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reports(
      post_id TEXT, ip_hash TEXT, reason TEXT, created INTEGER, PRIMARY KEY(post_id, ip_hash))`);
  }

  isAdmin(request) {
    const key = this.env.BEY_ADMIN_KEY;
    return !!key && request.headers.get("x-admin-key") === key;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.replace(/^\/api\/bey\/posts\/?/, "").split("/").filter(Boolean);
    const id = parts[0] ? decodeURIComponent(parts[0]) : null;
    const action = parts[1] || null;
    const now = Date.now();
    const admin = this.isAdmin(request);
    const ipHash = await sha256((request.headers.get("cf-connecting-ip") || "") + ":bey");

    // 終わった投稿は自動で消す
    this.sql.exec(`DELETE FROM reports WHERE post_id IN (SELECT id FROM posts WHERE "end" < ?)`, now - 3600e3);
    this.sql.exec(`DELETE FROM posts WHERE "end" < ?`, now - 3600e3);

    if (request.method === "GET" && !id) {
      if (url.searchParams.has("check-admin")) return json({ admin });
      const posts = this.sql.exec(
        `SELECT p.id, p.kind, p.name, p.comment, p.place, p.lat, p.lng, p.start, p."end", p.created, p.hidden,
                (SELECT COUNT(*) FROM reports r WHERE r.post_id = p.id) AS reports
         FROM posts p WHERE p."end" > ? ${admin ? "" : "AND p.hidden = 0"} ORDER BY p.start LIMIT 500`, now
      ).toArray();
      if (!admin) posts.forEach(p => { delete p.hidden; delete p.reports; });
      return json({ posts });
    }

    if (request.method === "POST" && !id) {
      let b;
      try { b = await request.json(); } catch { return json({ error: "送信内容が読めませんでした" }, 400); }
      const kind = b.kind === "plan" ? "plan" : "now";
      const name = clean(b.name, 20), comment = clean(b.comment, 120), place = clean(b.place, 40);
      const lat = Number(b.lat), lng = Number(b.lng);
      let start = Number(b.start), end = Number(b.end);
      if (!name) return json({ error: "ブレーダー名を入れてください" }, 400);
      if (!(lat >= 20 && lat <= 46 && lng >= 122 && lng <= 154)) return json({ error: "日本国内の場所を指定してください" }, 400);
      if (kind === "now") { start = now; end = Math.min(Math.max(end || 0, now + 1800e3), now + 5 * 3600e3); }
      else {
        if (!(end > now && end > start)) return json({ error: "時間を確認してください" }, 400);
        if (end - start > 12 * 3600e3) return json({ error: "予定は12時間以内にしてください" }, 400);
        if (start - now > 60 * 864e5) return json({ error: "60日先までの予定にしてください" }, 400);
      }
      // いたずら対策：同じ回線から1時間に10件まで
      const recent = this.sql.exec(`SELECT COUNT(*) AS n FROM posts WHERE ip_hash = ? AND created > ?`, ipHash, now - 3600e3).one().n;
      if (recent >= 10) return json({ error: "投稿が多すぎます。しばらくしてから試してください" }, 429);
      // 同じ人の「いまいる」は1件だけ（新しいチェックインで置きかえ）
      if (kind === "now") this.sql.exec(`DELETE FROM posts WHERE kind = 'now' AND ip_hash = ? AND name = ?`, ipHash, name);

      const newId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      const token = crypto.randomUUID();
      this.sql.exec(`INSERT INTO posts (id, kind, name, comment, place, lat, lng, start, "end", created, token_hash, ip_hash, hidden)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`,
        newId, kind, name, comment, place, Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6, start, end, now, await sha256(token), ipHash);
      return json({ id: newId, token });
    }

    if (!id) return json({ error: "not allowed" }, 405);
    const row = this.sql.exec(`SELECT token_hash, ip_hash FROM posts WHERE id = ?`, id).toArray()[0];

    if (request.method === "DELETE" && !action) {
      if (!row) return json({ ok: true });
      const token = request.headers.get("x-delete-token") || "";
      if (!admin && row.token_hash !== await sha256(token)) return json({ error: "自分の投稿だけ消せます" }, 403);
      this.sql.exec(`DELETE FROM reports WHERE post_id = ?`, id);
      this.sql.exec(`DELETE FROM posts WHERE id = ?`, id);
      return json({ ok: true });
    }

    if (request.method === "POST" && action === "report") {
      if (!row) return json({ ok: true });
      if (row.ip_hash === ipHash) return json({ error: "自分の投稿は通報できません" }, 400);
      let b = {};
      try { b = await request.json(); } catch {}
      const reason = REASONS.includes(b.reason) ? b.reason : "その他";
      this.sql.exec(`INSERT OR IGNORE INTO reports VALUES (?,?,?,?)`, id, ipHash, reason, now);
      const n = this.sql.exec(`SELECT COUNT(*) AS n FROM reports WHERE post_id = ?`, id).one().n;
      if (n >= HIDE_AT) this.sql.exec(`UPDATE posts SET hidden = 1 WHERE id = ?`, id);
      return json({ ok: true });
    }

    if (request.method === "POST" && action === "restore") {
      if (!admin) return json({ error: "管理者だけの操作です" }, 403);
      this.sql.exec(`DELETE FROM reports WHERE post_id = ?`, id);
      this.sql.exec(`UPDATE posts SET hidden = 0 WHERE id = ?`, id);
      return json({ ok: true });
    }

    return json({ error: "not allowed" }, 405);
  }
}

export function handleBeyApi(request, env) {
  const stub = env.BEY_STORE.get(env.BEY_STORE.idFromName("main"));
  return stub.fetch(request);
}
