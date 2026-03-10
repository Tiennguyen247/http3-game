# 📋 Báo Cáo: QUIC Clicker — HTTP/3 Demo Game

> **Môn học:** Mạng Máy Tính  
> **Họ tên:** Nguyễn Mạnh Tiến
> **MSSV:** 2451060726 
> **Lớp:** 66CNTT2  

---

## 1. 🎮 Game Hoạt Động Như Thế Nào

### Ý tưởng
**QUIC Clicker** là một game click-speed đơn giản chạy trên trình duyệt. Người chơi có **10 giây** để click vào nút tròn phát sáng càng nhiều lần càng tốt. Điểm số sau mỗi ván được gửi lên server và hiển thị trên bảng xếp hạng.

### Luồng hoạt động

```
Người chơi nhập tên
        ↓
Nhấn LAUNCH GAME → Game bắt đầu đếm ngược 10 giây
        ↓
Click vào nút → Score tăng +1 mỗi lần click
        ↓
Hết 10 giây → Game kết thúc
        ↓
Client gửi POST /submit-score lên server  ← HTTP/3
        ↓
Client gửi GET /leaderboard từ server     ← HTTP/3
        ↓
Bảng xếp hạng cập nhật
```

### Các thành phần của game

| Thành phần | Mô tả |
|---|---|
| **Nút click** | Vòng tròn phát sáng ở giữa màn hình |
| **HUD** | Hiển thị điểm số, thời gian đếm ngược, tên người chơi |
| **QUIC Stream Log** | Bảng log giả lập luồng QUIC stream khi click |
| **HTTP/3 Status** | Hiển thị 3 bước handshake → gửi request → nhận ACK |
| **Leaderboard** | Bảng xếp hạng top 10, lấy từ server qua GET request |

---

## 2. 🌐 HTTP/3 và QUIC là gì?

### HTTP/3 là gì?
HTTP/3 là phiên bản thứ 3 của giao thức HTTP — giao thức nền tảng của World Wide Web. Điểm khác biệt lớn nhất so với các phiên bản trước là HTTP/3 **không chạy trên TCP** mà chạy trên **QUIC**.

### QUIC là gì?
QUIC (Quick UDP Internet Connections) là một giao thức truyền tải mới do Google phát triển, hiện được chuẩn hoá bởi IETF (RFC 9000). QUIC chạy trên **UDP** thay vì TCP.

```
Trình duyệt  ──── HTTP/3 / QUIC (UDP) ────→  Server
Trình duyệt  ──── HTTP/2 / TCP        ────→  Server  (cũ hơn)
Trình duyệt  ──── HTTP/1.1 / TCP      ────→  Server  (cũ nhất)
```

### Tại sao QUIC lại nhanh hơn?

**1. Handshake nhanh hơn (1-RTT)**

Với TCP + TLS 1.2, trình duyệt cần thực hiện **3 bước** trước khi gửi dữ liệu:
```
TCP  Handshake:  SYN → SYN-ACK → ACK         (1 RTT)
TLS  Handshake:  ClientHello → ServerHello    (1-2 RTT)
─────────────────────────────────────────────────────
Tổng cộng: 2-3 RTT trước khi gửi được dữ liệu
```

Với QUIC (HTTP/3), TLS 1.3 được **tích hợp sẵn** vào QUIC:
```
QUIC + TLS 1.3:  Initial Packet (kèm ClientHello)  (1 RTT)
─────────────────────────────────────────────────────────
Tổng cộng: 1 RTT là gửi được dữ liệu ✅
```

**2. 0-RTT Resumption**

Nếu trình duyệt đã từng kết nối với server trước đó, lần tiếp theo có thể gửi dữ liệu **ngay lập tức mà không cần handshake** (0 RTT).

Trong game: ván thứ 2 trở đi, điểm số được submit **nhanh hơn** đáng kể so với ván đầu tiên.

**3. Multiplexing không bị Head-of-Line Blocking**

Đây là ưu điểm lớn nhất của HTTP/3 so với HTTP/2.

```
HTTP/2 trên TCP:
  Packet 1 bị mất → TẤT CẢ streams phải chờ ← HOL Blocking ❌
  [Stream 1: submit-score ===BLOCKED===]
  [Stream 2: leaderboard  ===BLOCKED===]

HTTP/3 trên QUIC:
  Packet bị mất → CHỈ stream đó bị ảnh hưởng ✅
  [Stream 1: submit-score ──────────→]
  [Stream 4: leaderboard  ──────────→]  (tiếp tục bình thường)
```

Trong game: khi client gửi `POST /submit-score` và `GET /leaderboard` cùng lúc, cả hai đi trên **2 QUIC stream độc lập** — không cái nào chặn cái nào.

---

## 3. ⚖️ So Sánh HTTP/1.1 vs HTTP/2 vs HTTP/3

| Tiêu chí | HTTP/1.1 | HTTP/2 | HTTP/3 |
|---|---|---|---|
| **Năm ra đời** | 1997 | 2015 | 2022 |
| **Giao thức nền** | TCP | TCP | QUIC (UDP) |
| **Mã hoá** | Tuỳ chọn (HTTP) | Thực tế bắt buộc | Bắt buộc (TLS 1.3) |
| **Handshake** | TCP (1RTT) + TLS (1-2RTT) | TCP (1RTT) + TLS (1-2RTT) | QUIC+TLS (1RTT) |
| **0-RTT resumption** | ❌ | ❌ | ✅ |
| **Multiplexing** | ❌ (1 request/connection) | ✅ (nhưng HOL blocking) | ✅ (không HOL blocking) |
| **Head-of-Line Blocking** | Có (request level) | Có (TCP level) | ❌ Không có |
| **Connection Migration** | ❌ | ❌ | ✅ (WiFi → 4G không đứt) |
| **Header Compression** | Không | HPACK | QPACK |

### Ví dụ thực tế trong game

**HTTP/1.1:** Mỗi lần submit score phải mở connection mới → rất chậm.

**HTTP/2:** Submit score và lấy leaderboard dùng chung 1 TCP connection, nhưng nếu 1 TCP packet bị mất → cả 2 phải chờ (HOL blocking).

**HTTP/3 (game đang dùng):** Submit score trên Stream 1, lấy leaderboard trên Stream 4 — hoàn toàn độc lập, không block nhau. Server phản hồi nhanh hơn.

---

## 4. 🏗️ Kiến Trúc Hệ Thống

### Sơ đồ tổng quan

```
┌─────────────────────────────────────┐
│           TRÌNH DUYỆT (Client)       │
│                                     │
│  index.html  → Giao diện game       │
│  style.css   → Thiết kế giao diện   │
│  game.js     → Logic game +         │
│               fetch() qua HTTP/3    │
└────────────────┬────────────────────┘
                 │
                 │  QUIC (UDP) + TLS 1.3
                 │  POST /submit-score
                 │  GET  /leaderboard
                 │
┌────────────────▼────────────────────┐
│         NODE.JS SERVER              │
│                                     │
│  Port 8443 → HTTPS / HTTP/2         │
│  Alt-Svc: h3=":8443"               │
│    → Trình duyệt tự upgrade lên h3 │
│                                     │
│  Routes:                            │
│  • POST /submit-score → lưu điểm   │
│  • GET  /leaderboard  → trả top 10 │
│  • GET  /             → index.html  │
│                                     │
│  Lưu trữ: In-memory Array           │
└─────────────────────────────────────┘
```

### Cơ chế Alt-Svc — Cách browser biết dùng HTTP/3

Đây là cơ chế quan trọng nhất để hiểu cách HTTP/3 hoạt động trong project:

```
Bước 1: Lần đầu trình duyệt truy cập
──────────────────────────────────────
Browser:  GET https://localhost:8443/
Server:   200 OK
          Alt-Svc: h3=":8443"; ma=86400
          ↑ "Tôi hỗ trợ HTTP/3 — hãy dùng QUIC cho các request sau!"

Bước 2: Trình duyệt ghi nhớ thông tin này

Bước 3: Từ request tiếp theo
──────────────────────────────────────
Browser:  [Chuyển sang QUIC trên UDP]
          POST /submit-score  → Protocol: h3 ✅
          GET  /leaderboard   → Protocol: h3 ✅
```

### Cấu trúc thư mục

```
http3-game/
├── client/
│   ├── index.html    ← Giao diện game, layout HTML
│   ├── style.css     ← Thiết kế cyberpunk terminal
│   └── game.js       ← Logic game + fetch() HTTP/3
├── server/
│   └── server.js     ← HTTP/2 server + Alt-Svc HTTP/3
├── certs/
│   ├── key.pem       ← TLS private key (tự sinh)
│   └── cert.pem      ← TLS certificate (tự sinh)
├── gen-cert.js       ← Script tạo TLS cert
└── package.json      ← Cấu hình Node.js project
```

### Chi tiết các API Endpoint

**`POST /submit-score`** — Gửi điểm sau mỗi ván chơi
```json
// Request body
{ "name": "Alice", "score": 56, "timestamp": 1712345678 }

// Response
{ "success": true, "rank": 1, "protocol": "HTTP/3" }
```

**`GET /leaderboard`** — Lấy top 10 bảng xếp hạng
```json
// Response
{
  "scores": [
    { "name": "Alice", "score": 56 },
    { "name": "Bob",   "score": 42 }
  ],
  "protocol": "HTTP/3"
}
```

---

## 5. 💡 Những Gì Em Học Được Khi Làm Project Này

### 5.1. Hiểu sâu hơn về sự khác biệt giữa TCP và UDP

Trước khi làm project, em chỉ biết TCP thì đáng tin cậy còn UDP thì nhanh hơn. Sau khi tìm hiểu về QUIC, em hiểu rằng QUIC **không chỉ đơn giản là "dùng UDP"** — mà QUIC tự xây dựng cơ chế đảm bảo độ tin cậy riêng trực tiếp ở tầng ứng dụng, đồng thời tránh được những điểm yếu của TCP như Head-of-Line Blocking.

### 5.2. Hiểu được TLS không chỉ là "thêm ổ khoá vào URL"

Em học được rằng TLS 1.3 trong QUIC được **tích hợp sẵn vào quá trình handshake**, không phải một lớp riêng biệt như TCP + TLS. Điều này giúp giảm từ 2-3 RTT xuống còn 1 RTT, và thậm chí 0 RTT khi reconnect.

### 5.3. Hiểu về Alt-Svc Header

Đây là điều em thấy thú vị nhất. HTTP/3 không "tự nhiên" được dùng — trình duyệt phải **được server thông báo** thông qua header `Alt-Svc`. Cơ chế này giống như server nói: *"Lần sau bạn muốn nói chuyện với tôi, hãy dùng HTTP/3 cho nhanh hơn."*

### 5.4. Thực hành xây dựng Client-Server thực tế

Em hiểu cách một web application thực sự hoạt động: client dùng `fetch()` để gọi API, server xử lý request, trả về JSON, client cập nhật giao diện. Dù đơn giản nhưng đây là mô hình của hầu hết mọi web app hiện đại.

### 5.5. Kỹ năng debug với DevTools

Em học được cách dùng Chrome DevTools — đặc biệt là **Network tab** — để kiểm tra giao thức đang được sử dụng. Cột `Protocol = h3` là bằng chứng trực quan và thuyết phục nhất rằng HTTP/3 đang hoạt động.

### 5.6. Tầm quan trọng của TLS trong bảo mật

QUIC **bắt buộc phải có TLS** — không thể chạy HTTP/3 mà không có mã hoá. Điều này có nghĩa là **mọi kết nối HTTP/3 đều được mã hoá**, không có trường hợp ngoại lệ, khác với HTTP/1.1 và HTTP/2 có thể chạy không mã hoá.

---

## 6. 🔍 Bằng Chứng HTTP/3 Hoạt Động

### Chrome DevTools — Network Tab
![DevTools Network Tab](screenshots/devtools-network.png)

Trong ảnh chụp màn hình, cột **Protocol** hiển thị:
- `/submit-score` → `h3` ✅
- `/leaderboard` → `h3` ✅

### Chrome DevTools — Console Tab
```
[QUIC CLICKER] HTTP/3 Demo Game Loaded
[HTTP/3] Leaderboard fetched: { scores: [...], protocol: 'HTTP/3' }
[HTTP/3] Score submitted:     { success: true, rank: 1, protocol: 'HTTP/3' }
```

### Server Console Log
```
[HTTP/3 ★] POST /submit-score
[HTTP/3 ★] GET  /leaderboard
```

### chrome://net-internals/#quic
Truy cập địa chỉ này trong Chrome để thấy QUIC session đang active đến `localhost:8443`.

---

## 7. 📚 Tài Liệu Tham Khảo

- RFC 9000 — QUIC: A UDP-Based Multiplexed and Secure Transport: https://www.rfc-editor.org/rfc/rfc9000
- RFC 9114 — HTTP/3: https://www.rfc-editor.org/rfc/rfc9114
- MDN Web Docs — HTTP/3: https://developer.mozilla.org/en-US/docs/Glossary/HTTP_3
- Cloudflare — HTTP/3 explained: https://blog.cloudflare.com/http3-the-past-present-and-future
- Node.js Documentation: https://nodejs.org/docs/latest/api/http2.html

---

*Báo cáo được viết bởi Nguyễn Mạnh Tiến — Sinh viên năm 2, Khoa Công nghệ Thông tin*
