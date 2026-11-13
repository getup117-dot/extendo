// 神経ド衰弱：AIお題生成API（Cloudflare Workers 用）
// POST /api/shinkei/generate  { theme: "国と首都", pairs: 8 }
// → { ok:true, theme:{ name, labelA, labelB, pairs:[[a,b],...] } }
//
// 必要な設定：Cloudflare の環境変数（シークレット）に ANTHROPIC_API_KEY を入れる。
// ループ：①生成AIが作る → ②プログラムで形式・重複・詰みをチェック → ③別の役割のAIが事実確認
//         → 足りなければ作り直し（最大2回）

const MODEL = "claude-sonnet-5-5";
const MAX_ATTEMPTS = 2;
const MAX_LEN = 12;

const GEN_SYSTEM = `あなたは、神経衰弱とクイズを合体させたゲーム「神経ド衰弱」のお題を作る係です。
ユーザーがくれたテーマから、2枚1組で正解になるカードの組み合わせを作ります。

出力はJSONだけ。説明文やコードブロックは付けない。
{"ok":true,"name":"表示用のテーマ名（15文字以内）","labelA":"左のカードの種類（6文字以内）","labelB":"右のカードの種類（6文字以内）","pairs":[{"a":"...","b":"..."}]}

ルール：
- 多くの人が確かめられる、確かな事実だけを使う。少しでも自信のない組み合わせは入れない。
- a はすべて違う文字列にする。
- b は、複数の a の正解が同じなら、同じ文字列をくり返してよい。可能なら2〜3組は b を重複させる（例：同じ俳優が主演した別のドラマ）。
- どの a にとっても、正解の b はリストの中に1種類だけ。リスト内の別の b とも正解になりうる a は入れない（例：W主演、複数の答えがある問題）。
- a と b はそれぞれ${MAX_LEN}文字以内。読みがなや説明は付けない。
- 知名度の高いものから選ぶ。
- 実在の人物の事件・不祥事・病気・私生活、差別的・性的・暴力的な内容、特定の人や集団をからかう内容はお題にしない。
- テーマがそれらに当たる場合や、正解が1つに決まるペアを作れない場合は {"ok":false,"reason":"短い理由（日本語）"} だけを出力する。`;

const CHECK_SYSTEM = `あなたはクイズの事実確認係です。別の担当者が作った、2枚1組のクイズカードのリストを厳しく確認します。
次のどれかに当たるペアの番号をすべて挙げてください。
1. 事実として間違っている、または確信が持てない
2. a が、リスト内の別の b とも正解になってしまう
3. 実在の人物の事件・不祥事・私生活、差別的・性的・暴力的な内容を含む
出力はJSONだけ：{"bad":[番号,...]}　問題がなければ {"bad":[]}`;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function callClaude(env, system, user, maxTokens = 2000) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Claude API ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e < s) throw new Error("JSONが返ってこなかった");
  return JSON.parse(text.slice(s, e + 1));
}

// 「どの順番で取っても詰まない」かのチェック（ゲーム側と同じ考え方）
function isSolvable(pairs) {
  const rel = new Set(pairs.map((p) => p[0] + "\u0000" + p[1]));
  const parent = {};
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  pairs.forEach((p) => { parent["A:" + p[0]] = "A:" + p[0]; parent["B:" + p[1]] = "B:" + p[1]; });
  const uA = [...new Set(pairs.map((p) => p[0]))], uB = [...new Set(pairs.map((p) => p[1]))];
  uA.forEach((a) => uB.forEach((b) => { if (rel.has(a + "\u0000" + b)) parent[find("A:" + a)] = find("B:" + b); }));
  const g = {};
  pairs.forEach((p) => {
    const r = find("A:" + p[0]);
    (g[r] ||= { a: new Set(), b: new Set(), n: 0 }); g[r].a.add(p[0]); g[r].b.add(p[1]); g[r].n++;
  });
  return Object.values(g).every((gr) => [...gr.a].every((a) => [...gr.b].every((b) => rel.has(a + "\u0000" + b))));
}

function cleanPairs(raw) {
  const seen = new Set();
  const out = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    const a = String(p?.a ?? "").trim(), b = String(p?.b ?? "").trim();
    if (!a || !b || a === b) continue;
    if ([...a].length > MAX_LEN || [...b].length > MAX_LEN) continue;
    if (seen.has(a)) continue;
    seen.add(a);
    out.push([a, b]);
  }
  return out;
}

export async function handleShinkeiApi(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "POSTのみ" }, 405);

  // よそのサイトから勝手に使われないように、同じサイトからの呼び出しだけ受け付ける
  const origin = request.headers.get("Origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ ok: false, error: "forbidden" }, 403);
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "AI生成はまだ準備中です。" }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "リクエストが読めません" }, 400); }
  const theme = String(body?.theme ?? "").trim();
  const need = Math.min(10, Math.max(4, Number(body?.pairs) || 8));
  if (!theme || [...theme].length > 30) return json({ ok: false, error: "テーマは30文字以内で入力してください。" }, 400);

  const ask = need + 5; // 事実確認で削られる分を見込んで多めに作る
  let lastReason = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // ① 生成
      const gen = await callClaude(env, GEN_SYSTEM, `テーマ：${theme}\n作るペアの数：${ask}組`);
      if (!gen.ok) return json({ ok: false, error: gen.reason || "このテーマでは作れませんでした。" });
      let pairs = cleanPairs(gen.pairs);

      // ③ 別の役割のAIで事実確認
      const list = pairs.map((p, i) => `${i + 1}. a「${p[0]}」 b「${p[1]}」`).join("\n");
      const chk = await callClaude(env, CHECK_SYSTEM, `テーマ：${theme}\n左の種類：${gen.labelA} / 右の種類：${gen.labelB}\n${list}`, 500);
      const bad = new Set((chk.bad || []).map((n) => Number(n) - 1));
      pairs = pairs.filter((_, i) => !bad.has(i));

      // ② プログラムでチェック
      if (pairs.length < need) { lastReason = "確かなカードが足りませんでした。"; continue; }
      if (!isSolvable(pairs)) { lastReason = "うまく組めないカードがありました。"; continue; }

      return json({
        ok: true,
        theme: {
          name: String(gen.name || theme).slice(0, 15),
          labelA: String(gen.labelA || "お題").slice(0, 6),
          labelB: String(gen.labelB || "答え").slice(0, 6),
          pairs,
        },
      });
    } catch (err) {
      console.error("shinkei generate error", err);
      lastReason = "AIの調子が悪いみたいです。少しあとで試してください。";
    }
  }
  return json({ ok: false, error: lastReason || "お題を作れませんでした。別のテーマで試してください。" });
}
