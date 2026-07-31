import pino from 'pino';

// Tek merkezi logger — her app bunu import eder, kendi pino instance'ini kurmaz.
const options: pino.LoggerOptions = { level: process.env.LOG_LEVEL ?? 'info' };
if (process.env.NODE_ENV !== 'production') {
  options.transport = { target: 'pino-pretty', options: { colorize: true } };
}

export const logger = pino(options);

export type Logger = typeof logger;
