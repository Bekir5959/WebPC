const SimplePeer = require('simple-peer');
const wrtc = require('@roamhq/wrtc');
const { EventEmitter } = require('events');
const { z } = require('zod');
const config = require('./config');

const loginSchema = z.object({ type:z.literal('login'), username:z.string().regex(/^[a-zA-Z0-9_-]{3,16}$/) });
const controlSchema = z.object({ type:z.literal('control'), action:z.enum(['request','release']) });
const inputSchema = z.object({ type:z.literal('input'), inputType:z.string(), payload:z.any() });

class PeerManager extends EventEmitter {
  constructor(wss, vnc) {
    super();
    this.wss = wss;
    this.vnc = vnc; // VNC istemcisini sakla
    this.peers = new Map();
    this.usernames = new Set();
    this.currentController = null; // clientId
    this.currentControllerUsername = null;
    this.controlStartTime = null; // When current controller got control
    this.controlTimeLimit = config.CONTROL_TIME_LIMIT; // From config
    this.controlQueue = []; // Array of {clientId, username, requestTime}
    this.lastExpiredController = null; // Track who was the last controller to expire
    this._wire();
    // Start the control timer
    this._startControlTimer();
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

  _startControlTimer() {
    // Check every second if control time has expired
    setInterval(() => {
      if (this.currentController && this.controlStartTime) {
        const elapsed = Date.now() - this.controlStartTime;
        if (elapsed >= this.controlTimeLimit) {
          console.log(`Control time expired for ${this.currentControllerUsername} (${elapsed}ms)`);
          this._forceControlTransfer();
        }
      }
    }, 1000);
  }

  _forceControlTransfer() {
    if (this.currentController) {
      const ws = [...this.wss.clients].find(c => c.clientId === this.currentController);
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'control', expired: true }));
      }
      this.lastExpiredController = this.currentController; // Mark this user as recently expired
      this._grantNextController();
    }
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
            // mevcut denetleyiciyi ve kuyruk bilgilerini bildir
            ws.send(JSON.stringify({ 
              type: 'controller', 
              username: this.currentControllerUsername || null,
              queuePosition: this._getQueuePosition(ws.clientId),
              queueLength: this.controlQueue.length,
              timeRemaining: this._getTimeRemaining(),
              queue: this.controlQueue.map(item => item.username)
            }));
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

  _getQueuePosition(clientId) {
    const index = this.controlQueue.findIndex(item => item.clientId === clientId);
    return index >= 0 ? index + 1 : null;
  }

  _getTimeRemaining() {
    if (!this.currentController || !this.controlStartTime) return null;
    const elapsed = Date.now() - this.controlStartTime;
    const remaining = Math.max(0, this.controlTimeLimit - elapsed);
    return Math.ceil(remaining / 1000); // Return seconds
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
      this.controlQueue = this.controlQueue.filter(item => item.clientId !== ws.clientId);
      this._broadcastQueueUpdate();
    }
    this.emit('clientDisconnected', ws.clientId);
  }

  _handleControl(ws, action) {
    if (action === 'request') {
      const isRequestFromLastExpiredController = (this.currentController === null && this.lastExpiredController === ws.clientId);

      if (this.currentController === null && !isRequestFromLastExpiredController) {
        // No current controller AND not the recently expired user, grant immediately
        this.currentController = ws.clientId;
        this.currentControllerUsername = ws.username;
        this.controlStartTime = Date.now();
        ws.send(JSON.stringify({ type: 'control', granted: true, timeLimit: this.controlTimeLimit }));
        this.emit('controlGranted', ws.clientId);
        this._broadcastController();
        this.lastExpiredController = null; // Clear this once someone new takes control
      } else if (this.currentController === ws.clientId) {
        // Already has control
        ws.send(JSON.stringify({ type: 'control', granted: true, timeLimit: this.controlTimeLimit }));
      } else if (!this.controlQueue.find(item => item.clientId === ws.clientId)) {
        // Add to queue (this covers both new requests and requests from recently expired users)
        this.controlQueue.push({
          clientId: ws.clientId,
          username: ws.username,
          requestTime: Date.now()
        });
        ws.send(JSON.stringify({ 
          type: 'control', 
          granted: false, 
          queued: true,
          queuePosition: this.controlQueue.length,
          estimatedWaitTime: this._estimateWaitTime()
        }));
        this._broadcastQueueUpdate();
      } else {
        // Already in queue
        const position = this._getQueuePosition(ws.clientId);
        ws.send(JSON.stringify({ 
          type: 'control', 
          granted: false, 
          queued: true,
          queuePosition: position,
          estimatedWaitTime: this._estimateWaitTime()
        }));
      }
    }

    if (action === 'release' && ws.clientId === this.currentController) {
      this.lastExpiredController = this.currentController; // Mark this user as recently released
      this._grantNextController();
    }
  }

  _estimateWaitTime() {
    if (this.controlQueue.length === 0) return 0;
    
    // Estimate based on current controller's remaining time + queue position
    const currentRemaining = this._getTimeRemaining() || 0;
    const queueWait = this.controlQueue.length * (this.controlTimeLimit / 1000); // Use actual time limit
    return currentRemaining + queueWait;
  }

  _grantNextController() {
    // Kontrol değişiminde VNC durumunu sıfırla
    if (this.vnc && typeof this.vnc.resetInputState === 'function') {
      this.vnc.resetInputState();
    }
    const next = this.controlQueue.shift();
    this.currentController = next ? next.clientId : null;
    this.currentControllerUsername = next ? next.username : null;
    this.controlStartTime = next ? Date.now() : null;
    
    if (next) {
      const wsNext = [...this.wss.clients].find(c => c.clientId === next.clientId);
      if (wsNext && wsNext.readyState === wsNext.OPEN) {
        wsNext.send(JSON.stringify({
          type: 'control',
          granted: true,
          timeLimit: this.controlTimeLimit
        }));
        console.log(`Control granted to ${next.username}`);
      }
      this.lastExpiredController = null;
    } else {
      this.lastExpiredController = null; 
    }
    this._broadcastController();
    this._broadcastQueueUpdate();
  }

  _broadcastController() {
    const queueUsernames = this.controlQueue.map(item => item.username);
    const payload = JSON.stringify({ 
      type: 'controller', 
      username: this.currentControllerUsername || null,
      timeRemaining: this._getTimeRemaining(),
      queue: queueUsernames,
      queueLength: this.controlQueue.length,
      timeLimit: this.controlTimeLimit // Send timeLimit to frontend
    });
    this.wss.clients.forEach(c => { 
      if (c.readyState === c.OPEN) c.send(payload); 
    });
  }

  _broadcastQueueUpdate() {
    const queueUsernames = this.controlQueue.map(item => item.username);
    this.wss.clients.forEach(ws => {
      if (ws.readyState === ws.OPEN) {
        const queuePosition = this._getQueuePosition(ws.clientId);
        const queueInfo = {
          type: 'queueUpdate',
          queuePosition: queuePosition,
          queueLength: this.controlQueue.length,
          estimatedWaitTime: this._estimateWaitTime(),
          queue: queueUsernames,
          timeLimit: this.controlTimeLimit // Send timeLimit to frontend
        };
        ws.send(JSON.stringify(queueInfo));
      }
    });
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