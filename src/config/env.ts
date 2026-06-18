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
  DEFAULT_PHONE_REGION: readString('DEFAULT_PHONE_REGION', 'UA'),
  PUPPETEER_HEADLESS: readBoolean('PUPPETEER_HEADLESS', true),
  PUPPETEER_EXECUTABLE_PATH: readString('PUPPETEER_EXECUTABLE_PATH'),
  GOOGLE_MAPS_MIN_DELAY_MS: readNumber('GOOGLE_MAPS_MIN_DELAY_MS', 3000),
  GOOGLE_MAPS_MAX_DELAY_MS: readNumber('GOOGLE_MAPS_MAX_DELAY_MS', 5000),
  GOOGLE_MAPS_MAX_RESULTS: readNumber('GOOGLE_MAPS_MAX_RESULTS', 250),
  GOOGLE_MAPS_PARSE_DETAILS: readBoolean('GOOGLE_MAPS_PARSE_DETAILS', true),
  GOOGLE_MAPS_ENRICH_WEBSITES: readBoolean('GOOGLE_MAPS_ENRICH_WEBSITES', true),
  WEBSITE_ENRICH_MAX_PER_JOB: readNumber('WEBSITE_ENRICH_MAX_PER_JOB', 150),
  EXCLUDE_CHAINS: readBoolean('EXCLUDE_CHAINS', true),
  CHAIN_MAX_SAME_NAME_PER_JOB: readNumber('CHAIN_MAX_SAME_NAME_PER_JOB', 2),
  CHAIN_DENYLIST: readString(
    'CHAIN_DENYLIST',
    'kfc,mcdonald,mc donald,макдональдс,макдоналдс,макдональдз,макдональд,пузата хата,puzata hata,puzatahata,burger king,starbucks,domino,pizza hut,subway,hesburger'
  ),
  INSTAGRAM_USERNAME: readString('INSTAGRAM_USERNAME'),
  INSTAGRAM_PASSWORD: readString('INSTAGRAM_PASSWORD'),
  INSTAGRAM_MAX_REQUESTS_PER_MINUTE: readNumber('INSTAGRAM_MAX_REQUESTS_PER_MINUTE', 20),
  LOG_LEVEL: readString('LOG_LEVEL', 'info'),
  ADMIN_PORT: readNumber('ADMIN_PORT', 3000)
} as const;
