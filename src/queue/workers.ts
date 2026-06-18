import { Worker, type Job } from 'bullmq';
import { connectMongo } from '../config/mongo.js';
import { env } from '../config/env.js';
import { Company } from '../models/Company.js';
import { parseGoogleMaps } from '../parsers/googleMapsParser.js';
import { findWebsitesWithGoogleSearch } from '../parsers/googleSearchParser.js';
import { parseInstagram } from '../parsers/instagramParser.js';
import { parseOpenSources } from '../parsers/openSourceParser.js';
import { toCompanyData } from '../services/companyMapper.js';
import { deduplicateCompanies } from '../services/deduplicator.js';
import { hasAnyContact } from '../services/validator.js';
import { filterChains } from '../services/chainFilter.js';
import { filterExcludedCategories } from '../services/categoryFilter.js';
import type {
  GoogleMapsJobData,
  InstagramJobData,
  OpenSourceJobData,
  ParserJobData,
  ParserJobName,
  PartialCompanyData
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import { redisConnection } from './connection.js';

function isGoogleMapsJob(job: Job<ParserJobData, number, ParserJobName>): job is Job<GoogleMapsJobData, number, 'googleMaps'> {
  return job.name === 'googleMaps';
}

function isInstagramJob(job: Job<ParserJobData, number, ParserJobName>): job is Job<InstagramJobData, number, 'instagram'> {
  return job.name === 'instagram';
}

function isOpenSourceJob(job: Job<ParserJobData, number, ParserJobName>): job is Job<OpenSourceJobData, number, 'openSource'> {
  return job.name === 'openSource';
}

async function saveCompanies(rawCompanies: PartialCompanyData[]): Promise<number> {
  const contactedCompanies = deduplicateCompanies(rawCompanies.map(toCompanyData)).filter(hasAnyContact);
  const { kept: categoryCompanies, removed: categoryRemoved } =
    filterExcludedCategories(contactedCompanies);
  const { kept: companies, removed: chainCompanies } = filterChains(categoryCompanies);

  if (categoryRemoved.length) {
    logger.info('Filtered excluded categories', {
      removed: categoryRemoved.length,
      examples: categoryRemoved.slice(0, 5).map((company) => ({
        name: company.name,
        category: company.category
      }))
    });
  }

  if (chainCompanies.length) {
    logger.info('Filtered chain companies', {
      removed: chainCompanies.length,
      examples: chainCompanies.slice(0, 5).map((company) => company.name)
    });
  }

  if (!companies.length) return 0;

  const operations = companies.map((company) => ({
    updateOne: {
      filter: buildCompanyFilter(company),
      update: {
        $set: {
          ...company,
          updatedAt: new Date()
        },
        $setOnInsert: { createdAt: new Date() }
      },
      upsert: true
    }
  }));

  const result = await Company.bulkWrite(operations, { ordered: false });
  return result.upsertedCount + result.modifiedCount;
}

function buildCompanyFilter(company: ReturnType<typeof toCompanyData>): Record<string, unknown> {
  const or: Record<string, string>[] = [];

  if (company.email) or.push({ email: company.email });
  if (company.phone) or.push({ phone: company.phone });
  if (company.websiteDomain) or.push({ websiteDomain: company.websiteDomain });
  if (company.website) or.push({ website: company.website });

  if (or.length === 1) return or[0];
  if (or.length > 1) return { $or: or };

  return { name: company.name, address: company.address };
}

function normalizeUrlKey(value: string | undefined): string {
  if (!value) return '';

  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return value.trim().replace(/\/$/, '').toLowerCase();
  }
}

function mergeGoogleMapsWithWebsiteData(
  googleCompanies: PartialCompanyData[],
  websiteCompanies: PartialCompanyData[]
): PartialCompanyData[] {
  const websiteByUrl = new Map<string, PartialCompanyData>();

  for (const company of websiteCompanies) {
    const key = normalizeUrlKey(company.website);
    if (key) websiteByUrl.set(key, company);
  }

  return googleCompanies.map((company) => {
    const websiteData = websiteByUrl.get(normalizeUrlKey(company.website));
    if (!websiteData) return company;

    return {
      ...company,
      email: websiteData.email || company.email,
      phone: websiteData.phone || company.phone,
      instagram: websiteData.instagram || company.instagram,
      website: company.website || websiteData.website,
      category: company.category || websiteData.category
    };
  });
}

async function mergeWebsiteDataWithExisting(
  websiteCompanies: PartialCompanyData[]
): Promise<PartialCompanyData[]> {
  const websites = websiteCompanies
    .map((company) => company.website)
    .filter((website): website is string => Boolean(website));

  if (!websites.length) return websiteCompanies;

  const existingCompanies = await Company.find({ website: { $in: websites } })
    .lean()
    .exec();
  const existingByWebsite = new Map(
    existingCompanies.map((company) => [normalizeUrlKey(company.website), company])
  );

  return websiteCompanies.map((websiteCompany) => {
    const existing = existingByWebsite.get(normalizeUrlKey(websiteCompany.website));
    if (!existing) return websiteCompany;

    return {
      ...websiteCompany,
      name: existing.name || websiteCompany.name,
      address: existing.address || websiteCompany.address,
      phone: websiteCompany.phone || existing.phone,
      email: websiteCompany.email || existing.email,
      instagram: websiteCompany.instagram || existing.instagram,
      category: existing.category || websiteCompany.category,
      rating: existing.rating || websiteCompany.rating,
      source: existing.source || websiteCompany.source
    };
  });
}

function uniqueWebsites(companies: PartialCompanyData[]): string[] {
  const websites = new Map<string, string>();

  for (const company of companies) {
    if (!company.website) continue;
    const key = normalizeUrlKey(company.website);
    if (key && !websites.has(key)) websites.set(key, company.website);
  }

  return Array.from(websites.values()).slice(0, env.WEBSITE_ENRICH_MAX_PER_JOB);
}

export const parserWorker = new Worker<ParserJobData, number, ParserJobName>(
  'parser',
  async (job) => {
    await connectMongo();
    logger.info('Started parser job', { id: job.id, name: job.name });

    let companies: PartialCompanyData[];
    let enriched = 0;

    if (isGoogleMapsJob(job)) {
      companies = await parseGoogleMaps(job.data.keywords, job.data.location);

      if (env.GOOGLE_SEARCH_ENRICH_MISSING_WEBSITES) {
        companies = await findWebsitesWithGoogleSearch(companies, job.data.location);
      }

      const websites = uniqueWebsites(companies);
      if (env.GOOGLE_MAPS_ENRICH_WEBSITES && websites.length) {
        logger.info('Enriching Google Maps companies from websites', {
          id: job.id,
          websites: websites.length
        });
        const websiteCompanies = await parseOpenSources(websites);
        enriched = websiteCompanies.length;
        companies = mergeGoogleMapsWithWebsiteData(companies, websiteCompanies);
      }
    } else if (isInstagramJob(job)) {
      companies = await parseInstagram(job.data);
    } else if (isOpenSourceJob(job)) {
      companies = await parseOpenSources(job.data.urls, job.data.category);
      companies = await mergeWebsiteDataWithExisting(companies);
    } else {
      throw new Error(`Unknown parser job: ${job.name}`);
    }

    const saved = await saveCompanies(companies);
    logger.info('Finished parser job', {
      id: job.id,
      name: job.name,
      parsed: companies.length,
      enriched,
      saved
    });

    return saved;
  },
  {
    connection: redisConnection,
    concurrency: 2,
    limiter: {
      max: 20,
      duration: 60_000
    }
  }
);

parserWorker.on('failed', (job, error) => {
  logger.error('Parser job failed', {
    id: job?.id,
    name: job?.name,
    error: error.message,
    stack: error.stack
  });
});

parserWorker.on('completed', (job, result) => {
  logger.info('Parser job completed', { id: job.id, name: job.name, result });
});

logger.info('Parser worker is running');
