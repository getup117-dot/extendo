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

byId("entry").addEventListener("submit", async (event) => {
  event.preventDefault();
  const answer = byId("answer").value.trim();
  if (!answer || busy) return;
  notice();
  const question = current();
  if (matches(answer, question)) {
    result("正解！", question.lines.slice(shown), question.answer);
    return;
  }
  const branch = question.branches.find((option) => usable(option) && matches(answer, option));
  if (branch) {
    result("正解！", branch.continuation, branch.answer, true);
    return;
  }
  if (!aiEnabled) {
    notice("お試し版では、表示されている解答で八百長を試せます。");
    return;
  }
  busy = true;
  for (const control of byId("entry").elements) control.disabled = true;
  const lines = ["司会者が問題の続きを考えています…", "スタッフがカンペを書き直しています…", "司会者が台本をめくっています…", "ディレクターと目配せしています…", "まもなく正解が発表されます…"];
  let step = 0;
  notice(lines[0]);
  const ticker = setInterval(() => notice(lines[Math.min(++step, lines.length - 1)]), 2000);
  try {
    const response = await fetch("/api/yaocho/continue", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({id: question.id, shown, answer}),
    });
    const data = await response.json();
    if (!response.ok || !data.continuation) throw new Error("generation failed");
    notice();
    result("正解！", data.continuation, answer, true);
  } catch {
    // 通信できなくても必ず正解にする（司会者の切り札）
    notice();
    result("正解！", TRUMP_CARDS[Math.floor(Math.random() * TRUMP_CARDS.length)], answer, true);
  } finally {
    clearInterval(ticker);
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
