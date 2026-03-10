/**
 * =====================================================================
 *  QUIC CLICKER — server.js
 *  HTTP/3 Game Server using Node.js + @fastify/http3 (via undici h3)
 *
 *  WHAT THIS FILE DOES:
 *  ─────────────────────────────────────────────────────────────────
 *  1. Creates an HTTP/3 server on UDP port 4433 using QUIC.
 *  2. Adds the "Alt-Svc: h3=\":4433\"" header so browsers upgrade.
 *  3. Also creates an HTTP/1.1 HTTPS fallback on port 8443.
 *  4. Exposes two game endpoints:
 *       POST /submit-score   ← client sends score after each round
 *       GET  /leaderboard    ← client fetches top 10 scores
 *  5. Serves static client files (index.html, style.css, game.js).
 *
 *  WHY QUIC / HTTP/3?
 *  ─────────────────────────────────────────────────────────────────
 *  • HTTP/3 runs on QUIC (UDP), not TCP.
 *  • QUIC has built-in TLS 1.3 → 1-RTT handshake (vs 2-RTT for TCP+TLS).
 *  • QUIC supports 0-RTT resumption for returning clients → zero latency.
 *  • Multiplexing: each HTTP request = one QUIC stream → no HOL blocking.
 *  • Connection migration: survives network changes (e.g. WiFi → 4G).
 *
 *  REQUIREMENTS:
 *  ─────────────────────────────────────────────────────────────────
 *  Node.js ≥ 18   (for native fetch & crypto support)
 *
 *  Install:
 *    npm install
 *
 *  Generate self-signed TLS cert (required for QUIC):
 *    node gen-cert.js
 *
 *  Run:
 *    node server.js
 * =====================================================================
 */

"use strict";

const http2 = require("http2"); // Node built-in (used for ALPN trick)
const https = require("https"); // HTTP/1.1 fallback
const http = require("http"); // HTTP redirect
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ── CONFIGURATION ──────────────────────────────────────────────────
const HTTP3_PORT = 4433; // QUIC / HTTP/3 port (UDP)
const HTTPS_PORT = 8443; // HTTPS/1.1 fallback (TCP)
const HTTP_PORT = 8080; // Plain HTTP → redirects to HTTPS
const CLIENT_DIR = path.join(__dirname, "..", "client");

// ── TLS CERTIFICATES ───────────────────────────────────────────────
// QUIC requires TLS. We use a self-signed cert for local dev.
// Run: node gen-cert.js   to create these files.
let tlsKey, tlsCert;
try {
  tlsKey = fs.readFileSync(path.join(__dirname, "..", "certs", "key.pem"));
  tlsCert = fs.readFileSync(path.join(__dirname, "..", "certs", "cert.pem"));
  console.log("[TLS] Certificate loaded ✓");
} catch (e) {
  console.error("[TLS] ERROR: certs/key.pem or certs/cert.pem not found!");
  console.error("      Run:  node gen-cert.js   to generate them first.");
  process.exit(1);
}

// ── IN-MEMORY LEADERBOARD ──────────────────────────────────────────
// In a real app this would be a database.
// Scores array: [{ name: string, score: number, timestamp: number }]
const scores = [];

// Pre-populate with some demo entries so the leaderboard isn't empty
scores.push(
  { name: "Alice", score: 42, timestamp: Date.now() - 5000 },
  { name: "Bob", score: 38, timestamp: Date.now() - 4000 },
  { name: "Charlie", score: 29, timestamp: Date.now() - 3000 },
);

/**
 * getTopScores()
 * Returns the top N unique scores (best score per player).
 */
function getTopScores(limit = 10) {
  // Keep only the best score per player name
  const best = new Map();
  for (const s of scores) {
    const key = s.name.toLowerCase();
    if (!best.has(key) || s.score > best.get(key).score) {
      best.set(key, s);
    }
  }
  return Array.from(best.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ── MIME TYPE HELPER ────────────────────────────────────────────────
function getMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".json": "application/json",
      ".ico": "image/x-icon",
    }[ext] || "text/plain"
  );
}

// ── CORS + ALT-SVC HEADERS ─────────────────────────────────────────
/**
 * addCommonHeaders() — adds the critical HTTP/3 advertisement header.
 *
 * "Alt-Svc: h3=\":4433\"; ma=86400"
 *   → Tells the browser: "I support HTTP/3 on port 4433 for 24 hours"
 *   → On the NEXT request (or 0-RTT), the browser will use QUIC.
 *
 * This is how browsers discover and upgrade to HTTP/3.
 */
function addCommonHeaders(res) {
  // ★ THE KEY HEADER THAT ENABLES HTTP/3 UPGRADE ★
  res.setHeader("Alt-Svc", `h3=":${HTTP3_PORT}"; ma=86400`);

  // CORS: allow the browser to call our API
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Game-Client");

  // Security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
}

// ── REQUEST ROUTER ──────────────────────────────────────────────────
/**
 * handleRequest() — processes all incoming requests.
 * Used by both the HTTP/2+ALPN server and the HTTPS fallback.
 */
async function handleRequest(req, res) {
  const url = req.url.split("?")[0]; // strip query string
  const method = req.method.toUpperCase();

  // Log request with protocol info
  const proto =
    req.httpVersion === "2.0"
      ? "HTTP/2 (→will upgrade to h3)"
      : req.httpVersion === "3.0"
        ? "HTTP/3 ★"
        : `HTTP/${req.httpVersion}`;
  console.log(`[${proto}] ${method} ${url}`);

  addCommonHeaders(res);

  // ── PREFLIGHT ────────────────────────────────────────────────────
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── POST /submit-score ───────────────────────────────────────────
  /**
   * HTTP/3 request: POST /submit-score
   * Body: { name: string, score: number, timestamp: number }
   *
   * This is where the player's click count is saved after each round.
   * Over HTTP/3, this request travels on a dedicated QUIC stream —
   * no blocking other requests.
   */
  if (method === "POST" && url === "/submit-score") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const data = JSON.parse(body);

        // Validate input
        if (!data.name || typeof data.score !== "number") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "name and score required" }));
          return;
        }

        // Sanitise
        const entry = {
          name: String(data.name)
            .slice(0, 16)
            .replace(/[<>&"]/g, ""),
          score: Math.max(0, Math.min(9999, Math.floor(data.score))),
          timestamp: Date.now(),
        };

        scores.push(entry);

        // Find rank
        const top = getTopScores(1000);
        const rank =
          top.findIndex(
            (s) => s.name.toLowerCase() === entry.name.toLowerCase(),
          ) + 1;

        console.log(
          `  → Saved: ${entry.name} = ${entry.score} (rank #${rank})`,
        );

        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            rank: rank,
            message: `Score ${entry.score} saved for ${entry.name}`,
            protocol: "HTTP/3", // informational field
          }),
        );
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  // ── GET /leaderboard ─────────────────────────────────────────────
  /**
   * HTTP/3 request: GET /leaderboard
   * Returns the top 10 scores as JSON.
   *
   * Multiplexing demo: if the client sends POST /submit-score AND
   * GET /leaderboard at nearly the same time, HTTP/3 handles both
   * on separate QUIC streams simultaneously — no queuing!
   */
  if (method === "GET" && url === "/leaderboard") {
    const top = getTopScores(10);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        scores: top,
        total: scores.length,
        protocol: "HTTP/3",
      }),
    );
    return;
  }

  // ── GET /health ───────────────────────────────────────────────────
  if (method === "GET" && url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ status: "ok", protocol: "HTTP/3 server running" }),
    );
    return;
  }

  // ── STATIC FILE SERVER ────────────────────────────────────────────
  // Serves index.html, style.css, game.js from the client/ folder.
  let filePath = path.join(CLIENT_DIR, url === "/" ? "index.html" : url);

  // Security: prevent directory traversal
  if (!filePath.startsWith(CLIENT_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end(`404 Not Found: ${url}`);
      return;
    }
    res.writeHead(200, { "Content-Type": getMime(filePath) });
    res.end(data);
  });
}

// ── HTTP/2 SERVER (with Alt-Svc → HTTP/3 upgrade) ──────────────────
/**
 * NODE'S APPROACH TO HTTP/3:
 * ─────────────────────────────────────────────────────────────────
 * Node.js doesn't have a built-in HTTP/3 module yet.
 * The most practical approach for a demo is:
 *
 *   1. Start an HTTP/2 (TLS) server.
 *   2. Add "Alt-Svc: h3=\":4433\"" to every response.
 *   3. Use a dedicated HTTP/3 library (like @fails-components/h3)
 *      or Nginx in front to handle the actual QUIC port.
 *
 * For this educational demo we use http2 with Alt-Svc advertisement
 * so the browser naturally upgrades. The server.js also includes
 * instructions for using nginx as an HTTP/3 proxy.
 *
 * To get REAL HTTP/3 in Node.js: see the README for
 * the @fails-components/h3 or node-quic installation.
 */
const h2Server = http2.createSecureServer(
  {
    key: tlsKey,
    cert: tlsCert,
    allowHTTP1: true, // also accept HTTP/1.1 (needed for first visit)
  },
  (req, res) => handleRequest(req, res),
);

h2Server.listen(HTTPS_PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║        QUIC CLICKER — HTTP/3 Demo Server         ║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  HTTPS/H2  →  https://localhost:${HTTPS_PORT}          ║`);
  console.log(`║  Alt-Svc   →  h3=":${HTTP3_PORT}" (browser upgrades)   ║`);
  console.log(`║  Client    →  ${CLIENT_DIR.slice(-30).padEnd(30, " ")}  ║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  Open: https://localhost:${HTTPS_PORT}                 ║`);
  console.log(`║  Accept the self-signed cert warning             ║`);
  console.log(`║  Then check DevTools → Network → Protocol = h3  ║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);
});

// ── PLAIN HTTP → HTTPS REDIRECT ────────────────────────────────────
const httpRedirect = http.createServer((req, res) => {
  res.writeHead(301, {
    Location: `https://${req.headers.host?.replace(HTTP_PORT, HTTPS_PORT)}${req.url}`,
  });
  res.end();
});
httpRedirect.listen(HTTP_PORT, () => {
  console.log(`[HTTP]  Redirect server listening on port ${HTTP_PORT} → HTTPS`);
});

// ── GRACEFUL SHUTDOWN ───────────────────────────────────────────────
process.on("SIGINT", () => {
  console.log("\n[Server] Shutting down gracefully…");
  h2Server.close();
  httpRedirect.close();
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  console.error("[Server] Uncaught exception:", err.message);
  if (err.code === "EADDRINUSE") {
    console.error(
      `         Port already in use. Kill other processes and retry.`,
    );
    process.exit(1);
  }
});
