const SimplePeer = require('simple-peer');
const wrtc = require('@roamhq/wrtc');
const { EventEmitter } = require('events');
const { z } = require('zod');

const loginSchema = z.object({ type:z.literal('login'), username:z.string().regex(/^[a-zA-Z0-9_-]{3,16}$/) });
const controlSchema = z.object({ type:z.literal('control'), action:z.enum(['request','release']) });
const inputSchema = z.object({ type:z.literal('input'), inputType:z.string(), payload:z.any() });

class PeerManager extends EventEmitter {
  constructor(wss) {
    super();
    this.wss = wss;
    this.peers = new Map();
    this.usernames = new Set();
    this.currentController = null; // clientId
    this.controlQueue = [];
    this._wire();
  }

  _wire() {
    this.wss.on('connection', ws => {
      const clientId = Math.random().toString(36).substring(2, 9);
      ws.clientId = clientId;
      ws.needsFullFrame = true;
      this.emit('clientConnected', clientId);

      ws.on('message', msg => this._handleMessage(ws, msg));
      ws.on('close', () => this._handleClose(ws));
    });
  }

  _handleMessage(ws, msg) {
    try {
      let payload;
      try { payload = JSON.parse(msg); } catch{ return; }

      // İlk aşama: kullanıcı adı ataması
      if (!ws.username) {
        const safe = loginSchema.safeParse(payload);
        if (safe.success) {
          payload=safe.data;
          if (this.usernames.has(payload.username)) {
            ws.send(JSON.stringify({ type: 'login', ok: false, reason: 'taken' }));
            ws.close();
          } else {
            ws.username = payload.username;
            this.usernames.add(payload.username);
            ws.send(JSON.stringify({ type: 'login', ok: true }));
            // mevcut denetleyiciyi bildir
            ws.send(JSON.stringify({ type: 'controller', username: this.currentControllerUsername || null }));
            this.emit('clientLoggedIn', ws.clientId, ws.username);
          }
        }
        return;
      }

      // Sonraki mesajlar
      if (inputSchema.safeParse(payload).success) {
        if (ws.clientId === this.currentController) {
          this.emit('input', payload.inputType, payload.payload);
        }
        return;
      }

      if (controlSchema.safeParse(payload).success) {
        this._handleControl(ws, payload.action);
        return;
      }
      if (payload.type === 'signal') {
        this._handleSignal(ws, payload.data);
      }
    } catch (e) {
      console.error('WS message parse error', e);
    }
  }

  _handleSignal(ws, data) {
    let peer = this.peers.get(ws.clientId);
    if (!peer) {
      peer = new SimplePeer({
        initiator: false,
        trickle: true,
        wrtc,
        channelConfig: { ordered: false, maxRetransmits: 0 },
      });
      this.peers.set(ws.clientId, peer);

      peer.on('signal', signal => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'signal', data: signal }));
        }
      });
      peer.on('connect', () => {
        ws.needsFullFrame = true;
        const chan = peer._channel;
        if (chan) {
          chan.bufferedAmountLowThreshold = 128 * 1024;
          chan.onbufferedamountlow = () => {
            // could notify for stats if needed
          };
        }
        this.emit('peerConnected', ws.clientId);
      });
      peer.on('close', () => {
        this.peers.delete(ws.clientId);
        this.emit('peerDisconnected', ws.clientId);
      });
      peer.on('error', err => console.error('Peer error', err));
    }
    peer.signal(data);
  }

  _handleClose(ws) {
    const peer = this.peers.get(ws.clientId);
    if (peer && !peer.destroyed) peer.destroy();
    this.peers.delete(ws.clientId);
    if (ws.username) this.usernames.delete(ws.username);

    // Remove from control queue or transfer if was controller
    if (this.currentController === ws.clientId) {
      this._grantNextController();
    } else {
      this.controlQueue = this.controlQueue.filter(id => id !== ws.clientId);
    }
    this.emit('clientDisconnected', ws.clientId);
  }

  _handleControl(ws, action) {
    if (action === 'request') {
      if (this.currentController === null) {
        this.currentController = ws.clientId;
        ws.send(JSON.stringify({ type: 'control', granted: true }));
        this.emit('controlGranted', ws.clientId);
      } else if (!this.controlQueue.includes(ws.clientId)) {
        this.controlQueue.push(ws.clientId);
        ws.send(JSON.stringify({ type: 'control', granted: false, queued: true }));
      }
    }

    if (action === 'release' && ws.clientId === this.currentController) {
      this._grantNextController();
    }
  }

  _grantNextController() {
    const next = this.controlQueue.shift() || null;
    this.currentController = next;
    if (next) {
      const wsNext = [...this.wss.clients].find(c => c.clientId === next);
      if (wsNext && wsNext.readyState === wsNext.OPEN) {
        wsNext.send(JSON.stringify({ type: 'control', granted: true }));
        this.currentControllerUsername = wsNext.username;
      }
    } else {
      this.currentControllerUsername = null;
    }
    this._broadcastController();
  }

  _broadcastController() {
    const payload = JSON.stringify({ type: 'controller', username: this.currentControllerUsername || null });
    this.wss.clients.forEach(c => { if (c.readyState === c.OPEN) c.send(payload); });
  }

  broadcast(buffer) {
    const MAX_BACKLOG = 1_000_000; // 1 MB
    this.peers.forEach(peer => {
      if (peer && peer.connected) {
        const chan = peer._channel;
        if (chan && chan.bufferedAmount > MAX_BACKLOG) return; // skip congested peer
        try {
          peer.send(buffer);
        } catch (e) {
          console.error('Peer send error', e);
        }
      }
    });
  }

  anyNeedsFullFrame() {
    let needs = false;
    this.wss.clients.forEach(ws => {
      if (ws.needsFullFrame) needs = true;
    });
    return needs;
  }

  resetFullFrameFlag() {
    this.wss.clients.forEach(ws => (ws.needsFullFrame = false));
  }

  getMaxBufferedAmount() {
    let max = 0;
    this.peers.forEach(p => {
      if (p && p._channel) max = Math.max(max, p._channel.bufferedAmount);
    });
    return max;
  }
}

module.exports = PeerManager; 