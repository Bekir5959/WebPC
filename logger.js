const pino = require('pino');

const level = process.env.LOG_LEVEL || 'info';
const destination = process.env.LOG_FILE;
const logger = destination ? pino({ level }, pino.destination({ dest: destination, mkdir: true })) : pino({ level });

module.exports = logger; 