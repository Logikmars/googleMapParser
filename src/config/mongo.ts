import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

export async function connectMongo(): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);

  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  await mongoose.connect(env.MONGO_URI);
  logger.info('MongoDB connected', { uri: env.MONGO_URI });
  return mongoose;
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
  logger.info('MongoDB disconnected');
}
