// どこでも聖地カメラ：AI API（Cloudflare Workers 用）
//
// POST /api/seichi/info  { image:"<jpegのbase64>", genre:"青春", place:"東北沢駅前" }
//   → Claude が写真を見て、架空アニメの設定（タイトル・話数・サブタイトル・セリフ・場面・登場人物）を捏造する
//   → { ok:true, info:{ title, episode, subtitle, speaker, line, scene, cast } }
//
// POST /api/seichi/draw  { mode:"frame"|"hand", image:"<jpeg base64>", mask?:"<png base64>", w, h, style, chars, sub, line, scene, cast }
//   frame → カード部分の写真を、構図そのままアニメのワンシーンに描き直す
//   hand  → アニメのカードを貼った写真に、本物の手とカードの厚み・影を描き足す（マスクの中だけ）
//   → { ok:true, image:"data:image/jpeg;base64,..." }
//
// 必要な設定（Cloudflare のシークレット）：
//   ANTHROPIC_API_KEY … 設定の捏造（神経ド衰弱と共用）
//   OPENAI_API_KEY    … 劇中カットの絵
//   OPENAI_IMAGE_MODEL（任意）… 画像モデルを固定したいときだけ。未設定なら新しい順に試す

const CLAUDE_MODEL = "claude-sonnet-5-5";
const IMAGE_MODELS = ["gpt-image-2.6-sunburst", "gpt-image-2.6-flare", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2", "gpt-image-1"];
const MAX_B64 = 3_000_000; // 送られてくる写真の上限（だいたい2MB）

const STYLE_EN = {
  seishun: "bright clear daylight, vivid blue sky with fluffy white cumulus clouds, fresh youthful atmosphere, soft lens flare",
  yugure: "after-school golden hour, sunset sky in pink, orange and purple, warm backlight and long shadows, nostalgic mood",
  natsu: "midsummer afternoon, deep blue sky with towering cumulonimbus clouds, strong sunlight, vivid saturated colors",
  yoru: "night scene, deep navy sky with stars, glowing street lights and neon signs, soft bokeh, cinematic night lighting",
  retro: "1990s hand-painted cel animation look, slightly faded film colors, subtle film grain, soft focus",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

// 同じ人の連打をゆるく防ぐ（ワーカーのメモリ上だけの簡易版。本当の上限は OpenAI 側の予算設定で守る）
const hits = new Map();
function tooMany(ip, kind, limit, windowMs) {
  const key = kind + ":" + ip, now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= limit) { hits.set(key, list); return true; }
  list.push(now); hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

async function readBody(request) {
  if (request.method !== "POST") return [null, json({ ok: false, error: "POSTのみ" }, 405)];
  const origin = request.headers.get("Origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return [null, json({ ok: false, error: "forbidden" }, 403)];
  let body;
  try { body = await request.json(); } catch { return [null, json({ ok: false, error: "リクエストが読めません" }, 400)]; }
  const image = String(body?.image ?? "").replace(/^data:image\/\w+;base64,/, "");
  if (!image || image.length > MAX_B64 || !/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 200))) return [null, json({ ok: false, error: "写真が読めませんでした" }, 400)];
  return [{ ...body, image }, null];
}

const clip = (s, n) => [...String(s ?? "").trim()].slice(0, n).join("");

/* ---------- 設定の捏造（Claude） ---------- */
const INFO_SYSTEM = `あなたは深夜アニメの企画・脚本家です。ユーザーが撮った実在の何気ない風景写真を見て、
この場所が「聖地」として登場する架空のTVアニメを1本でっちあげます。

ルール：
- 写真に写っているもの（建物・看板・階段・手すり・道・空・植物・時間帯・天気など）を具体的に拾い、劇中の場面に結びつける。
- 実在する作品名・キャラクター名・制作会社名・実在の人物は使わない。似せない。
- タイトルは実在しそうな深夜アニメ／ライトノベル原作っぽく（8〜20字）。
- サブタイトルは話数タイトルらしく（5〜16字）。
- セリフは、この場所で発せられる一言。字幕として自然な話し言葉で30字以内。
- cast は、このカットに映る登場人物の見た目（1〜2人、髪型・服装・ポーズ）を60字以内で。健全な内容にする。
- 性的・暴力的・差別的な内容は入れない。

出力はJSONだけ（説明やコードブロックは付けない）：
{"title":"","episode":1から12の数字,"subtitle":"","speaker":"キャラの下の名前","line":"","scene":"このカットが劇中のどんな場面か（45字以内）","cast":""}`;

async function handleInfo(request, env) {
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "AIの捏造はまだ準備中です。" }, 503);
  const [body, err] = await readBody(request);
  if (err) return err;
  const ip = request.headers.get("CF-Connecting-IP") || "?";
  if (tooMany(ip, "info", 20, 10 * 60 * 1000)) return json({ ok: false, error: "少し時間をおいてから試してください。" }, 429);

  const genre = clip(body.genre || "青春", 12), place = clip(body.place || "", 40);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: CLAUDE_MODEL, max_tokens: 800, system: INFO_SYSTEM,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: body.image } },
          { type: "text", text: `ジャンル：${genre}\n撮影場所のメモ：${place || "なし"}` },
        ] }],
      }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const data = await res.json();
    const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    const s = text.indexOf("{"), e = text.lastIndexOf("}");
    const v = JSON.parse(text.slice(s, e + 1));
    return json({ ok: true, info: {
      title: clip(v.title, 30), episode: Math.min(99, Math.max(1, parseInt(v.episode) || 1)),
      subtitle: clip(v.subtitle, 24), speaker: clip(v.speaker, 10), line: clip(v.line, 40),
      scene: clip(v.scene, 60), cast: clip(v.cast, 80),
    } });
  } catch (e) {
    console.error("seichi info error", e);
    return json({ ok: false, error: "うまく捏造できませんでした。もう一度押してみてください。" }, 502);
  }
}

/* ---------- 聖地巡礼写真（GPT・2段階） ---------- */
// 段階1 frame：カードの部分だけ切り抜いた写真を、構図そのままアニメのワンシーンに描き直す
//   （位置はアプリ側でぴったり戻すので、輪郭が背景とそろう）
// 段階2 hand ：アニメのカードを貼った写真に、カードを持つ本物の手とカードの厚み・影を足す（マスクの中だけ）
function framePrompt(b) {
  const style = STYLE_EN[b.style] || STYLE_EN.seishun;
  const chars = Math.min(2, Math.max(0, parseInt(b.chars) || 0));
  const scene = clip(b.scene, 60), cast = clip(b.cast, 80), line = clip(b.line, 40);
  const people = chars === 0
    ? "No people in the frame."
    : `Add ${chars === 1 ? "one original anime character" : "two original anime characters"} naturally in the scene, standing on the ground at a believable scale` +
      (cast ? ` (${cast})` : "") + (scene ? `, in this scene: ${scene}` : "") +
      ". Completely original designs that do not resemble any existing anime character or real person, fully clothed and wholesome. Characters may overlap the background but must not change it.";
  const sub = b.sub && line
    ? `Add a TV-style Japanese subtitle at the bottom center in white text with a thin dark outline that reads exactly: 「${line}」`
    : "No text anywhere.";
  return [
    "Completely repaint this photo as a single frame (a screenshot) of a high-quality Japanese TV anime. The entire image, edge to edge, must become hand-drawn anime art: flat cel shading, clean ink outlines, simplified painted textures. No photographic texture, noise or realism may remain anywhere (walls, bricks, asphalt, poles, pipes, metal all become anime-painted).",
    "At the same time, keep exactly the same framing, camera angle, perspective and scale. Every building outline, roof line, wall edge, window, pole, pipe, wire, road edge and curb must stay at exactly the same position and size in the image, so the drawing can be laid precisely over the photo. Do not crop, zoom, shift, add or remove any structure.",
    "Small details may change freely: textures, signs, text on objects and clutter can be simplified or reinterpreted. Only the big outlines must stay in place.",
    `Style: detailed hand-painted anime background art, clean line art, cel-shaded, ${style}. The sky may be replaced with an anime sky.`,
    people, sub,
    "No logos, watermarks or user interface.",
  ].join("\n");
}
function handPrompt() {
  return [
    "This photo shows a borderless glossy printed anime still card held up in front of a real street; the picture on the card lines up with the real scene behind it.",
    "Only edit inside the transparent area of the mask, which starts right at the bottom edge of the card.",
    "Add one real human hand (natural, photorealistic skin, nails and fingers, as if the person taking the photo with a phone is holding it) gripping the bottom edge of the card from below: the tip of the thumb just touches the very bottom edge of the card from the front, the other fingers are behind the card. The palm, wrist and forearm extend down to the bottom of the frame.",
    "Do not draw any frame, border, device or second card. Do not move or redraw the card.",
    "Behind the hand, continue the real background naturally so it matches the photo. No text, logos or watermarks.",
  ].join("\n");
}

function sizeFor(model, w, h) {
  const r = Math.min(3, Math.max(1 / 3, (Number(w) || 3) / (Number(h) || 4)));
  if (model === "gpt-image-1") return r > 1.15 ? "1536x1024" : r < 0.87 ? "1024x1536" : "1024x1024";
  const r16 = (v) => Math.max(256, Math.round(v / 16) * 16);
  return r >= 1 ? `1536x${r16(1536 / r)}` : `${r16(1536 * r)}x1536`;
}

function b64ToBlob(b64, type) {
  const bin = atob(b64), buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type });
}

async function handleDraw(request, env) {
  if (!env.OPENAI_API_KEY) return json({ ok: false, error: "写真を作るAIはまだ準備中です（OPENAI_API_KEY 未登録）。" }, 503);
  const [body, err] = await readBody(request);
  if (err) return err;
  const ip = request.headers.get("CF-Connecting-IP") || "?";
  if (tooMany(ip, "draw", 14, 10 * 60 * 1000)) return json({ ok: false, error: "10分に7枚までです。少し休憩してから。" }, 429);

  const mode = body.mode === "hand" ? "hand" : "frame";
  const prompt = mode === "hand" ? handPrompt() : framePrompt(body);
  const maskB64 = String(body.mask ?? "").replace(/^data:image\/\w+;base64,/, "");
  const mask = maskB64 && maskB64.length < MAX_B64 ? b64ToBlob(maskB64, "image/png") : null;
  const models = env.OPENAI_IMAGE_MODEL ? [env.OPENAI_IMAGE_MODEL] : IMAGE_MODELS;
  let lastErr = "";
  for (const model of models) {
    const fd = new FormData();
    fd.append("model", model);
    fd.append("image", b64ToBlob(body.image, "image/jpeg"), "photo.jpg");
    if (mask) fd.append("mask", mask, "mask.png");
    fd.append("prompt", prompt);
    fd.append("size", sizeFor(model, body.w, body.h));
    fd.append("quality", "medium");
    fd.append("output_format", "jpeg");
    fd.append("output_compression", "88");
    fd.append("n", "1");
    let res, data;
    try {
      res = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: fd,
      });
      data = await res.json().catch(() => ({}));
    } catch (e) {
      console.error("seichi draw fetch error", e);
      return json({ ok: false, error: "GPTにつながりませんでした。少しあとで試してください。" }, 502);
    }
    if (res.ok && data?.data?.[0]?.b64_json) {
      return json({ ok: true, model, image: "data:image/jpeg;base64," + data.data[0].b64_json });
    }
    const msg = String(data?.error?.message || res.status);
    const code = String(data?.error?.code || "");
    console.error("seichi draw error", model, res.status, msg.slice(0, 300));
    lastErr = msg;
    // モデル名が使えない → 次のモデルへ
    if ((res.status === 400 || res.status === 404) && /model/i.test(msg) && !/verif/i.test(msg)) continue;
    if (/verif/i.test(msg)) return json({ ok: false, error: "OpenAIの「組織の本人確認」がまだ済んでいないようです。" }, 403);
    if (res.status === 401) return json({ ok: false, error: "OpenAIのAPIキーが正しくないようです。" }, 502);
    if (res.status === 429 || /quota|billing|credit/i.test(msg)) return json({ ok: false, error: "OpenAIのクレジット残高か利用上限に達しています。" }, 502);
    if (code.includes("moderation") || /safety|moderation/i.test(msg)) return json({ ok: false, error: "この写真・設定では描けませんでした。設定を変えて試してください。" }, 400);
    return json({ ok: false, error: "うまく作れませんでした。もう一度試してください。" }, 502);
  }
  console.error("seichi draw: no usable model", lastErr.slice(0, 300));
  return json({ ok: false, error: "使える画像モデルが見つかりませんでした。" }, 502);
}

export async function handleSeichiApi(request, env) {
  const p = new URL(request.url).pathname;
  if (p === "/api/seichi/info") return handleInfo(request, env);
  if (p === "/api/seichi/draw") return handleDraw(request, env);
  return new Response("Not found", { status: 404 });
}
