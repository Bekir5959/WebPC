# WebPC

A high-performance Node.js gateway for streaming VNC (Virtual Network Computing) desktops to web clients using WebRTC. This project captures a VNC server's framebuffer, encodes screen updates as JPEG images, and streams them to connected clients with low latency. It also relays user input (mouse, keyboard) from clients back to the VNC server.

---

## Features
- **VNC to WebRTC streaming**: Real-time screen sharing from a VNC server to multiple web clients.
- **Efficient frame encoding**: Only dirty (changed) regions are encoded and sent, with adaptive JPEG quality.
- **Parallel processing**: Uses worker threads for fast, non-blocking image encoding.
- **Peer management**: Handles multiple clients, input control queue, and congestion control.
- **Queue-based control system**: Fair control distribution with time limits and queue management.
- **Prometheus metrics**: Exposes `/metrics` for monitoring.
- **Security**: Uses helmet, rate limiting, and input validation.

---

## Architecture

- **Express** serves static files and API endpoints.
- **WebSocket** is used for signaling and control messages.
- **PeerManager** manages WebRTC peers and input control with queue system.
- **VncClient** connects to the VNC server, tracks framebuffer, and emits updates.
- **FramePool** encodes dirty framebuffer regions in parallel using worker threads.
- **BufferPool** optimizes memory usage for image buffers.

```
Client <-> WebSocket/HTTP <-> [Node.js Server] <-> VNC Server
```

---

## Control System

The application implements a fair queue-based control system:

- **Time-limited control**: Each user gets 15 seconds of control time (configurable)
- **Automatic queue management**: Users are automatically queued when requesting control
- **Fair distribution**: Control automatically passes to the next person in queue
- **Real-time feedback**: Users see their queue position and estimated wait time
- **Visual indicators**: Queue status panel shows current controller and queue information

### Control Features:
- **Request control**: Click "Kontrolü Al" to join the queue
- **Automatic transfer**: Control automatically passes after time limit expires
- **Manual release**: Users can manually release control before time expires
- **Queue visibility**: See your position and estimated wait time
- **Time remaining**: Countdown timer shows remaining control time

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
4. **Enter a username** and connect to the system.
5. **Request control** by clicking "Kontrolü Al" to join the queue.
6. **Wait for your turn** - the system will automatically grant control when it's your turn.
7. **Use the remote desktop** - you have 15 seconds of control time.
8. **Control automatically passes** to the next person in queue.

---

## Configuration

All configuration can be set via environment variables or by editing `config.js`:
- `VNC_HOST`: Hostname/IP of the VNC server
- `VNC_PORT`: Port of the VNC server
- `HTTP_PORT`: Port for the HTTP/WebSocket server
- `JPEG_QUALITY`: Default JPEG quality (max 60)
- `TARGET_FPS`: Target frames per second
- `CONTROL_TIME_LIMIT`: Control time limit in seconds (default: 15)
- `LOG_LEVEL`: Logging level (info, debug, etc.)
- `LOG_FILE`: Log file path (optional)

---

## Security & Performance Notes
- Uses helmet and express-rate-limit for HTTP security.
- Queue-based control system ensures fair access for all users.
- Only allows one client to control input at a time (others are queued).
- Skips sending frames to peers with high network congestion.
- No personal information is stored or transmitted by the codebase.

---

## License
MIT License
