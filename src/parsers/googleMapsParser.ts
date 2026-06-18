import type { Page } from 'puppeteer';
import { env } from '../config/env.js';
import type { PartialCompanyData } from '../types/index.js';
import { createBrowser, preparePage } from './browser.js';
import { logger } from '../utils/logger.js';
import { randomDelay, retryWithBackoff } from '../utils/rateLimit.js';

interface GoogleMapsRawCompany {
  name?: string;
  address?: string;
  phone?: string;
  website?: string;
  rating?: string;
  category?: string;
  instagram?: string;
  placeUrl?: string;
}

function parseRating(value?: string): number {
  if (!value) return 0;
  const normalized = value.replace(',', '.').match(/\d+(\.\d+)?/)?.[0];
  return normalized ? Number(normalized) : 0;
}

async function autoScrollResults(page: Page): Promise<void> {
  await page.evaluate(`
    (async () => {
      const feed = document.querySelector('[role="feed"]');
      const target = feed || document.scrollingElement || document.documentElement;
      let lastCount = 0;
      let stableRounds = 0;

      for (let i = 0; i < 40; i += 1) {
        target.scrollBy(0, 1800);
        await new Promise((resolve) => setTimeout(resolve, 750));

        const count = document.querySelectorAll('[role="article"], .Nv2PK, .hfpxzc').length;
        if (count <= lastCount) {
          stableRounds += 1;
        } else {
          stableRounds = 0;
          lastCount = count;
        }

        if (stableRounds >= 5) break;
      }
    })()
  `);
}

async function extractCompanies(page: Page): Promise<GoogleMapsRawCompany[]> {
  const companies = await page.evaluate(`
    (() => {
      const textOf = (root, selector) =>
        root.querySelector(selector)?.textContent?.trim() || '';

      const hrefOf = (root, selector) =>
        root.querySelector(selector)?.href || '';

      const cards = Array.from(
        document.querySelectorAll('[role="article"], .Nv2PK, .hfpxzc')
      );

      return cards.map((card) => {
        const text = card.textContent || '';
        const links = Array.from(card.querySelectorAll('a')).map((a) => a.href || '');
        const placeUrl =
          card.querySelector('a.hfpxzc')?.href ||
          links.find((href) => href.includes('/maps/place/') || href.includes('google.com/maps?')) ||
          '';
        const website =
          hrefOf(card, 'a[data-value="Website"]') ||
          links.find((href) =>
            href &&
            !href.includes('google.') &&
            !href.includes('/maps/') &&
            !href.includes('instagram.com')
          ) ||
          '';
        const instagram = links.find((href) => /instagram\\.com/i.test(href)) || '';
        const phone = text.match(/(?:\\+?\\d[\\d\\s().-]{6,}\\d)/)?.[0] || '';
        const rating = text.match(/\\b[1-5][,.]\\d\\b/)?.[0] || '';
        const lines = text
          .split('\\n')
          .map((line) => line.trim())
          .filter(Boolean);
        const address =
          lines.find((line) =>
            /\\d/.test(line) &&
            !line.includes(String.fromCharCode(9733)) &&
            !/open|closed|reviews|review|stars/i.test(line)
          ) || '';

        return {
          name:
            textOf(card, '.qBF1Pd') ||
            textOf(card, '.fontHeadlineSmall') ||
            card.getAttribute('aria-label') ||
            lines[0] ||
            '',
          address,
          phone,
          website,
          rating,
          category: '',
          instagram,
          placeUrl
        };
      });
    })()
  `);

  return companies as GoogleMapsRawCompany[];
}

async function extractCompanyDetails(page: Page, company: GoogleMapsRawCompany): Promise<GoogleMapsRawCompany> {
  if (!company.placeUrl) return company;

  try {
    await page.goto(company.placeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('h1, [role="main"]', { timeout: 30000 });
    await randomDelay(1200, 1200);

    const details = await page.evaluate(`
      (() => {
        const text = (selector) => document.querySelector(selector)?.textContent?.trim() || '';
        const attr = (selector, name) => document.querySelector(selector)?.getAttribute(name) || '';
        const cleanLabel = (value) =>
          (value || '')
            .replace(/^(Address|Phone|Website|Directions|Call):?\\s*/i, '')
            .replace(/^Адрес:?\\s*/i, '')
            .replace(/^Телефон:?\\s*/i, '')
            .replace(/^Веб-сайт:?\\s*/i, '')
            .trim();

        const buttons = Array.from(document.querySelectorAll('button, a'));
        const byLabel = (re) => {
          const el = buttons.find((node) => re.test(node.getAttribute('aria-label') || ''));
          return cleanLabel(el?.getAttribute('aria-label') || el?.textContent || '');
        };

        const websiteEl =
          document.querySelector('a[data-item-id="authority"]') ||
          document.querySelector('a[aria-label^="Website"]') ||
          document.querySelector('a[aria-label^="Веб"]');
        const phoneEl =
          document.querySelector('button[data-item-id^="phone:tel"]') ||
          document.querySelector('button[aria-label^="Phone"]') ||
          document.querySelector('button[aria-label^="Телефон"]');
        const addressEl =
          document.querySelector('button[data-item-id="address"]') ||
          document.querySelector('button[aria-label^="Address"]') ||
          document.querySelector('button[aria-label^="Адрес"]');

        const allLinks = Array.from(document.querySelectorAll('a')).map((a) => a.href || '');

        return {
          name: text('h1') || attr('h1', 'aria-label'),
          address: cleanLabel(addressEl?.getAttribute('aria-label') || addressEl?.textContent || byLabel(/^(Address|Адрес)/i)),
          phone: cleanLabel(phoneEl?.getAttribute('aria-label') || phoneEl?.textContent || byLabel(/^(Phone|Телефон)/i)),
          website: websiteEl?.href || '',
          rating: text('.F7nice span[aria-hidden="true"]') || text('[role="img"][aria-label*="stars"]'),
          category: text('button[jsaction*="category"]') || '',
          instagram: allLinks.find((href) => /instagram\\.com/i.test(href)) || ''
        };
      })()
    `) as GoogleMapsRawCompany;

    return {
      ...company,
      name: details.name || company.name,
      address: details.address || company.address,
      phone: details.phone || company.phone,
      website: details.website || company.website,
      rating: details.rating || company.rating,
      category: details.category || company.category,
      instagram: details.instagram || company.instagram
    };
  } catch (error) {
    logger.warn('Google Maps detail parsing failed', {
      name: company.name,
      placeUrl: company.placeUrl,
      error: error instanceof Error ? error.message : String(error)
    });
    return company;
  }
}

export async function parseGoogleMaps(
  keywords: string[],
  location: string
): Promise<PartialCompanyData[]> {
  const browser = await createBrowser();

  try {
    const page = await browser.newPage();
    await preparePage(page);

    const results: PartialCompanyData[] = [];

    for (const keyword of keywords) {
      await randomDelay(env.GOOGLE_MAPS_MIN_DELAY_MS, env.GOOGLE_MAPS_MAX_DELAY_MS);

      const query = encodeURIComponent(`${keyword} in ${location}`);
      const url = `https://www.google.com/maps/search/${query}`;
      logger.info('Parsing Google Maps', { keyword, location, url });

      let rawCompanies = await retryWithBackoff(async () => {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('[role="feed"], .Nv2PK, [role="article"]', { timeout: 30000 });
        await autoScrollResults(page);
        return extractCompanies(page);
      }, 3, 2000);

      rawCompanies = rawCompanies.slice(0, env.GOOGLE_MAPS_MAX_RESULTS);

      if (env.GOOGLE_MAPS_PARSE_DETAILS) {
        const detailedCompanies: GoogleMapsRawCompany[] = [];

        for (const [index, company] of rawCompanies.entries()) {
          if (!company.placeUrl) {
            detailedCompanies.push(company);
            continue;
          }

          logger.info('Parsing Google Maps place details', {
            keyword,
            index: index + 1,
            total: rawCompanies.length,
            name: company.name
          });

          detailedCompanies.push(await extractCompanyDetails(page, company));
          await randomDelay(700, 1600);
        }

        rawCompanies = detailedCompanies;
      }

      for (const raw of rawCompanies) {
        if (!raw.name) continue;

        results.push({
          name: raw.name,
          address: raw.address ?? '',
          phone: raw.phone ?? '',
          email: '',
          instagram: raw.instagram ?? '',
          website: raw.website ?? '',
          category: raw.category || keyword,
          rating: parseRating(raw.rating),
          source: 'google_maps',
          scrapedAt: new Date(),
          isValid: false
        });
      }
    }

    return results;
  } finally {
    await browser.close();
  }
}
