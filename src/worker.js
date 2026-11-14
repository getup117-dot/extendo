// エクステン堂のワーカー
// ふだんは public フォルダのページをそのまま返す。/api/ で始まる道だけ、ここでプログラムを動かす。
import { handleShinkeiApi } from "./shinkei-api.js";
import { handleSeichiApi } from "./seichi-api.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/shinkei/generate") return handleShinkeiApi(request, env);
    if (url.pathname.startsWith("/api/seichi/")) return handleSeichiApi(request, env);
    if (url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
