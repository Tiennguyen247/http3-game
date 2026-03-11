"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const CLIENT_DIR = path.join(__dirname, "..", "client");

// In-memory leaderboard
const scores = [
  { name: "Alice", score: 42 },
  { name: "Bob", score: 38 },
  { name: "Charlie", score: 29 },
];

function getTopScores(limit = 10) {
  const best = new Map();
  for (const s of scores) {
    const key = s.name.toLowerCase();
    if (!best.has(key) || s.score > best.get(key).score) best.set(key, s);
  }
  return Array.from(best.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function getMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
    }[ext] || "text/plain"
  );
}

function addHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  const method = req.method.toUpperCase();
  console.log(`[${req.httpVersion}] ${method} ${url}`);
  addHeaders(res);

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // POST /submit-score
  if (method === "POST" && url === "/submit-score") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const entry = {
          name: String(data.name)
            .slice(0, 16)
            .replace(/[<>&"]/g, ""),
          score: Math.max(0, Math.min(9999, Math.floor(data.score))),
        };
        scores.push(entry);
        const rank =
          getTopScores(1000).findIndex(
            (s) => s.name.toLowerCase() === entry.name.toLowerCase(),
          ) + 1;
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            rank,
            protocol: "HTTP/3 (via Railway)",
          }),
        );
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  // GET /leaderboard
  if (method === "GET" && url === "/leaderboard") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        scores: getTopScores(10),
        protocol: "HTTP/3 (via Railway)",
      }),
    );
    return;
  }

  // Static files
  const filePath = path.join(CLIENT_DIR, url === "/" ? "index.html" : url);
  if (!filePath.startsWith(CLIENT_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": getMime(filePath) });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
