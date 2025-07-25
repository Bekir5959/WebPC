require('dotenv').config();

module.exports = {
  // VNC connection
  VNC_HOST: process.env.VNC_HOST || '127.0.0.1',
  VNC_PORT: parseInt(process.env.VNC_PORT || '5901', 10),

  // HTTP / WebSocket
  HTTP_PORT: parseInt(process.env.HTTP_PORT || '3000', 10),

  // Video / Encoding
  MAX_JPEG_QUALITY: 60,
  JPEG_QUALITY: Math.min(parseInt(process.env.JPEG_QUALITY || '40', 10), 60),
  TARGET_FPS: parseInt(process.env.TARGET_FPS || '30', 10),
}; 