# 🎮 QUIC CLICKER — HTTP/3 Demo Game
### Bài tập môn Mạng Máy Tính — Minh hoạ giao thức HTTP/3 / QUIC

> 🚀 **Live Demo:** [https://http3-game-production.up.railway.app](https://http3-game-production.up.railway.app)
> 📁 **Source Code:** [https://github.com/Tiennguyen247/http3-game](https://github.com/Tiennguyen247/http3-game)

---

## 1. 🎯 Ý Tưởng Game

**QUIC Clicker** là game click-speed đơn giản chạy trên trình duyệt. Người chơi có **10 giây** để click vào nút tròn phát sáng càng nhiều lần càng tốt. Điểm số được gửi lên server và hiển thị trên bảng xếp hạng.

> Game đơn giản có chủ đích — điểm nhấn là **dữ liệu di chuyển như thế nào**, không phải gameplay.

Mỗi lần client giao tiếp với server (gửi điểm, lấy leaderboard) đều sử dụng **HTTP/3 over QUIC** thay vì HTTP/1.1 hay HTTP/2 truyền thống.

---

## 2. 🏗️ Kiến Trúc Hệ Thống

```
┌──────────────────────────────────┐        HTTPS / HTTP/3
│         TRÌNH DUYỆT (Client)     │ ════════════════════════════╗
│                                  │                             ║
│  index.html  ← giao diện game    │  POST /submit-score        ║
│  style.css   ← thiết kế UI       │ ───────────────────────→   ║
│  game.js     ← logic game +      │  GET  /leaderboard         ║
│               fetch() HTTP/3     │ ───────────────────────→   ║
└──────────────────────────────────┘                             ║
                                                                  ▼
                                    ┌─────────────────────────────────┐
                                    │    NODE.JS SERVER (server.js)   │
                                    │                                 │
                                    │  Local:  Port 8443, HTTPS/H2   │
                                    │          Alt-Svc: h3=":8443"   │
                                    │                                 │
                                    │  Railway: HTTP, Railway lo TLS  │
                                    │           PORT env variable     │
                                    │                                 │
                                    │  POST /submit-score             │
                                    │  GET  /leaderboard              │
                                    │  GET  /  → static files         │
                                    └─────────────────────────────────┘
```

### Client
- HTML/CSS/JavaScript thuần — không dùng framework
- Dùng `fetch()` API có sẵn trong trình duyệt
- `window.location.origin` tự động trỏ đúng địa chỉ (localhost hoặc Railway)
- Trình duyệt tự upgrade lên HTTP/3 khi thấy header `Alt-Svc`

### Server
- Node.js — không cần cài thêm package
- **Local**: HTTP/2 + TLS tự ký, quảng bá `Alt-Svc: h3`
- **Railway**: HTTP thuần, Railway xử lý HTTPS/HTTP/2 ở tầng proxy

---

## 3. 📁 Cấu Trúc Thư Mục

```
http3-game/
├── package.json          ← cấu hình project
├── railway.json          ← cấu hình deploy Railway
├── gen-cert.js           ← tạo TLS cert (chỉ dùng khi chạy local)
├── REPORT.md             ← báo cáo giải thích HTTP/3
├── certs/                ← TLS cert (tự sinh, không push lên GitHub)
│   ├── key.pem
│   └── cert.pem
├── client/
│   ├── index.html        ← giao diện game
│   ├── style.css         ← thiết kế retro-terminal
│   └── game.js           ← logic game + fetch() HTTP/3
└── server/
    └── server.js         ← Node.js server
```

---

## 4. 🔌 API Endpoints

### `POST /submit-score`
Gửi điểm số sau mỗi ván chơi. Request đi qua HTTP/3 stream độc lập.

```json
// Request body
{ "name": "Alice", "score": 56 }

// Response
{ "success": true, "rank": 1, "protocol": "HTTP/3" }
```

### `GET /leaderboard`
Lấy top 10 bảng xếp hạng. Chạy song song với submit-score trên QUIC stream riêng — không block nhau.

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

## 5. 🌐 HTTP/3 Được Dùng Như Thế Nào

### QUIC Connection & Handshake
```
HTTP/1.1 + TLS:  TCP handshake (1RTT) + TLS handshake (1-2RTT) = 2-3 RTT
HTTP/2   + TLS:  TCP handshake (1RTT) + TLS handshake (1-2RTT) = 2-3 RTT
HTTP/3   + QUIC: QUIC + TLS 1.3 kết hợp                        = 1 RTT ✅
                 Kết nối lại (0-RTT resumption)                 = 0 RTT ✅
```

### Stream Multiplexing — Không HOL Blocking
Khi game kết thúc, client gửi đồng thời 2 request:

```
HTTP/2 (TCP):
  Packet bị mất → CẢ HAI stream phải chờ ❌
  [Stream 1: POST /submit-score ══BLOCKED══]
  [Stream 2: GET  /leaderboard  ══BLOCKED══]

HTTP/3 (QUIC):
  Packet bị mất → CHỈ stream đó bị ảnh hưởng ✅
  [Stream 1: POST /submit-score ──────────→]
  [Stream 4: GET  /leaderboard  ──────────→]
```

### Cơ Chế Alt-Svc Upgrade
```
1. Browser:  GET https://your-domain/
   Server:   200 OK
             Alt-Svc: h3=":443"; ma=86400
             ↑ "Tôi hỗ trợ HTTP/3 — dùng QUIC cho request sau!"

2. Browser ghi nhớ trong 86400 giây (24 giờ)

3. Request tiếp theo → browser chuyển sang QUIC (UDP)
   DevTools → Network → Protocol = "h3" ✅
```

### Tại Sao HTTP/3 Tốt Hơn Cho Game Này

| Tính năng | Lợi ích |
|---|---|
| 0-RTT resumption | Ván 2 trở đi submit điểm gần như tức thì |
| Multiplexed streams | Submit score + fetch leaderboard chạy song song |
| Không HOL blocking | Request chậm không cản request khác |
| TLS tích hợp sẵn | Mọi kết nối đều được mã hoá, không có ngoại lệ |
| Connection migration | Đổi WiFi → 4G không bị mất kết nối |

---

## 6. 🚀 Hướng Dẫn Chạy

### Cách 1 — Chạy Online (dễ nhất)
Truy cập link Railway, click vào là chơi ngay — không cần cài gì:
```
https://http3-game-production.up.railway.app
```

### Cách 2 — Chạy Local (cần Node.js ≥ 18 + OpenSSL)

```bash
# 1. Clone repo
git clone https://github.com/Tiennguyen247/http3-game.git
cd http3-game

# 2. Tạo TLS certificate (QUIC bắt buộc cần TLS)
node gen-cert.js

# 3. Chạy server
node server/server.js

# 4. Mở Chrome → truy cập
# https://localhost:8443
# → Click "Advanced" → "Proceed to localhost (unsafe)"
```

---

## 7. 🔬 Cách Kiểm Chứng HTTP/3 Đang Hoạt Động

### Phương pháp 1 — Chrome DevTools (dễ nhất)

1. Mở game → nhấn **F12** → tab **Network**
2. Chơi 1 ván
3. Chuột phải vào tiêu đề cột → tick **Protocol**
4. Kết quả:

```
Name            Status   Protocol
/leaderboard    200      h3        ✅
/submit-score   201      h3        ✅
```

### Phương pháp 2 — Chrome Net Internals
Mở tab mới → truy cập `chrome://net-internals/#quic`
→ Thấy QUIC session đang active = HTTP/3 đang chạy ✅

### Phương pháp 3 — Console Log
```
[HTTP/3] Leaderboard fetched: { protocol: 'HTTP/3' }  ✅
[HTTP/3] Score submitted:     { protocol: 'HTTP/3' }  ✅
```

---

## 8. ✨ Cải Tiến Thêm (Điểm Bonus)

| Ý tưởng | Mô tả |
|---|---|
| **WebTransport** | Thay `fetch()` bằng WebTransport API cho stream 2 chiều thật sự |
| **Real-time multiplayer** | Dùng Server-Sent Events để nhiều người chơi cùng lúc |
| **Packet loss simulation** | Dùng Chrome Network Throttle mô phỏng mất gói tin |
| **So sánh HTTP/2 vs HTTP/3** | Thêm nút toggle và đo thời gian response từng giao thức |
| **Database** | Thay in-memory array bằng Redis/SQLite để lưu điểm lâu dài |

---

## 9. 📊 Tóm Tắt

| Điểm trong game | Điều xảy ra | Tính năng HTTP/3 |
|---|---|---|
| Mở trang | Tải index.html | QUIC handshake (1-RTT) |
| Bắt đầu game | Fetch leaderboard | QUIC stream độc lập |
| Kết thúc ván | POST submit-score | 0-RTT nếu đã kết nối trước |
| Cả 2 cùng lúc | POST + GET đồng thời | Multiplexing, không HOL blocking |
| Đổi WiFi → 4G | Kết nối không bị đứt | QUIC connection migration |

> **Kết luận:** HTTP/3 không thay đổi *dữ liệu* được gửi — mà thay đổi *cách* gửi. Nhanh hơn, tin cậy hơn, và hiệu quả hơn so với HTTP/2.

---

*Được xây dựng cho môn Mạng Máy Tính — Minh hoạ QUIC / HTTP/3*
*Sinh viên: Nguyễn Mạnh Tiến — MSSV: 2451060726 — Lớp: 66CNTT2*
