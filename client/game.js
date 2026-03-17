/**
 * TYPE//NET — game.js
 * Typing game dùng từ vựng CNTT, giao tiếp server qua HTTP/3
 *
 * HTTP/3 được dùng ở:
 *   POST /submit-score  — gửi điểm sau mỗi ván
 *   GET  /leaderboard   — lấy bảng xếp hạng
 */

// ── CONFIG ──────────────────────────────────────────────
const SERVER_BASE = window.location.origin;
const GAME_DURATION = 60; // giây

// ── TỪ VỰNG CNTT ────────────────────────────────────────
// Phân theo chủ đề để hiển thị category
const WORD_BANK = [
  // Networking & HTTP
  { word: "quic", cat: "PROTOCOL" },
  { word: "http", cat: "PROTOCOL" },
  { word: "https", cat: "PROTOCOL" },
  { word: "latency", cat: "NETWORK" },
  { word: "bandwidth", cat: "NETWORK" },
  { word: "packet", cat: "NETWORK" },
  { word: "handshake", cat: "NETWORK" },
  { word: "multiplexing", cat: "HTTP/3" },
  { word: "stream", cat: "HTTP/3" },
  { word: "udp", cat: "PROTOCOL" },
  { word: "tcp", cat: "PROTOCOL" },
  { word: "tls", cat: "SECURITY" },
  { word: "encryption", cat: "SECURITY" },
  { word: "certificate", cat: "SECURITY" },
  { word: "firewall", cat: "NETWORK" },
  { word: "router", cat: "NETWORK" },
  { word: "subnet", cat: "NETWORK" },
  { word: "dns", cat: "NETWORK" },
  { word: "ip", cat: "NETWORK" },
  { word: "port", cat: "NETWORK" },
  // Programming
  { word: "function", cat: "CODE" },
  { word: "variable", cat: "CODE" },
  { word: "algorithm", cat: "CODE" },
  { word: "database", cat: "DATA" },
  { word: "server", cat: "INFRA" },
  { word: "client", cat: "INFRA" },
  { word: "endpoint", cat: "API" },
  { word: "request", cat: "API" },
  { word: "response", cat: "API" },
  { word: "json", cat: "DATA" },
  { word: "api", cat: "API" },
  { word: "rest", cat: "API" },
  { word: "fetch", cat: "CODE" },
  { word: "async", cat: "CODE" },
  { word: "callback", cat: "CODE" },
  { word: "promise", cat: "CODE" },
  { word: "debug", cat: "CODE" },
  { word: "compiler", cat: "CODE" },
  { word: "runtime", cat: "CODE" },
  { word: "framework", cat: "CODE" },
  // Security & Crypto
  { word: "hashing", cat: "SECURITY" },
  { word: "token", cat: "SECURITY" },
  { word: "session", cat: "SECURITY" },
  { word: "cookie", cat: "WEB" },
  { word: "cors", cat: "WEB" },
  { word: "cache", cat: "WEB" },
  { word: "proxy", cat: "NETWORK" },
  { word: "cdn", cat: "INFRA" },
  { word: "load", cat: "INFRA" },
  { word: "deploy", cat: "INFRA" },
  // OS & Hardware
  { word: "kernel", cat: "OS" },
  { word: "process", cat: "OS" },
  { word: "thread", cat: "OS" },
  { word: "memory", cat: "HARDWARE" },
  { word: "cpu", cat: "HARDWARE" },
  { word: "buffer", cat: "OS" },
  { word: "socket", cat: "NETWORK" },
  { word: "interrupt", cat: "OS" },
  { word: "binary", cat: "DATA" },
  { word: "byte", cat: "DATA" },
];

// ── STATE ────────────────────────────────────────────────
let score = 0;
let timeLeft = GAME_DURATION;
let timerInterval = null;
let playerName = "";
let gameRunning = false;
let wordQueue = []; // hàng đợi từ
let totalTyped = 0; // tổng số từ đã gõ (đúng + sai)
let correctWords = 0; // từ gõ đúng
let streamId = 1;

// ── DOM ──────────────────────────────────────────────────
const playerSetup = document.getElementById("playerSetup");
const gameArea = document.getElementById("gameArea");
const resultScreen = document.getElementById("resultScreen");
const playerNameEl = document.getElementById("playerName");
const scoreDisplay = document.getElementById("scoreDisplay");
const timerDisplay = document.getElementById("timerDisplay");
const wpmDisplay = document.getElementById("wpmDisplay");
const accDisplay = document.getElementById("accDisplay");
const currentWord = document.getElementById("currentWord");
const wordCat = document.getElementById("wordCategory");
const typingInput = document.getElementById("typingInput");
const wordQueueEl = document.getElementById("wordQueue");
const feedItems = document.getElementById("feedItems");
const lbList = document.getElementById("lbList");
const finalScore = document.getElementById("finalScore");
const finalWpm = document.getElementById("finalWpm");
const finalAcc = document.getElementById("finalAcc");
const httpStep1 = document.getElementById("httpStep1");
const httpStep2 = document.getElementById("httpStep2");
const httpStep3 = document.getElementById("httpStep3");

// ── UTILS ────────────────────────────────────────────────
function nextStreamId() {
  const id = streamId;
  streamId += 4;
  return id;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function logPacket(method, path, status) {
  const el = document.createElement("div");
  el.className = "feed-item";
  el.innerHTML =
    `[stream <span class="stream-id">${nextStreamId()}</span>] ` +
    `<span class="method">${method}</span> ${path} ` +
    `→ <span class="status">${status}</span>`;
  feedItems.insertBefore(el, feedItems.firstChild);
  while (feedItems.children.length > 3)
    feedItems.removeChild(feedItems.lastChild);
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeHTML(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function markStep(el, state) {
  el.style.opacity = "1";
  const icon = el.querySelector(".http-icon");
  if (state === "active") {
    icon.textContent = "◌";
    el.style.color = "";
  } else if (state === "done") {
    icon.textContent = "✓";
    el.style.color = "var(--green)";
    el.classList.add("done");
  } else if (state === "error") {
    icon.textContent = "✗";
    el.style.color = "var(--red)";
  }
}

// ── WORD QUEUE MANAGEMENT ────────────────────────────────
function fillQueue() {
  // Trộn từ vựng và đưa vào queue, đảm bảo đủ dùng cho 60s
  wordQueue = shuffle([...WORD_BANK, ...shuffle(WORD_BANK)]);
}

function getCurrentWord() {
  return wordQueue[0];
}

function nextWord() {
  wordQueue.shift();
  if (wordQueue.length < 5) {
    wordQueue = [...wordQueue, ...shuffle(WORD_BANK)];
  }
  renderWordDisplay();
}

function renderWordDisplay() {
  const current = getCurrentWord();
  if (!current) return;

  // Hiển thị từ hiện tại
  currentWord.textContent = current.word.toUpperCase();
  currentWord.className = "current-word";
  wordCat.textContent = `[ ${current.cat} ]`;

  // Hiển thị 4 từ tiếp theo
  wordQueueEl.innerHTML = "";
  wordQueue.slice(1, 5).forEach((w) => {
    const el = document.createElement("span");
    el.className = "queue-word";
    el.textContent = w.word;
    wordQueueEl.appendChild(el);
  });

  // Reset input
  typingInput.value = "";
  typingInput.className = "";
}

// ── GAME FLOW ─────────────────────────────────────────────

document.getElementById("startBtn").addEventListener("click", () => {
  const name = playerNameEl.value.trim();
  if (!name) {
    playerNameEl.style.borderColor = "var(--red)";
    setTimeout(() => (playerNameEl.style.borderColor = ""), 1000);
    return;
  }
  playerName = name;
  startGame();
});
playerNameEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("startBtn").click();
});

function startGame() {
  score = 0;
  timeLeft = GAME_DURATION;
  totalTyped = 0;
  correctWords = 0;
  gameRunning = true;
  streamId = 1;

  playerSetup.style.display = "none";
  resultScreen.style.display = "none";
  gameArea.style.display = "flex";

  scoreDisplay.textContent = "0";
  timerDisplay.textContent = GAME_DURATION;
  wpmDisplay.textContent = "0";
  accDisplay.textContent = "100%";

  fillQueue();
  renderWordDisplay();

  // Focus input ngay sau khi game bắt đầu
  setTimeout(() => typingInput.focus(), 100);

  logPacket("CONNECT", SERVER_BASE, "QUIC");

  timerInterval = setInterval(tickTimer, 1000);
}

function tickTimer() {
  timeLeft--;
  timerDisplay.textContent = timeLeft;

  // Tính WPM theo thời gian đã trôi
  const elapsed = (GAME_DURATION - timeLeft) / 60;
  if (elapsed > 0) wpmDisplay.textContent = Math.round(correctWords / elapsed);

  const timerBox = timerDisplay.closest(".hud-item");
  if (timeLeft <= 10) timerBox.classList.add("urgent");

  if (timeLeft <= 0) {
    clearInterval(timerInterval);
    timerBox.classList.remove("urgent");
    endGame();
  }
}

// ── TYPING LOGIC ──────────────────────────────────────────
typingInput.addEventListener("input", () => {
  if (!gameRunning) return;

  const typed = typingInput.value.trim().toLowerCase();
  const target = getCurrentWord()?.word.toLowerCase() || "";

  // Kiểm tra từng ký tự đang gõ — highlight đúng/sai real-time
  if (typed === "") {
    typingInput.className = "";
    currentWord.className = "current-word";
    return;
  }

  if (target.startsWith(typed)) {
    // Đang gõ đúng
    typingInput.className = "correct";
    currentWord.className = "current-word correct";
  } else {
    // Sai
    typingInput.className = "wrong";
    currentWord.className = "current-word wrong";
  }
});

typingInput.addEventListener("keydown", (e) => {
  if (!gameRunning) return;

  // Gõ Space hoặc Enter → xác nhận từ
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    checkWord();
  }
});

function checkWord() {
  const typed = typingInput.value.trim().toLowerCase();
  const target = getCurrentWord()?.word.toLowerCase() || "";

  if (!typed) return;

  totalTyped++;

  if (typed === target) {
    // ── ĐÚNG ──
    correctWords++;

    // Điểm tính theo độ dài từ: từ dài hơn = nhiều điểm hơn
    const points = target.length;
    score += points;
    scoreDisplay.textContent = score;

    // Cập nhật accuracy
    const acc = Math.round((correctWords / totalTyped) * 100);
    accDisplay.textContent = acc + "%";

    // Popup +điểm
    spawnScorePopup(true, `+${points}`);

    // Log QUIC stream
    logPacket("WORD", `/${target}`, `+${points}pts`);

    // Sang từ tiếp theo
    nextWord();
  } else {
    // ── SAI ──
    const acc = Math.round((correctWords / totalTyped) * 100);
    accDisplay.textContent = acc + "%";

    spawnScorePopup(false, "✗");

    // Shake animation
    currentWord.className = "current-word wrong";
    setTimeout(() => {
      currentWord.className = "current-word";
    }, 400);

    typingInput.value = "";
    typingInput.className = "";
  }
}

function spawnScorePopup(correct, text) {
  const rect = typingInput.getBoundingClientRect();
  const el = document.createElement("span");
  el.className = `score-popup ${correct ? "correct" : "wrong"}`;
  el.textContent = text;
  el.style.left =
    rect.left +
    rect.width / 2 +
    (Math.random() - 0.5) * 60 +
    window.scrollX +
    "px";
  el.style.top = rect.top - 10 + window.scrollY + "px";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 800);
}

// ── GAME OVER ─────────────────────────────────────────────
async function endGame() {
  gameRunning = false;
  gameArea.style.display = "none";
  resultScreen.style.display = "flex";

  // Tính WPM và Accuracy cuối cùng
  const finalWpmVal = Math.round(correctWords / (GAME_DURATION / 60));
  const finalAccVal =
    totalTyped > 0 ? Math.round((correctWords / totalTyped) * 100) : 0;

  finalScore.textContent = score;
  finalWpm.textContent = finalWpmVal;
  finalAcc.textContent = finalAccVal + "%";

  // Gửi score qua HTTP/3
  await submitScoreHTTP3(playerName, score, finalWpmVal, finalAccVal);
  fetchLeaderboard();
}

// ── HTTP/3 REQUESTS ───────────────────────────────────────

/**
 * POST /submit-score — gửi điểm qua HTTP/3 QUIC stream
 */
async function submitScoreHTTP3(name, scoreVal, wpm, acc) {
  markStep(httpStep1, "active");
  await delay(400);

  markStep(httpStep1, "done");
  markStep(httpStep2, "active");

  try {
    // ★ HTTP/3 REQUEST ★
    // fetch() tự dùng HTTP/3 khi server gửi Alt-Svc header
    // DevTools → Network → Protocol = "h3"
    const res = await fetch(`${SERVER_BASE}/submit-score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        score: scoreVal,
        wpm,
        accuracy: acc,
        timestamp: Date.now(),
      }),
    });
    const data = await res.json();

    markStep(httpStep2, "done");
    markStep(httpStep3, "active");
    await delay(300);
    markStep(httpStep3, "done");

    logPacket(
      "POST",
      "/submit-score",
      `${res.status} rank=${data.rank || "?"}`,
    );
    console.log("[HTTP/3] Score submitted:", data);
  } catch (err) {
    markStep(httpStep2, "error");
    logPacket("POST", "/submit-score", "ERR");
    console.warn("[HTTP/3] Submit failed:", err.message);
  }
}

/**
 * GET /leaderboard — lấy bảng xếp hạng qua HTTP/3 QUIC stream
 * Chạy song song với submit-score → multiplexing
 */
async function fetchLeaderboard() {
  lbList.innerHTML = '<div class="lb-loading">Fetching via HTTP/3…</div>';
  try {
    // ★ HTTP/3 REQUEST ★
    const res = await fetch(`${SERVER_BASE}/leaderboard`);
    const data = await res.json();
    logPacket(
      "GET",
      "/leaderboard",
      `${res.status} n=${data.scores?.length || 0}`,
    );
    console.log("[HTTP/3] Leaderboard fetched:", data);
    renderLeaderboard(data.scores || []);
  } catch (err) {
    lbList.innerHTML =
      '<div class="lb-loading" style="color:var(--red)">Server offline</div>';
  }
}

function renderLeaderboard(scores) {
  if (!scores.length) {
    lbList.innerHTML = '<div class="lb-loading">No scores yet!</div>';
    return;
  }
  lbList.innerHTML = "";
  scores.forEach((e, i) => {
    const rank = i + 1;
    const row = document.createElement("div");
    row.className = `lb-row rank-${rank}`;
    const medal =
      rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
    row.innerHTML = `
      <span class="lb-rank">${medal}</span>
      <span class="lb-name">${escapeHTML(e.name)}</span>
      <span class="lb-score">${e.score}</span>
    `;
    lbList.appendChild(row);
  });
}

// ── PLAY AGAIN ────────────────────────────────────────────
document.getElementById("playAgainBtn").addEventListener("click", () => {
  [httpStep1, httpStep2, httpStep3].forEach((el, i) => {
    el.classList.remove("done");
    el.style.color = "";
    el.style.opacity = i === 0 ? "1" : "0.3";
    el.querySelector(".http-icon").textContent = "◌";
  });
  resultScreen.style.display = "none";
  playerSetup.style.display = "flex";
});

document
  .getElementById("refreshBtn")
  .addEventListener("click", fetchLeaderboard);

// ── INIT ──────────────────────────────────────────────────
fetchLeaderboard();

console.log(
  "%c[TYPE//NET] HTTP/3 Typing Game Loaded",
  "color:#00ff88;font-family:monospace;font-size:14px",
);
console.log(
  '%cDevTools → Network → Protocol = "h3"',
  "color:#00eeff;font-family:monospace",
);
