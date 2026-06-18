import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';
import { Company } from '../models/Company.js';

async function migrateCompanyIndexes(): Promise<void> {
  const indexes = await Company.collection.indexes();
  const indexNames = new Set(indexes.map((index) => index.name));
  const websiteDomainIndex = indexes.find((index) => index.name === 'websiteDomain_1');

  if (indexNames.has('website_1')) {
    await Company.collection.dropIndex('website_1');
    logger.info('Dropped legacy MongoDB index', { index: 'website_1' });
  }

  if (websiteDomainIndex && !websiteDomainIndex.unique) {
    await Company.collection.dropIndex('websiteDomain_1');
    logger.info('Dropped non-unique MongoDB index', { index: 'websiteDomain_1' });
  }

  try {
    await Company.syncIndexes();
  } catch (error) {
    logger.warn('MongoDB index sync skipped', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function connectMongo(): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);

  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  await mongoose.connect(env.MONGO_URI);
  logger.info('MongoDB connected', { uri: env.MONGO_URI });
  await migrateCompanyIndexes();
  return mongoose;
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
  logger.info('MongoDB disconnected');
}
