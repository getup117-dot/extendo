// エクステン堂のワーカー
// ふだんは public フォルダのページをそのまま返す。/api/ で始まる道だけ、ここでプログラムを動かす。
import { handleShinkeiApi } from "./shinkei-api.js";
import { handleSeichiApi } from "./seichi-api.js";
import { handleSeichiExApi } from "./seichi-ex-api.js";
import { handleBeyApi } from "./bey-api.js";
export { BeyStore } from "./bey-api.js"; // ベイ出没マップの投稿を保存する場所

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/shinkei/generate") return handleShinkeiApi(request, env);
    if (url.pathname.startsWith("/api/seichi-ex/")) return handleSeichiExApi(request, env);
    if (url.pathname.startsWith("/api/seichi/")) return handleSeichiApi(request, env);
    if (url.pathname.startsWith("/api/bey/")) return handleBeyApi(request, env);
    if (url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
