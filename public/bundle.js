// src/client/config.js
var WEBSOCKET_URL = `ws://${location.host}/ws`;

// src/client/webrtc.js
function initializeWebRTC(wsUrl, canvas) {
  const ws = new WebSocket(wsUrl);
  let peer;
  let frameQueue = [];
  let isFirstFrame = true;
  const worker = new Worker(new URL("./renderer.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }) => {
    if (data.error) {
      console.error("Worker error:", data.error);
      return;
    }
    frameQueue.push(data);
  };
  function renderLoop() {
    while (frameQueue.length > 0) {
      const { bitmap, x, y, width, height } = frameQueue.shift();
      if (bitmap) {
        const ctx = canvas.getContext("2d", { alpha: false });
        if (isFirstFrame && x === 0 && y === 0) {
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
          }
          isFirstFrame = false;
        }
        ctx.drawImage(bitmap, x, y);
        bitmap.close();
      }
    }
    requestAnimationFrame(renderLoop);
  }
  renderLoop();
  ws.onopen = () => {
    console.log("WebSocket connection established.");
    peer = new SimplePeer({ initiator: true, trickle: true });
    peer.on("signal", (data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "signal", data }));
      }
    });
    peer.on("connect", () => console.log("WebRTC peer connected."));
    peer.on("data", (data) => {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const x = view.getUint32(0);
      const y = view.getUint32(4);
      const jpegData = data.slice(8);
      worker.postMessage({ x, y, jpegData }, [jpegData.buffer]);
    });
    peer.on("error", (err) => console.error("WebRTC error:", err));
    peer.on("close", () => {
      console.log("WebRTC connection closed.");
      isFirstFrame = true;
      frameQueue.length = 0;
    });
  };
  ws.onmessage = (e) => {
    const signalData = JSON.parse(e.data);
    if (signalData.type === "signal" && peer && !peer.destroyed) {
      peer.signal(signalData.data);
    }
  };
  ws.onerror = (e) => console.error("WebSocket error:", e);
  ws.onclose = () => {
    console.log("WebSocket connection closed.");
    if (peer && !peer.destroyed) peer.destroy();
  };
  function sendInput(type, payload) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", inputType: type, payload }));
    }
  }
  return { sendInput };
}

// src/client/keys.js
var PHYSICAL_KEY_KEYSYM_MAP = {
  "Escape": 65307,
  "Digit1": 49,
  "Digit2": 50,
  "Digit3": 51,
  "Digit4": 52,
  "Digit5": 53,
  "Digit6": 54,
  "Digit7": 55,
  "Digit8": 56,
  "Digit9": 57,
  "Digit0": 48,
  "Minus": 45,
  "Equal": 61,
  "Backspace": 65288,
  "Tab": 65289,
  "KeyQ": 113,
  "KeyW": 119,
  "KeyE": 101,
  "KeyR": 114,
  "KeyT": 116,
  "KeyY": 121,
  "KeyU": 117,
  "KeyI": 105,
  "KeyO": 111,
  "KeyP": 112,
  "BracketLeft": 91,
  "BracketRight": 93,
  "Enter": 65293,
  "ControlLeft": 65507,
  "KeyA": 97,
  "KeyS": 115,
  "KeyD": 100,
  "KeyF": 102,
  "KeyG": 103,
  "KeyH": 104,
  "KeyJ": 106,
  "KeyK": 107,
  "KeyL": 108,
  "Semicolon": 59,
  "Quote": 39,
  "Backquote": 96,
  "ShiftLeft": 65505,
  "Backslash": 92,
  "KeyZ": 122,
  "KeyX": 120,
  "KeyC": 99,
  "KeyV": 118,
  "KeyB": 98,
  "KeyN": 110,
  "KeyM": 109,
  "Comma": 44,
  "Period": 46,
  "Slash": 47,
  "ShiftRight": 65506,
  "AltLeft": 65513,
  "AltRight": 65514,
  "Space": 32,
  "ControlRight": 65508,
  "F1": 65470,
  "F2": 65471,
  "F3": 65472,
  "F4": 65473,
  "F5": 65474,
  "F6": 65475,
  "F7": 65476,
  "F8": 65477,
  "F9": 65478,
  "F10": 65479,
  "F11": 65480,
  "F12": 65481,
  "ArrowUp": 65362,
  "ArrowDown": 65364,
  "ArrowLeft": 65361,
  "ArrowRight": 65363,
  "Insert": 65379,
  "Delete": 65535,
  "Home": 65360,
  "End": 65367,
  "PageUp": 65365,
  "PageDown": 65366,
  "NumLock": 65407,
  "CapsLock": 65509,
  "ScrollLock": 65300,
  "Pause": 65299,
  "PrintScreen": 65377
};

// src/client/ui.js
function setupCanvas(canvas, sendInput) {
  canvas.focus();
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  function getCanvasCoord(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);
    return { x, y };
  }
  let currentMouseButtonMask = 0;
  canvas.addEventListener("mousemove", (e) => {
    const { x, y } = getCanvasCoord(e);
    sendInput("mouseMove", { x, y, buttonMask: currentMouseButtonMask });
  });
  canvas.addEventListener("mousedown", (e) => {
    const { x, y } = getCanvasCoord(e);
    currentMouseButtonMask |= 1 << e.button;
    sendInput("mouseDown", { x, y, buttonMask: currentMouseButtonMask });
  });
  canvas.addEventListener("mouseup", (e) => {
    const { x, y } = getCanvasCoord(e);
    currentMouseButtonMask &= ~(1 << e.button);
    sendInput("mouseUp", { x, y, buttonMask: currentMouseButtonMask });
  });
  canvas.addEventListener("keydown", (e) => {
    e.preventDefault();
    const keysym = PHYSICAL_KEY_KEYSYM_MAP[e.code];
    if (keysym !== void 0) {
      sendInput("keyEvent", { keysym, down: true });
    } else {
      console.warn(`Unknown key code: ${e.code}`);
    }
  });
  canvas.addEventListener("keyup", (e) => {
    e.preventDefault();
    const keysym = PHYSICAL_KEY_KEYSYM_MAP[e.code];
    if (keysym !== void 0) {
      sendInput("keyEvent", { keysym, down: false });
    }
  });
}

// src/client/index.js
document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("screen");
  if (!canvas) {
    console.error("Canvas element not found!");
    return;
  }
  const { sendInput } = initializeWebRTC(WEBSOCKET_URL, canvas);
  setupCanvas(canvas, sendInput);
  console.log("Client application initialized.");
});
