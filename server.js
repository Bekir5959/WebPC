const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const { WebSocketServer } = require('ws');
const config = require('./config');
const logger = require('./logger');
const VncClient = require('./vncClient');
const FramePool = require('./framePool');
const PeerManager = require('./peerManager');

// --- Express + HTTP ---
const app = express();
app.use(express.static('public', { cacheControl: false, maxAge: 0 }));
app.use(helmet());
app.use(rateLimit({ windowMs: 10*1000, max: 100 }));
const server = http.createServer(app);

// --- WebSocket for signaling ---
const wss = new WebSocketServer({ server, path: '/ws' });
const peers = new PeerManager(wss);

// --- VNC client ---
const vnc = new VncClient();

// --- Frame processor pool ---
const processor = new FramePool();

// Sharp global settings
require('sharp').cache(false);
require('sharp').concurrency(0);

// Prometheus metrics
const client = require('prom-client');
client.collectDefaultMetrics();
const encodeHist = new client.Histogram({ name:'frame_encode_ms', help:'Frame encode duration', buckets:[5,10,20,30,50,75,100,150,250]});
const framesSent = new client.Counter({ name:'frames_sent_total', help:'Total frames broadcasted' });
const bufferedMaxGauge = new client.Gauge({ name:'datachannel_buffered_max', help:'Max bufferedAmount among peers' });

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

const healthz = (req, res) => {
  const healthy = vnc.frameBuf && processor.getQueueLength() < 100;
  res.status(healthy ? 200 : 503).send(healthy ? 'ok' : 'overloaded');
};
app.get('/healthz', healthz);

// --- Event wiring ---
peers.on('input', (type, payload) => vnc.handleInput(type, payload));

vnc.on('error', err => {
  console.error('VNC error:', err);
  process.exit(1);
});

// --- Main render loop ---
let isProcessing = false;
setInterval(async () => {
  if (isProcessing || peers.peers.size === 0 || !vnc.frameBuf) return;
  isProcessing = true;

  try {
    // If encoder backlog is high, drop this frame to prevent ping spike
    if (processor.getQueueLength() > 16) {
      isProcessing = false;
      return;
    }

    if (peers.anyNeedsFullFrame()) vnc.requestFullFrame();

    const rect = vnc.consumeDirtyBounds();
    if (!rect) {
      isProcessing = false;
      return;
    }

    // copy dirty rect into minimal buffer
    const { getBuf, release } = require('./bufferPool');
    const rectBuf = getBuf(rect.width * rect.height * 4);
    for (let row = 0; row < rect.height; row++) {
      const srcStart = ((rect.y + row) * vnc.width + rect.x) * 4;
      const dstStart = row * rect.width * 4;
      vnc.frameBuf.copy(rectBuf, dstStart, srcStart, srcStart + rect.width * 4);
    }

    // adaptive quality: small rect -> higher; large rect -> lower (dragging window)
    let q = config.JPEG_QUALITY;
    const area = rect.width * rect.height;
    const fullArea = vnc.width * vnc.height;
    if (area < fullArea / 16) {
      q = Math.min(q + 15, config.MAX_JPEG_QUALITY); // sharper tiny regions
    } else if (area > fullArea / 2) {
      q = Math.max(20, q - 20); // very large update, go low
    } else if (area > fullArea / 4) {
      q = Math.max(25, q - 10);
    }

    const start = Date.now();
    const buffer = await processor.process({
      buffer: rectBuf,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      quality: q,
    });
    encodeHist.observe(Date.now() - start);
    peers.broadcast(buffer);
    framesSent.inc();
    bufferedMaxGauge.set(peers.getMaxBufferedAmount());
    release(rectBuf);
    if (peers.anyNeedsFullFrame()) peers.resetFullFrameFlag();
  } catch (err) {
    // Frame processor busy or error
    if (err.message !== 'FrameProcessor busy') console.error('Frame loop error', err);
  } finally {
    isProcessing = false;
  }
}, 1000 / config.TARGET_FPS);

process.on('unhandledRejection', (r)=>logger.error({err:r},'unhandledRejection'));
process.on('uncaughtException', (e)=>{logger.error({err:e},'uncaught');process.exit(1);});

// --- Start server ---
server.listen(config.HTTP_PORT, () => {
  logger.info(`HTTP server listening on http://localhost:${config.HTTP_PORT}`);
}); 