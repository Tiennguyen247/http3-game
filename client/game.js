/**
 * =====================================================================
 *  QUIC CLICKER — game.js
 *  HTTP/3 Demo Game — Client Side
 * =====================================================================
 *
 *  HOW HTTP/3 IS USED HERE:
 *  ─
 *  All fetch() calls in this file go to https://localhost:4433
 *  The server at that address speaks HTTP/3 (via node-h3-server or
 *  the h3/node:http2 + ALPN trick).
 *
 *  Modern browsers (Chrome/Edge/Firefox) will automatically
 *  negotiate HTTP/3 if:
 *    1. Server sends "Alt-Svc: h3=\":4433\"" header (server.js does this)
 *    2. The connection uses TLS (our self-signed cert)
 *    3. The browser supports h3 (all modern browsers do)
 *
 *  You can verify in DevTools → Network → Protocol column = "h3"
 * =====================================================================
 */

//  CONFIGURATION
// Change this to match your server address.
// The server MUST use HTTPS because QUIC requires TLS.
const SERVER_BASE = "https://localhost:8443";

// Game settings
const GAME_DURATION = 10; // seconds per round

//  STATE
let score = 0;
let timeLeft = GAME_DURATION;
let timerInterval = null;
let playerName = "";
let gameRunning = false;

//  DOM REFERENCES ─
const playerSetup = document.getElementById("playerSetup");
const gameArea = document.getElementById("gameArea");
const resultScreen = document.getElementById("resultScreen");
const playerNameEl = document.getElementById("playerName");
const scoreDisplay = document.getElementById("scoreDisplay");
const timerDisplay = document.getElementById("timerDisplay");
const playerDisp = document.getElementById("playerDisplay");
const clickTarget = document.getElementById("clickTarget");
const finalScore = document.getElementById("finalScore");
const feedItems = document.getElementById("feedItems");
const lbList = document.getElementById("lbList");

// HTTP/3 status steps in result screen
const httpStep1 = document.getElementById("httpStep1");
const httpStep2 = document.getElementById("httpStep2");
const httpStep3 = document.getElementById("httpStep3");

//  STREAM COUNTER (simulates QUIC stream IDs) ─
// In HTTP/3, each request uses its own QUIC stream (no head-of-line blocking).
// We show fake stream IDs in the packet feed to make this visible.
let streamId = 1;
function nextStreamId() {
  const id = streamId;
  streamId += 4; // QUIC client-initiated bidirectional streams: 0, 4, 8, 12...
  return id;
}

//  PACKET FEED LOGGER ─
// Shows simulated QUIC stream activity, like a mini Wireshark.
function logPacket(method, path, status) {
  const sid = nextStreamId();
  const el = document.createElement("div");
  el.className = "feed-item";
  el.innerHTML =
    `[stream <span class="stream-id">${sid}</span>] ` +
    `<span class="method">${method}</span> ${path} ` +
    `→ <span class="status">${status}</span>`;
  // Prepend so newest is on top
  feedItems.insertBefore(el, feedItems.firstChild);
  // Keep max 4 entries visible
  while (feedItems.children.length > 4) {
    feedItems.removeChild(feedItems.lastChild);
  }
}

//  GAME FLOW ─

/** STEP 1: Player clicks "Launch Game" */
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

/** Allow pressing Enter to start */
playerNameEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("startBtn").click();
});

/** STEP 2: Start game round */
function startGame() {
  score = 0;
  timeLeft = GAME_DURATION;
  gameRunning = true;
  streamId = 1;

  // Switch UI panels
  playerSetup.style.display = "none";
  resultScreen.style.display = "none";
  gameArea.style.display = "flex";

  // Update HUD
  scoreDisplay.textContent = "0";
  timerDisplay.textContent = GAME_DURATION;
  playerDisp.textContent = playerName.toUpperCase().slice(0, 8);

  // Log initial QUIC connection event
  // HTTP/3: The browser opened a QUIC connection to the server here.
  // QUIC does a 1-RTT (or 0-RTT on resumption) TLS handshake.
  logPacket("CONNECT", SERVER_BASE, "QUIC");

  // Start countdown
  timerInterval = setInterval(tickTimer, 1000);
}

/** STEP 3: Countdown timer */
function tickTimer() {
  timeLeft--;
  timerDisplay.textContent = timeLeft;

  // Turn timer red when ≤ 3 seconds left
  const timerBox = timerDisplay.closest(".hud-item");
  if (timeLeft <= 3) {
    timerBox.classList.add("urgent");
  }

  if (timeLeft <= 0) {
    clearInterval(timerInterval);
    timerBox.classList.remove("urgent");
    endGame();
  }
}

/** STEP 4: Player clicks the button */
clickTarget.addEventListener("click", (e) => {
  if (!gameRunning) return;

  score++;
  scoreDisplay.textContent = score;

  // Visual feedback: ripple effect
  clickTarget.classList.remove("clicked");
  void clickTarget.offsetWidth; // reflow trick to restart animation
  clickTarget.classList.add("clicked");
  setTimeout(() => clickTarget.classList.remove("clicked"), 400);

  // Floating +1
  spawnPlusOne(e);

  // Log each click as a QUIC "packet" in our feed.
  // In a real HTTP/3 app you might send each click immediately;
  // here we batch them and send at the end to keep it simple.
  logPacket("CLICK", "/game-action", `score=${score}`);
});

/** Spawns the floating "+1" animation */
function spawnPlusOne(e) {
  const rect = clickTarget.getBoundingClientRect();
  const el = document.createElement("span");
  el.className = "plus-one";
  el.textContent = "+1";
  // Random horizontal offset so multiple +1s don't stack
  const rx = (Math.random() - 0.5) * 80;
  el.style.left = rect.left + rect.width / 2 + rx + window.scrollX + "px";
  el.style.top = rect.top + window.scrollY + "px";
  el.style.position = "absolute";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 700);
}

/** STEP 5: Game over → submit score via HTTP/3 */
async function endGame() {
  gameRunning = false;
  gameArea.style.display = "none";
  resultScreen.style.display = "flex";
  finalScore.textContent = score;

  // Animate HTTP/3 submission steps
  await submitScoreHTTP3(playerName, score);

  // After submitting, refresh the leaderboard
  fetchLeaderboard();
}

//  HTTP/3 REQUESTS ─
// These two functions are the CORE of the HTTP/3 demo.
// The browser uses HTTP/3 because:
//   • The server advertises "Alt-Svc: h3=\":4433\""
//   • All subsequent requests to this origin use QUIC (UDP)
//   • You can verify in DevTools: Network → Protocol = "h3"

/**
 * POST /submit-score
 * ─
 * Sends the player's name + score to the server after a round.
 * This request travels over a QUIC stream (HTTP/3).
 *
 * HTTP/3 advantage demonstrated here:
 *   - 0-RTT resumption: if this is not the first connection,
 *     the browser can send data with the very first packet (no wait).
 *   - Each fetch() uses a separate QUIC stream → no HOL blocking.
 */
async function submitScoreHTTP3(name, finalScoreVal) {
  // Step 1: QUIC handshake animation
  markStep(httpStep1, "active");
  await delay(400);

  // Step 2: Sending the POST request
  markStep(httpStep1, "done");
  markStep(httpStep2, "active");

  try {
    // ★ THIS IS THE HTTP/3 REQUEST ★
    // fetch() automatically uses HTTP/3 when the server advertises it.
    // Check DevTools → Network tab → Protocol column for "h3".
    const response = await fetch(`${SERVER_BASE}/submit-score`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // This header helps the server log which protocol was used
        "X-Game-Client": "quic-clicker-v1",
      },
      body: JSON.stringify({
        name: name,
        score: finalScoreVal,
        timestamp: Date.now(),
      }),
    });

    const data = await response.json();

    // Step 3: ACK received
    markStep(httpStep2, "done");
    markStep(httpStep3, "active");
    await delay(300);
    markStep(httpStep3, "done");

    // Log to packet feed
    logPacket(
      "POST",
      "/submit-score",
      `${response.status} rank=${data.rank || "?"}`,
    );

    console.log("[HTTP/3] Score submitted:", data);
  } catch (err) {
    // If the server isn't running, show a friendly error
    markStep(httpStep2, "error");
    console.warn("[HTTP/3] Submit failed. Is the server running?", err);
    logPacket("POST", "/submit-score", "ERR (server down?)");
  }
}

/**
 * GET /leaderboard
 *
 * Fetches the top scores from the server.
 * This request also travels over HTTP/3 (same QUIC connection).
 *
 * HTTP/3 multiplexing demonstrated here:
 *   - If you click "refresh" multiple times quickly,
 *     each request uses a different QUIC stream ID
 *     but the SAME underlying UDP connection — no new handshakes!
 *   - In HTTP/1.1 you'd queue requests. In HTTP/2 you'd have
 *     TCP HOL blocking. HTTP/3 on QUIC has neither.
 */
async function fetchLeaderboard() {
  lbList.innerHTML = '<div class="lb-loading">Fetching via HTTP/3…</div>';

  try {
    // ★ THIS IS ALSO AN HTTP/3 REQUEST ★
    // Both /submit-score and /leaderboard use the same QUIC connection
    // but different stream IDs — that's multiplexing!
    const response = await fetch(`${SERVER_BASE}/leaderboard`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const data = await response.json();

    // Log it
    logPacket(
      "GET",
      "/leaderboard",
      `${response.status} entries=${data.scores?.length || 0}`,
    );
    console.log("[HTTP/3] Leaderboard fetched:", data);

    renderLeaderboard(data.scores || []);
  } catch (err) {
    lbList.innerHTML =
      '<div class="lb-loading" style="color:var(--red)">Server offline — start server.js</div>';
    console.warn(
      "[HTTP/3] Leaderboard fetch failed. Is the server running?",
      err,
    );
  }
}

/** Renders the leaderboard rows */
function renderLeaderboard(scores) {
  if (!scores.length) {
    lbList.innerHTML =
      '<div class="lb-loading">No scores yet — play first!</div>';
    return;
  }

  lbList.innerHTML = "";
  scores.forEach((entry, i) => {
    const rank = i + 1;
    const row = document.createElement("div");
    row.className = `lb-row rank-${rank}`;

    const medal =
      rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
    row.innerHTML = `
      <span class="lb-rank">${medal}</span>
      <span class="lb-name">${escapeHTML(entry.name)}</span>
      <span class="lb-score">${entry.score}</span>
    `;
    lbList.appendChild(row);
  });
}

// UTILITY

/** Marks an HTTP status row as active / done / error */
function markStep(el, state) {
  el.style.opacity = "1";
  if (state === "active") {
    el.classList.remove("done");
    el.querySelector(".http-icon").textContent = "◌";
  } else if (state === "done") {
    el.classList.add("done");
    el.querySelector(".http-icon").textContent = "✓";
    el.style.color = "var(--green)";
  } else if (state === "error") {
    el.querySelector(".http-icon").textContent = "✗";
    el.style.color = "var(--red)";
  }
}

/** Promise-based delay helper */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Escape user text for safe innerHTML insertion */
function escapeHTML(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

//  PLAY AGAIN
document.getElementById("playAgainBtn").addEventListener("click", () => {
  // Reset HTTP step styles
  [httpStep1, httpStep2, httpStep3].forEach((el) => {
    el.classList.remove("done");
    el.style.color = "";
    el.style.opacity = el === httpStep1 ? "1" : "0.3";
    el.querySelector(".http-icon").textContent = "◌";
  });

  resultScreen.style.display = "none";
  playerSetup.style.display = "flex";
});

//  REFRESH LEADERBOARD BUTTON
document.getElementById("refreshBtn").addEventListener("click", () => {
  // Each click sends a new GET /leaderboard over HTTP/3.
  // Watch DevTools: same connection, different stream ID = multiplexing!
  fetchLeaderboard();
});

//  INIT: load leaderboard on page open
// This is the very first HTTP/3 request — the browser does the
// QUIC handshake (1-RTT with TLS 1.3) here.
fetchLeaderboard();

console.log(
  "%c[QUIC CLICKER] HTTP/3 Demo Game Loaded",
  "color:#00ff88; font-family:monospace; font-size:14px",
);
console.log(
  '%cOpen DevTools → Network tab → look for Protocol = "h3"',
  "color:#00eeff; font-family:monospace",
);
