import type { Page } from 'puppeteer';
import { env } from '../config/env.js';
import type { PartialCompanyData } from '../types/index.js';
import { normalizeWebsiteDomain } from '../services/normalizer.js';
import { createBrowser, preparePage } from './browser.js';
import { logger } from '../utils/logger.js';
import { randomDelay, retryWithBackoff } from '../utils/rateLimit.js';

const blockedDomains = [
  'google.',
  'gstatic.',
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'youtube.com',
  'tripadvisor.',
  'foursquare.',
  'yelp.',
  'wolt.',
  'glovo.',
  'bolt.',
  'ubereats.',
  'raketa.',
  'tomato.ua',
  'restaurantguru.',
  'findglocal.',
  'mapcarta.',
  'wikipedia.org',
  'lviv.travel',
  'visitukraine',
  'guide.',
  'places.',
  'directory.'
];

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUsefulWebsite(url: string): boolean {
  const domain = normalizeWebsiteDomain(url);
  if (!domain) return false;
  return !blockedDomains.some((blocked) => domain.includes(blocked));
}

function compact(value: string): string {
  return normalizeName(value).replace(/\s+/g, '');
}

function websiteScore(url: string, companyName: string): number {
  const domain = normalizeWebsiteDomain(url);
  const compactDomain = compact(domain);
  const name = normalizeName(companyName);
  const compactName = compact(name);
  const tokens = name.split(' ').filter((token) => token.length >= 4);

  let score = 0;
  if (compactName && compactDomain.includes(compactName)) score += 100;
  for (const token of tokens) {
    if (compactDomain.includes(token)) score += 25;
  }
  if (domain.endsWith('.ua')) score += 5;
  if (/shop|store|menu|delivery/i.test(domain)) score -= 5;

  return score;
}

function selectBestWebsite(urls: string[], companyName: string): string {
  return urls
    .map((url) => ({ url, score: websiteScore(url, companyName) }))
    .sort((a, b) => b.score - a.score)[0]?.url ?? '';
}

async function extractSearchResults(page: Page): Promise<string[]> {
  const urls = await page.evaluate(`
    (() => Array.from(document.querySelectorAll('a'))
      .map((a) => a.href || '')
      .filter((href) => /^https?:\\/\\//i.test(href))
      .map((href) => {
        try {
          const url = new URL(href);
          if (url.pathname === '/url') return url.searchParams.get('q') || href;
          return href;
        } catch {
          return href;
        }
      }))()
  `);

  return Array.from(new Set(urls as string[])).filter(isUsefulWebsite);
}

export async function findWebsitesWithGoogleSearch(
  companies: PartialCompanyData[],
  location: string
): Promise<PartialCompanyData[]> {
  const targets = companies
    .filter((company) => company.name && !company.website)
    .slice(0, env.GOOGLE_SEARCH_MAX_COMPANIES);

  if (!targets.length) return companies;

  const browser = await createBrowser();
  const foundByName = new Map<string, string>();

  try {
    const page = await browser.newPage();
    await preparePage(page);

    for (const company of targets) {
      const queries = [
        `"${company.name}" ${location} official website`,
        `"${company.name}" ${company.address || location} contacts`,
        `"${company.name}" ${location} site`
      ];
      const allResults: string[] = [];

      logger.info('Searching website with Google Search', {
        name: company.name,
        location
      });

      for (const rawQuery of queries) {
        const query = encodeURIComponent(rawQuery);
        const url = `https://www.google.com/search?q=${query}&num=10&hl=en`;

        const results = await retryWithBackoff(async () => {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await page.waitForSelector('a', { timeout: 20000 });
          return extractSearchResults(page);
        }, 2, 2000);

        allResults.push(...results);
        await randomDelay(900, 1800);
      }

      const website = selectBestWebsite(
        Array.from(new Set(allResults)).slice(0, env.GOOGLE_SEARCH_RESULTS_PER_COMPANY),
        company.name
      );
      if (website) foundByName.set(normalizeName(company.name), website);

      await randomDelay(1500, 3500);
    }
  } finally {
    await browser.close();
  }

  return companies.map((company) => {
    if (company.website) return company;

    const website = foundByName.get(normalizeName(company.name));
    return website ? { ...company, website } : company;
  });
}
