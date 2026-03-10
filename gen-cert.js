const { generateKeyPairSync, createSign } = require("crypto");
const fs = require("fs");
const path = require("path");

const certsDir = path.join(__dirname, "certs");
if (!fs.existsSync(certsDir)) fs.mkdirSync(certsDir, { recursive: true });

const keyPath = path.join(certsDir, "key.pem");
const certPath = path.join(certsDir, "cert.pem");

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  console.log(
    "[gen-cert] Cert already exists — delete certs/ folder to regenerate.",
  );
  process.exit(0);
}

console.log("[gen-cert] Generating certificate using Node.js crypto...");

try {
  // Tạo RSA key pair
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  // Lưu private key
  fs.writeFileSync(keyPath, privateKey);
  console.log("[gen-cert] key.pem saved");

  // Tạo self-signed certificate thủ công theo chuẩn X.509 DER
  // (đơn giản hoá — đủ dùng cho localhost dev)
  const { execSync } = require("child_process");

  // Thử dùng openssl từ Git for Windows nếu có
  const gitOpenssl = "C:\\Program Files\\Git\\usr\\bin\\openssl.exe";
  const winOpenssl = "C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe";

  let opensslPath = null;
  if (fs.existsSync(gitOpenssl)) opensslPath = `"${gitOpenssl}"`;
  if (fs.existsSync(winOpenssl)) opensslPath = `"${winOpenssl}"`;

  if (opensslPath) {
    console.log(`[gen-cert] Found OpenSSL at: ${opensslPath}`);
    execSync(
      `${opensslPath} req -new -x509 -key "${keyPath}" -out "${certPath}" ` +
        `-days 365 -subj "/CN=localhost"`,
      { stdio: "pipe" },
    );
  } else {
    // Fallback: tạo cert giả lập đủ dùng cho Node.js https
    // Dùng selfsigned package nếu có, hoặc hardcode cert mẫu
    writeFallbackCert(certPath, privateKey, publicKey);
  }

  console.log("[gen-cert] cert.pem saved");
  console.log("[gen-cert] ✓ Done! certs/key.pem and certs/cert.pem are ready.");
} catch (err) {
  console.error("[gen-cert] Failed:", err.message);
  process.exit(1);
}

function writeFallbackCert(certPath, privateKey, publicKey) {
  // Dùng thư viện selfsigned (cần npm install)
  console.log("[gen-cert] Installing selfsigned package...");
  const { execSync } = require("child_process");
  execSync("npm install selfsigned --save-dev", { stdio: "inherit" });

  const selfsigned = require("selfsigned");
  const attrs = [{ name: "commonName", value: "localhost" }];
  const pems = selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    algorithm: "sha256",
    extensions: [
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "localhost" },
          { type: 7, ip: "127.0.0.1" },
        ],
      },
    ],
  });

  fs.writeFileSync(path.join(path.dirname(certPath), "key.pem"), pems.private);
  fs.writeFileSync(certPath, pems.cert);
}
