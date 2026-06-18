import { connectMongo, disconnectMongo } from './config/mongo.js';
import { closeParserQueue, parserQueue } from './queue/parserQueue.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  await connectMongo();

  await parserQueue.add('googleMaps', {
    keywords: ['кофейня', 'фаст-фуд', 'кафе', 'ресторан'],
    location: 'Chișinău, Moldova'
  });

  await parserQueue.add('instagram', {
    hashtags: ['кофейнякишинев', 'chisinaucafe', 'chisinaufood'],
    locations: ['Chișinău'],
    competitors: []
  });

  logger.info('Parser jobs have been queued. Start worker with npm run worker.');
}

main()
  .catch((error) => {
    logger.error('Application failed', { error: error.message, stack: error.stack });
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeParserQueue();
    await disconnectMongo();
  });
