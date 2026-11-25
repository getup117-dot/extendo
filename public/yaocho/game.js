"use strict";

const byId = (id) => document.getElementById(id);
const normalize = (value) => value.normalize("NFKC").replace(/[\s。、！？!?]/gu, "").toLowerCase();
const usable = (option) => (option.from ?? 1) <= shown && shown <= option.until;
const matches = (answer, option) =>
  [option.answer, ...option.aliases].some((alias) => normalize(alias) === normalize(answer));

const TRUMP_CARDS = [
  "──と思わせておいて、司会者の手元の封筒に書かれている言葉は何でしょう？",
  "──という前置きはさておき、司会者がいま心に思い浮かべているものは何でしょう？",
  "──と読み上げたところで問題を変更します。本日の番組の「ラッキーワード」は何でしょう？",
];

let questions;
let aiEnabled = false;
let index = 0;
let shown = 1;
let busy = false;

function current() {
  return questions[index];
}

function notice(message = "") {
  byId("notice").textContent = message;
  byId("notice").hidden = !message;
}

function showPanel(panel) {
  for (const id of ["reading", "entry", "result"]) byId(id).hidden = id !== panel;
}

function readQuestion() {
  notice();
  byId("round").textContent = `第${index + 1}問 / ${questions.length}`;
  byId("question").textContent = current().lines.slice(0, shown).join("\n");
  byId("reveal").textContent = shown === current().lines.length - 1 ? "最後まで見る" : "続きを読む";
  byId("question").hidden = false;
  showPanel("reading");
}

function result(verdict, continuation, answer, rigged = false) {
  const question = current();
  byId("verdict").textContent = verdict;
  byId("completed").textContent = question.lines.slice(0, shown).concat(continuation).join("\n") + `\n\n答えは「${answer}」。`;
  byId("original").hidden = !rigged;
  byId("original").open = false;
  byId("original-text").textContent = question.lines.join("\n") + `\n\n答えは「${question.answer}」。`;
  byId("next").textContent = index + 1 === questions.length ? "最初から遊ぶ ↻" : "次の問題 →";
  byId("question").hidden = true;
  showPanel("result");
  byId("next").focus();
}

byId("reveal").addEventListener("click", () => {
  if (shown === current().lines.length - 1) {
    result("本来の正解", current().lines.slice(shown), current().answer);
  } else {
    shown += 1;
    readQuestion();
  }
});

byId("buzz").addEventListener("click", () => {
  notice();
  byId("examples").replaceChildren();
  if (!aiEnabled) {
    byId("examples").append("お試し解答 ");
    for (const branch of current().branches.filter(usable)) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = branch.answer;
      button.addEventListener("click", () => {
        byId("answer").value = branch.answer;
        byId("entry").requestSubmit();
      });
      byId("examples").append(button);
    }
  }
  showPanel("entry");
  byId("answer").focus();
});

byId("back").addEventListener("click", () => {
  readQuestion();
  byId("buzz").focus();
});

byId("next").addEventListener("click", () => {
  index = (index + 1) % questions.length;
  shown = 1;
  byId("answer").value = "";
  readQuestion();
  byId("buzz").focus();
});

// ---- 正解発表前のカットイン（待ち時間をドキドキに変える） ----
const SUSPENSE_LINES = [
  "その答えで……よろしいですね？",
  "……",
  "（じっと、あなたの目を見つめている）",
  "会場が静まりかえっています……",
  "スタッフ、準備はいいか？",
  "いやあ、勇気のある答えだ……",
  "（司会者がカンペをちらりと見る）",
  "……いきますよ。",
];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let audio;
function beep(freq, start, length, volume = 0.18, type = "sine") {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime + start;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + length);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + length);
  } catch { /* 音が出せない環境では無音で進める */ }
}
const heartbeat = () => { beep(58, 0, 0.16, 0.35); beep(52, 0.22, 0.2, 0.28); };

function setLine(text) {
  const line = byId("cutin-line");
  line.textContent = text;
  line.classList.remove("pop");
  void line.offsetWidth;
  line.classList.add("pop");
}

// 答えを受け取ってから正解を見せるまでの演出。pending（続きの文を返すPromise）が終わるまで引っぱる
async function suspense(answer, pending) {
  const cutin = byId("cutin");
  cutin.classList.remove("final");
  byId("cutin-stamp").hidden = true;
  byId("cutin-answer").textContent = answer;
  cutin.hidden = false;
  let step = 0;
  setLine(SUSPENSE_LINES[0]);
  heartbeat();
  const beat = setInterval(heartbeat, 1000);
  const talk = setInterval(() => setLine(SUSPENSE_LINES[++step % SUSPENSE_LINES.length]), 2200);
  try {
    const [continuation] = await Promise.all([pending, sleep(2600)]);
    clearInterval(talk);
    cutin.classList.add("final");
    setLine("正解は……");
    for (let i = 0; i < 10; i++) beep(140 + i * 6, i * 0.09, 0.07, 0.12, "square");
    await sleep(1300);
    byId("cutin-stamp").hidden = false;
    beep(988, 0, 0.18, 0.2, "triangle"); beep(1319, 0.14, 0.45, 0.2, "triangle");
    await sleep(900);
    return continuation;
  } finally {
    clearInterval(beat);
    clearInterval(talk);
    cutin.hidden = true;
  }
}

async function askHost(question, answer) {
  try {
    const response = await fetch("/api/yaocho/continue", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({id: question.id, shown, answer}),
    });
    const data = await response.json();
    if (!response.ok || !data.continuation) throw new Error("generation failed");
    return data.continuation;
  } catch {
    // 通信できなくても必ず正解にする（司会者の切り札）
    return TRUMP_CARDS[Math.floor(Math.random() * TRUMP_CARDS.length)];
  }
}

byId("entry").addEventListener("submit", async (event) => {
  event.preventDefault();
  const answer = byId("answer").value.trim();
  if (!answer || busy) return;
  notice();
  const question = current();
  const branch = question.branches.find((option) => usable(option) && matches(answer, option));
  if (!matches(answer, question) && !branch && !aiEnabled) {
    notice("お試し版では、表示されている解答で八百長を試せます。");
    return;
  }
  busy = true;
  for (const control of byId("entry").elements) control.disabled = true;
  try {
    if (matches(answer, question)) {
      await suspense(answer, question.lines.slice(shown));
      result("正解！", question.lines.slice(shown), question.answer);
    } else if (branch) {
      await suspense(answer, branch.continuation);
      result("正解！", branch.continuation, branch.answer, true);
    } else {
      const continuation = await suspense(answer, askHost(question, answer));
      result("正解！", continuation, answer, true);
    }
  } finally {
    busy = false;
    for (const control of byId("entry").elements) control.disabled = false;
    if (!byId("entry").hidden) byId("answer").focus();
  }
});

async function start() {
  try {
    const embedded = byId("demo-bank");
    if (embedded) {
      questions = JSON.parse(embedded.textContent);
    } else {
      const [bankResponse, configResponse] = await Promise.all([
        fetch("questions.json"),
        fetch("/api/yaocho/config").catch(() => null),
      ]);
      questions = await bankResponse.json();
      if (configResponse?.ok) {
        aiEnabled = Boolean((await configResponse.json().catch(() => ({}))).aiEnabled);
      }
    }
    if (!Array.isArray(questions) || !questions.length) throw new Error("empty question bank");
    byId("mode").textContent = aiEnabled ? "自由解答" : "お試し版";
    readQuestion();
  } catch {
    byId("question").textContent = "問題を読み込めませんでした。サーバーを起動してから開き直してください。";
  }
}
start();
