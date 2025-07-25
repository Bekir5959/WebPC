const { parentPort } = require('worker_threads');
const sharp = require('sharp');

parentPort.on('message', async msg => {
  const { buffer, x, y, width, height, quality } = msg;
  try {
    const jpegBuf = await sharp(Buffer.from(buffer), {
      raw: { width, height, channels: 4 },
    })
      .jpeg({ quality: Math.min(quality, 60), progressive: true, mozjpeg: true, chromaSubsampling: '4:2:0' })
      .toBuffer();

    const header = Buffer.alloc(8);
    header.writeUInt32BE(x, 0);
    header.writeUInt32BE(y, 4);
    parentPort.postMessage(Buffer.concat([header, jpegBuf]));
  } catch (err) {
    parentPort.postMessage({ error: err.message });
  }
}); 