// どこでも聖地カメラEXTEND：AI API（Cloudflare Workers 用）
// 元の聖地カメラとの違い：
//   - 絵柄の縛りなし（作品ごとに絵柄をくじ引き）
//   - 主人公は毎回「麦わらカンカン帽・丸サングラス・ひげ・赤ジャージの男」で固定。必ず画面に出る
//
// POST /api/seichi-ex/info  { image:"<jpegのbase64>", genre?, place? }
//   → { ok:true, info:{ title, episode, subtitle, hero, speaker, line, scene, cast, style, card } }
// POST /api/seichi-ex/draw  { image:"<jpeg base64>", w, h, sub, line, scene, cast, hero, style }
//   → { ok:true, image:"data:image/jpeg;base64,..." }
//
// シークレットは元の聖地カメラと共用（ANTHROPIC_API_KEY / OPENAI_API_KEY）

const CLAUDE_MODEL = "claude-sonnet-5-5";
const IMAGE_MODELS = ["gpt-image-2.6-sunburst", "gpt-image-2.6-flare", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2", "gpt-image-1"];
const MAX_B64 = 3_000_000;

// 主人公の見た目（固定）。お手本写真は public/seichi-ex/hero/hero_sheet.jpg
const HERO_REF = "/seichi-ex/hero/hero_sheet.jpg";
const HERO_JA = "麦わらのカンカン帽（黒いリボン）、金ぶちの丸いサングラス、口ひげとあごひげ、肩まである黒髪、赤地に白ラインのジャージ（前を開けて黒Tシャツ）、黒いズボンの男";
const HERO_EN = "a man in his 30s with shoulder-length straight black hair, a straw boater hat (flat crown, flat brim) with a wide black band, small perfectly round dark sunglasses with thin gold wire frames, a mustache and a goatee beard, an open red track jacket with white stripes on the shoulders and sleeves over a plain black T-shirt, and black pants";

// 絵柄：縛りなし。作品ごとに雰囲気に合うものをAIが選ぶ
const STYLE_EN = {
  tv: "modern Japanese TV anime: clean line art, cel shading, bright colors, detailed painted background",
  movie: "Japanese animated feature film: richly painted detailed background, dramatic sky and lighting, cinematic composition",
  cel90: "1990s hand-painted cel animation: slightly faded film colors, subtle film grain, thick outlines",
  gekiga: "gritty seinen anime / gekiga style: heavy shadows, strong hatching, intense faces, muted colors",
  chibi: "cute comedy anime style: super-deformed proportions, big heads, bold outlines, pop bright colors",
  showa: "1970s Showa-era anime: limited color palette, hand-painted posterlike backgrounds, retro character design",
  shoujo: "shoujo anime style: soft pastel colors, sparkling atmosphere, delicate thin lines, flowers and light",
  noir: "dark noir anime: deep shadows, neon accents, rainy cinematic night mood",
  mecha: "80s-90s mecha anime: sharp angular line art, metallic shading, dramatic speed lines",
  watercolor: "gentle watercolor slice-of-life anime: soft edges, warm light, airy pastel palette",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

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
const pick = (a) => a[Math.floor(Math.random() * a.length)];

/* ---------- 設定の捏造（Claude） ---------- */
const TITLE_PATTERNS = [
  "短い名詞ひとつかふたつ（例の形：『〇〇』『〇〇と〇〇』）",
  "ラノベ風の長い文章タイトル（例の形：『〇〇したら〇〇だった件』『〇〇なのに〇〇してしまう』）",
  "カタカナ語や英単語を使った響き重視のタイトル",
  "主人公の名前やあだ名が入ったタイトル（例の形：『〇〇さんは〇〇』）",
  "セリフや呼びかけの形のタイトル（例の形：『〇〇しようよ、〇〇』）",
  "ひらがな多めの柔らかいタイトル",
  "漢字の熟語を組み合わせた硬めのタイトル",
  "数字や記号が入ったタイトル（例の形：『〇〇の365日』『〇〇×〇〇』）",
];
// 主人公は固定なので、ジャンルと「彼の役どころ」をくじ引き
const GENRE_POOL = [
  ["お仕事もの", "配達員・駅員・町工場の職人・屋台の店主など、働く男"],
  ["グルメ", "食べ歩きが生きがいの男、屋台の料理人、謎の美食家"],
  ["SF", "未来から来た調査員、時間を行き来する男、正体不明のアンドロイド"],
  ["ファンタジー", "人間界に紛れた魔法使い、異世界から来た吟遊詩人"],
  ["ミステリー", "町の探偵、元刑事のタクシー運転手、記憶をなくした男"],
  ["ホラー", "夜の路地で何かを追う霊媒師、深夜の配信者"],
  ["怪異・妖怪もの", "人に化けた狐や狸、妖怪と人をつなぐ相談屋"],
  ["家族もの", "娘に振り回される父、年の離れた兄、親戚のおじさん"],
  ["大人の恋愛", "不器用な30代、幼なじみと再会した男"],
  ["コメディ", "売れない芸人、ポンコツ発明家、商店街の名物おじさん"],
  ["バンド・音楽", "夢をあきらめない路上ラッパー、伝説のボーカル"],
  ["スポーツ", "草野球の助っ人、引退した元選手、自転車便のエース"],
  ["ホビーバトル", "ベーゴマ・独楽・カードなどのおもちゃ勝負に人生をかける男"],
  ["ロボット・メカ", "町工場で巨大ロボを作る男、ロボのパイロット"],
  ["時代もの・タイムスリップ", "昭和から来た男、現代に迷い込んだ浪人"],
  ["動物もの", "しゃべる猫の飼い主、カラスと話せる男"],
  ["任侠・アウトロー", "義理人情に厚い流れ者、元締めの用心棒"],
  ["青春", "大人になってから青春をやり直す男"],
];

const INFO_SYSTEM = `あなたは深夜アニメの企画・脚本家です。ユーザーが撮った実在の何気ない風景写真を見て、
この場所が「聖地」として登場する架空のTVアニメを1本でっちあげます。

このシリーズの主人公は毎回同じ見た目の男です：${HERO_JA}。
彼の名前は毎回「しょうたエクステンド」で固定（呼ばれ方は「しょうた」「エクステンド」などでもよい）。職業・性格・役どころは、指定されたジャンルに合わせて毎回自由に考えてよい（見た目と名前は固定）。

ルール：
- 主人公の男は、このカットに必ず登場する。cast と scene は彼を中心に書く。
- 写真に写っているもの（建物・看板・階段・手すり・道・空・植物・時間帯・天気など）を具体的に拾い、劇中の場面に結びつける。
- 実在する作品名・キャラクター名・制作会社名・実在の人物は使わない。似せない。
- 指定されたジャンルと役どころのヒントを守る。
- タイトルは実在しそうなTVアニメっぽく、指定された「タイトルの型」で（4〜24字）。写真に写っている物の名前はタイトルに入れない。物語のテーマや主人公で名付ける。
- サブタイトルは話数タイトルらしく（5〜16字）。
- role は、この作品での主人公しょうたエクステンドの役どころを16字以内で（例の形：「流しの探偵」）。主人公に別の名前は付けない。
- セリフは、この場所で発せられる一言。字幕として自然な話し言葉で30字以内。speaker はセリフを言うキャラの名前（基本は主人公の「しょうたエクステンド」）。
- cast は、このカットでの主人公のポーズ・表情・行動を60字以内で。必要なら脇役を1人だけ足してよい（その見た目もここに）。健全な内容にする。
- style は、作品の雰囲気に一番合うアニメの絵柄を次から1つ：tv（今どきのTVアニメ）／movie（劇場アニメ）／cel90（90年代セル）／gekiga（劇画）／chibi（ギャグ・デフォルメ）／showa（昭和アニメ）／shoujo（少女漫画風）／noir（ノワール・夜）／mecha（80〜90年代ロボアニメ）／watercolor（水彩の日常系）。毎回同じにならないように。
- card は、写真の中で「ここがあの場所だ」と一番わかる目印の中心。写真の幅・高さに対する0〜1の割合で。空や地面だけの場所は避ける。
- 性的・暴力的・差別的な内容は入れない。

出力はJSONだけ（説明やコードブロックは付けない）：
{"title":"","episode":1,"subtitle":"","role":"","speaker":"","line":"","scene":"このカットが劇中のどんな場面か（45字以内）","cast":"","style":"tv","card":{"x":0.5,"y":0.45}}`;

async function handleInfo(request, env) {
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "AIの捏造はまだ準備中です。" }, 503);
  const [body, err] = await readBody(request);
  if (err) return err;
  const ip = request.headers.get("CF-Connecting-IP") || "?";
  if (tooMany(ip, "exinfo", 20, 10 * 60 * 1000)) return json({ ok: false, error: "少し時間をおいてから試してください。" }, 429);

  const g = pick(GENRE_POOL);
  const genre = clip(body.genre || g[0], 20), role = body.genre ? "" : g[1], place = clip(body.place || "", 40);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: CLAUDE_MODEL, max_tokens: 800, system: INFO_SYSTEM,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: body.image } },
          { type: "text", text: `ジャンル：${genre}${role ? `\n主人公の役どころのヒント：${role}` : ""}\nタイトルの型：${pick(TITLE_PATTERNS)}\n絵柄の候補（この中から合うものを。迷ったらこれ）：${pick(Object.keys(STYLE_EN))}\n撮影場所のメモ：${place || "なし"}` },
        ] }],
      }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const data = await res.json();
    const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    const s = text.indexOf("{"), e = text.lastIndexOf("}");
    const v = JSON.parse(text.slice(s, e + 1));
    return json({ ok: true, info: {
      title: clip(v.title, 30), episode: 1 + Math.floor(Math.random() * 24),
      subtitle: clip(v.subtitle, 24), hero: "しょうたエクステンド" + (clip(v.role, 16) ? `（${clip(v.role, 16)}）` : ""), speaker: clip(v.speaker, 12) || "しょうたエクステンド", line: clip(v.line, 40),
      scene: clip(v.scene, 60), cast: clip(v.cast, 80),
      style: STYLE_EN[v.style] ? v.style : "tv",
      card: { x: Math.min(.95, Math.max(.05, Number(v.card?.x) || .5)), y: Math.min(.95, Math.max(.05, Number(v.card?.y) || .45)) },
    } });
  } catch (e) {
    console.error("seichi-ex info error", e);
    return json({ ok: false, error: "うまく捏造できませんでした。もう一度押してみてください。" }, 502);
  }
}

/* ---------- 劇中カット（GPT） ---------- */
function framePrompt(b) {
  const scene = clip(b.scene, 60), cast = clip(b.cast, 80), line = clip(b.line, 40);
  const style = STYLE_EN[b.style] || STYLE_EN.tv;
  const sub = b.sub && line
    ? `Add a TV-anime-style Japanese subtitle at the bottom center in clean white text with a thin dark outline that reads exactly: 「${line}」. Use a modest font size so the whole subtitle fits inside the frame with margins on both sides (two lines if needed); never cut it off at the edge.`
    : "No text anywhere.";
  return [
    "The first image is a photo of a real place. The second image is a reference sheet of the protagonist of this anime (three photos of the same man).",
    `Redraw the photo as a single frame (a still) of a Japanese anime. Art style: ${style}.`,
    "Keep the same framing, camera angle, perspective and scale as the photo. Buildings, roof lines, walls, windows, poles, wires, road edges and curbs stay at the same position and size, so the drawing lines up with the photo. Do not crop, zoom or shift. Small details and text on objects may be simplified.",
    `THE PROTAGONIST (named Shota Extend) MUST APPEAR in this frame, clearly visible and recognizable (not tiny, not hidden): draw the man from the reference sheet as an anime character in the art style above. He is ${HERO_EN}.`,
    "Keep his signature look exactly every time: the straw boater hat with black band, the small round dark sunglasses with gold frames, the mustache and goatee, the shoulder-length black hair and the red track jacket with white stripes over a black T-shirt. Do not draw any brand logo on the jacket.",
    `He stands on the ground at a believable scale${cast ? `. Pose and action: ${cast}` : ""}${scene ? `. Scene: ${scene}` : ""}. If the action mentions one extra character, add only that one original character; otherwise he is the only person.`,
    "Characters may overlap the background but must not change its structure. Everyone fully clothed and wholesome.",
    sub,
    "No logos, watermarks or user interface. Do not copy the backgrounds of the reference sheet.",
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
  if (tooMany(ip, "exdraw", 7, 10 * 60 * 1000)) return json({ ok: false, error: "10分に7枚までです。少し休憩してから。" }, 429);

  let ref = null;
  try {
    const r = await env.ASSETS.fetch(new Request(new URL(HERO_REF, request.url)));
    if (r.ok) ref = new Blob([await r.arrayBuffer()], { type: "image/jpeg" });
  } catch (e) { console.error("hero ref", e); }
  if (!ref) return json({ ok: false, error: "主人公のお手本が読めませんでした。" }, 500);

  const prompt = framePrompt(body);
  const models = env.OPENAI_IMAGE_MODEL ? [env.OPENAI_IMAGE_MODEL] : IMAGE_MODELS;
  let lastErr = "";
  for (const model of models) {
    const fd = new FormData();
    fd.append("model", model);
    fd.append("image[]", b64ToBlob(body.image, "image/jpeg"), "photo.jpg");
    fd.append("image[]", ref, "hero.jpg");
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
      console.error("seichi-ex draw fetch error", e);
      return json({ ok: false, error: "GPTにつながりませんでした。少しあとで試してください。" }, 502);
    }
    if (res.ok && data?.data?.[0]?.b64_json) {
      return json({ ok: true, model, image: "data:image/jpeg;base64," + data.data[0].b64_json });
    }
    const msg = String(data?.error?.message || res.status);
    const code = String(data?.error?.code || "");
    console.error("seichi-ex draw error", model, res.status, msg.slice(0, 300));
    lastErr = msg;
    if ((res.status === 400 || res.status === 404) && /model/i.test(msg) && !/verif/i.test(msg)) continue;
    if (/verif/i.test(msg)) return json({ ok: false, error: "OpenAIの「組織の本人確認」がまだ済んでいないようです。" }, 403);
    if (res.status === 401) return json({ ok: false, error: "OpenAIのAPIキーが正しくないようです。" }, 502);
    if (res.status === 429 || /quota|billing|credit/i.test(msg)) return json({ ok: false, error: "OpenAIのクレジット残高か利用上限に達しています。" }, 502);
    if (code.includes("moderation") || /safety|moderation/i.test(msg)) return json({ ok: false, error: "この写真・設定では描けませんでした。別のアニメにして試してください。" }, 400);
    return json({ ok: false, error: "うまく作れませんでした。もう一度試してください。" }, 502);
  }
  console.error("seichi-ex draw: no usable model", lastErr.slice(0, 300));
  return json({ ok: false, error: "使える画像モデルが見つかりませんでした。" }, 502);
}

export async function handleSeichiExApi(request, env) {
  const p = new URL(request.url).pathname;
  if (p === "/api/seichi-ex/info") return handleInfo(request, env);
  if (p === "/api/seichi-ex/draw") return handleDraw(request, env);
  return new Response("Not found", { status: 404 });
}
