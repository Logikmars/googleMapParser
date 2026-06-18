import { Queue } from 'bullmq';
import { redisConnection } from './connection.js';

export const parserQueue = new Queue('parser', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000
    },
    removeOnComplete: {
      age: 60 * 60 * 24,
      count: 1000
    },
    removeOnFail: {
      age: 60 * 60 * 24 * 7
    }
  }
});

export async function closeParserQueue(): Promise<void> {
  await parserQueue.close();
}
