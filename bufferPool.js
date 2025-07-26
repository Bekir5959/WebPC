const pools = new Map();

function getBuf(size) {
  const list = pools.get(size);
  if (list && list.length) {
    return list.pop();
  }
  return Buffer.allocUnsafe(size);
}

function release(buf) {
  const size = buf.length;
  if (!pools.has(size)) pools.set(size, []);
  const list = pools.get(size);
  if (list.length < 32) list.push(buf); // limit per size
}

module.exports = { getBuf, release }; 