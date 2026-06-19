import 'dotenv/config';

function readString(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Environment variable ${name} must be a number.`);
  }

  return value;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export const env = {
  NODE_ENV: readString('NODE_ENV', 'development'),
  MONGO_URI: readString('MONGO_URI', 'mongodb://localhost:27017/company-parser'),
  REDIS_HOST: readString('REDIS_HOST', 'localhost'),
  REDIS_PORT: readNumber('REDIS_PORT', 6379),
  REDIS_PASSWORD: readString('REDIS_PASSWORD'),
  REDIS_DB: readNumber('REDIS_DB', 0),
  WORKER_CONCURRENCY: readNumber('WORKER_CONCURRENCY', 1),
  WORKER_LOCK_DURATION_MS: readNumber('WORKER_LOCK_DURATION_MS', 300000),
  WORKER_STALLED_INTERVAL_MS: readNumber('WORKER_STALLED_INTERVAL_MS', 60000),
  WORKER_MAX_STALLED_COUNT: readNumber('WORKER_MAX_STALLED_COUNT', 3),
  DEFAULT_PHONE_REGION: readString('DEFAULT_PHONE_REGION', 'UA'),
  PUPPETEER_HEADLESS: readBoolean('PUPPETEER_HEADLESS', true),
  PUPPETEER_EXECUTABLE_PATH: readString('PUPPETEER_EXECUTABLE_PATH'),
  PUPPETEER_BLOCK_HEAVY_RESOURCES: readBoolean('PUPPETEER_BLOCK_HEAVY_RESOURCES', true),
  GOOGLE_MAPS_MIN_DELAY_MS: readNumber('GOOGLE_MAPS_MIN_DELAY_MS', 3000),
  GOOGLE_MAPS_MAX_DELAY_MS: readNumber('GOOGLE_MAPS_MAX_DELAY_MS', 5000),
  GOOGLE_MAPS_MAX_RESULTS: readNumber('GOOGLE_MAPS_MAX_RESULTS', 250),
  GOOGLE_MAPS_PARSE_DETAILS: readBoolean('GOOGLE_MAPS_PARSE_DETAILS', true),
  GOOGLE_MAPS_DETAILS_CONCURRENCY: readNumber('GOOGLE_MAPS_DETAILS_CONCURRENCY', 3),
  GOOGLE_MAPS_ENRICH_WEBSITES: readBoolean('GOOGLE_MAPS_ENRICH_WEBSITES', true),
  GOOGLE_SEARCH_ENRICH_MISSING_WEBSITES: readBoolean(
    'GOOGLE_SEARCH_ENRICH_MISSING_WEBSITES',
    true
  ),
  GOOGLE_SEARCH_MAX_COMPANIES: readNumber('GOOGLE_SEARCH_MAX_COMPANIES', 40),
  GOOGLE_SEARCH_RESULTS_PER_COMPANY: readNumber('GOOGLE_SEARCH_RESULTS_PER_COMPANY', 10),
  GOOGLE_SEARCH_CONCURRENCY: readNumber('GOOGLE_SEARCH_CONCURRENCY', 2),
  WEBSITE_ENRICH_MAX_PER_JOB: readNumber('WEBSITE_ENRICH_MAX_PER_JOB', 150),
  WEBSITE_PARSE_CONCURRENCY: readNumber('WEBSITE_PARSE_CONCURRENCY', 6),
  WEBSITE_CONTACT_CONCURRENCY: readNumber('WEBSITE_CONTACT_CONCURRENCY', 4),
  EXCLUDE_CHAINS: readBoolean('EXCLUDE_CHAINS', true),
  CHAIN_MAX_SAME_NAME_PER_JOB: readNumber('CHAIN_MAX_SAME_NAME_PER_JOB', 2),
  CHAIN_DENYLIST: readString(
    'CHAIN_DENYLIST',
    'kfc,mcdonald,mc donald,макдональдс,макдоналдс,макдональдз,макдональд,пузата хата,puzata hata,puzatahata,burger king,starbucks,domino,pizza hut,subway,hesburger'
  ),
  EXCLUDED_CATEGORIES: readString(
    'EXCLUDED_CATEGORIES',
    'shopping mall,mall,shopping center,shopping centre,trade center,retail park,hotel,supermarket,grocery store,gas station,market,hypermarket,convenience store,food court,delivery service,wholesale,трц,тц,торговий центр,торговый центр'
  ),
  INSTAGRAM_USERNAME: readString('INSTAGRAM_USERNAME'),
  INSTAGRAM_PASSWORD: readString('INSTAGRAM_PASSWORD'),
  INSTAGRAM_MAX_REQUESTS_PER_MINUTE: readNumber('INSTAGRAM_MAX_REQUESTS_PER_MINUTE', 20),
  LOG_LEVEL: readString('LOG_LEVEL', 'info'),
  ADMIN_PORT: readNumber('ADMIN_PORT', 3000)
} as const;
