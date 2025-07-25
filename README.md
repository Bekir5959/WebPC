# WebPC

A high-performance Node.js gateway for streaming VNC (Virtual Network Computing) desktops to web clients using WebRTC. This project captures a VNC server's framebuffer, encodes screen updates as JPEG images, and streams them to connected clients with low latency. It also relays user input (mouse, keyboard) from clients back to the VNC server.

---

## Features
- **VNC to WebRTC streaming**: Real-time screen sharing from a VNC server to multiple web clients.
- **Efficient frame encoding**: Only dirty (changed) regions are encoded and sent, with adaptive JPEG quality.
- **Parallel processing**: Uses worker threads for fast, non-blocking image encoding.
- **Peer management**: Handles multiple clients, input control queue, and congestion control.
- **Prometheus metrics**: Exposes `/metrics` for monitoring.
- **Security**: Uses helmet, rate limiting, and input validation.

---

## Architecture

- **Express** serves static files and API endpoints.
- **WebSocket** is used for signaling and control messages.
- **PeerManager** manages WebRTC peers and input control.
- **VncClient** connects to the VNC server, tracks framebuffer, and emits updates.
- **FramePool** encodes dirty framebuffer regions in parallel using worker threads.
- **BufferPool** optimizes memory usage for image buffers.

```
Client <-> WebSocket/HTTP <-> [Node.js Server] <-> VNC Server
```

---

## Setup & Installation

1. **Clone the repository**
   ```sh
   git clone <your-repo-url>
   cd wstest
   ```
2. **Install dependencies**
   ```sh
   npm install
   ```

---

## Usage

1. **Start your VNC server** (e.g., on localhost:5901)
2. **Start the gateway server**
   ```sh
   npm start
   ```
3. **Open your browser** and navigate to `http://localhost:3000` (or your configured port).
4. **Connect as a client**. The web client will establish a WebRTC connection and begin streaming the VNC desktop.

---

## Configuration

All configuration can be set via environment variables or by editing `config.js`:
- `VNC_HOST`: Hostname/IP of the VNC server
- `VNC_PORT`: Port of the VNC server
- `HTTP_PORT`: Port for the HTTP/WebSocket server
- `JPEG_QUALITY`: Default JPEG quality (max 60)
- `TARGET_FPS`: Target frames per second
- `LOG_LEVEL`: Logging level (info, debug, etc.)
- `LOG_FILE`: Log file path (optional)

---

## Security & Performance Notes
- Uses helmet and express-rate-limit for HTTP security.
- Only allows one client to control input at a time (others are queued).
- Skips sending frames to peers with high network congestion.
- No personal information is stored or transmitted by the codebase.

---

---

## License
MIT License
