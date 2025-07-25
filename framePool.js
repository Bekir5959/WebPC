const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');

class FramePool {
  constructor(size = os.cpus().length) {
    this.workers = [];
    this.queue = [];
    for (let i = 0; i < size; i++) {
      this.workers.push(this._createWorker());
    }
  }

  _createWorker() {
    const worker = new Worker(path.resolve(__dirname, 'frameWorker.js'));
    worker.busy = false;
    worker.current = null;
    worker.on('message', msg => {
      worker.busy = false;
      if (worker.current) {
        const { resolve, reject } = worker.current;
        worker.current = null;
        if (msg && msg.error) reject(new Error(msg.error));
        else resolve(msg);
      }
      this._processQueue();
    });
    worker.on('error', err => {
      worker.busy = false;
      if (worker.current) {
        worker.current.reject(err);
        worker.current = null;
      }
      this._processQueue();
    });
    return worker;
  }

  _processQueue() {
    while (this.queue.length) {
      const worker = this.workers.find(w => !w.busy);
      if (!worker) break;
      const job = this.queue.shift();
      worker.busy = true;
      worker.current = job;
      worker.postMessage(job.payload);
    }
  }

  process(payload) {
    return new Promise((resolve, reject) => {
      if (this.queue.length > 200) {
        return reject(new Error('Backpressure'));
      }
      this.queue.push({ payload, resolve, reject });
      this._processQueue();
    });
  }

  getQueueLength() {
    return this.queue.length;
  }
}

module.exports = FramePool; 