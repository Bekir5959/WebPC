const EventEmitter = require('events');
const RfbClient = require('rfb2');
const { VNC_HOST, VNC_PORT } = require('./config');

class VncClient extends EventEmitter {
  constructor() {
    super();
    this.dirtyRects = [];
    this.bounds = { x: Infinity, y: Infinity, maxX: 0, maxY: 0 };
    this.frameBuf = null;
    this.width = 0;
    this.height = 0;
    
    // Basılı tuş ve fare durumlarını takip etmek için
    this.pressedKeys = new Set();
    this.pressedMouseButtons = 0;

    this.rfb = RfbClient.createConnection({
      host: VNC_HOST,
      port: VNC_PORT,
      securityType: 'none',
    });

    this._wireEvents();
  }

  _wireEvents() {
    this.rfb.on('connect', () => {
      this.width = this.rfb.width;
      this.height = this.rfb.height;
      this.frameBuf = Buffer.alloc(this.width * this.height * 4);
      this.rfb.requestUpdate(false, 0, 0, this.width, this.height);
      this.emit('ready', { width: this.width, height: this.height });
    });

    this.rfb.on('rect', rect => {
      if (rect.encoding !== RfbClient.encodings.raw) return;
      const { x, y, width: w, height: h, data } = rect;

      for (let row = 0; row < h; row++) {
        const srcOffset = row * w * 4;
        const dstOffset = ((y + row) * this.width + x) * 4;
        for (let col = 0; col < w; col++) {
          const src = srcOffset + col * 4;
          const dst = dstOffset + col * 4;
          this.frameBuf[dst] = data[src + 2];
          this.frameBuf[dst + 1] = data[src + 1];
          this.frameBuf[dst + 2] = data[src];
          this.frameBuf[dst + 3] = 255;
        }
      }

      this.dirtyRects.push({ x, y, w, h });
      this.bounds.x = Math.min(this.bounds.x, x);
      this.bounds.y = Math.min(this.bounds.y, y);
      this.bounds.maxX = Math.max(this.bounds.maxX, x + w);
      this.bounds.maxY = Math.max(this.bounds.maxY, y + h);
      this.emit('rect', { x, y, w, h });
      this.rfb.requestUpdate(true, 0, 0, this.width, this.height);
    });

    this.rfb.on('error', err => {
      this.emit('error', err);
    });
  }

  requestFullFrame() {
    this.dirtyRects.push({ x: 0, y: 0, w: this.width, h: this.height });
    this.bounds = { x: 0, y: 0, maxX: this.width, maxY: this.height };
  }

  consumeDirtyBounds() {
    if (this.dirtyRects.length === 0) return null;
    const rect = {
      x: this.bounds.x,
      y: this.bounds.y,
      width: this.bounds.maxX - this.bounds.x,
      height: this.bounds.maxY - this.bounds.y,
    };
    this.dirtyRects = [];
    this.bounds = { x: Infinity, y: Infinity, maxX: 0, maxY: 0 };
    return rect;
  }

  handleInput(type, payload) {
    switch (type) {
      case 'mouseMove':
        // Sadece hareket varsa, durumu güncellemeden direkt gönder
        this.rfb.pointerEvent(payload.x, payload.y, payload.buttonMask);
        break;
      case 'mouseDown':
        this.pressedMouseButtons |= payload.buttonMask;
        this.rfb.pointerEvent(payload.x, payload.y, payload.buttonMask);
        break;
      case 'mouseUp':
        this.pressedMouseButtons &= ~payload.buttonMask;
        this.rfb.pointerEvent(payload.x, payload.y, payload.buttonMask);
        break;
      case 'keyEvent':
        // Klavye durumunu güncelle
        if (payload.down) {
          this.pressedKeys.add(payload.keysym);
        } else {
          this.pressedKeys.delete(payload.keysym);
        }
        this.rfb.keyEvent(payload.keysym, payload.down);
        break;
      default:
        console.warn('Unknown input type:', type);
    }
  }

  // Tüm basılı tuş ve fare düğmelerini sıfırla
  resetInputState() {
    // Basılı tüm tuşları bırak
    this.pressedKeys.forEach(keysym => {
      this.rfb.keyEvent(keysym, false);
    });
    this.pressedKeys.clear();
    
    // Fare düğmelerini sıfırla
    if (this.pressedMouseButtons !== 0) {
      this.rfb.pointerEvent(0, 0, 0);
      this.pressedMouseButtons = 0;
    }
  }
}

module.exports = VncClient; 