import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stringify } from 'csv-stringify/sync';
import { connectMongo, disconnectMongo } from '../config/mongo.js';
import { Company } from '../models/Company.js';
import { logger } from '../utils/logger.js';

export type ExportMode = 'valid' | 'raw' | 'all';

const columns = [
  'name',
  'address',
  'phone',
  'email',
  'instagram',
  'website',
  'category',
  'rating',
  'source',
  'isValid',
  'scrapedAt',
  'createdAt',
  'updatedAt'
];

function queryForMode(mode: ExportMode): Record<string, unknown> {
  if (mode === 'valid') return { isValid: true };
  if (mode === 'raw') return { isValid: { $ne: true } };
  return {};
}

export async function buildCompaniesCSV(mode: ExportMode = 'valid'): Promise<{
  csv: string;
  count: number;
}> {
  const companies = await Company.find(queryForMode(mode))
    .sort({ scrapedAt: -1 })
    .lean()
    .exec();

  const rows = companies.map((company) => ({
    name: company.name,
    address: company.address,
    phone: company.phone,
    email: company.email,
    instagram: company.instagram,
    website: company.website,
    category: company.category,
    rating: company.rating,
    source: company.source,
    isValid: company.isValid,
    scrapedAt: company.scrapedAt?.toISOString?.() ?? '',
    createdAt: company.createdAt?.toISOString?.() ?? '',
    updatedAt: company.updatedAt?.toISOString?.() ?? ''
  }));

  return {
    csv: stringify(rows, { header: true, columns }),
    count: companies.length
  };
}

export async function exportToCSV(
  outputPath = 'output/companies.csv',
  mode: ExportMode = 'valid'
): Promise<void> {
  await connectMongo();

  const { csv, count } = await buildCompaniesCSV(mode);
  const absolutePath = resolve(outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, csv, 'utf8');
  logger.info('CSV exported', { count, mode, outputPath: absolutePath });
}

function parseMode(value: string | undefined): ExportMode {
  if (value === 'raw' || value === 'all' || value === 'valid') return value;
  return 'valid';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = parseMode(process.argv[2]);
  const outputPath =
    process.argv[3] ??
    (mode === 'valid' ? 'output/companies.csv' : `output/companies-${mode}.csv`);

  exportToCSV(outputPath, mode)
    .catch((error) => {
      logger.error('CSV export failed', { error: error.message, stack: error.stack });
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectMongo();
    });
}
