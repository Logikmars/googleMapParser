import type { Browser, Page } from 'puppeteer';
import { env } from '../config/env.js';
import type { PartialCompanyData } from '../types/index.js';
import { createBrowser, preparePage } from './browser.js';
import { logger } from '../utils/logger.js';
import { mapWithConcurrency, randomDelay, retryWithBackoff } from '../utils/rateLimit.js';

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

const nonPlaceWebsiteDomains = [
  'facebook.com',
  'instagram.com',
  'tripadvisor.',
  'foursquare.',
  'yelp.',
  'restaurantguru.',
  'findglocal.',
  'mapcarta.',
  'wikipedia.org',
  'guide.',
  'places.',
  'directory.',
  'thecoffeevine.com',
  'funtime.kiev.ua'
];

function parseRating(value?: string): number {
  if (!value) return 0;
  const normalized = value.replace(',', '.').match(/\d+(\.\d+)?/)?.[0];
  return normalized ? Number(normalized) : 0;
}

function isNonPlaceWebsite(value: string | undefined): boolean {
  if (!value) return false;

  try {
    const url = new URL(value);
    const domain = url.hostname.toLowerCase().replace(/^www\./, '');
    return nonPlaceWebsiteDomains.some((blocked) => domain.includes(blocked));
  } catch {
    return nonPlaceWebsiteDomains.some((blocked) => value.toLowerCase().includes(blocked));
  }
}

function isLikelyGoogleMapsPlace(company: GoogleMapsRawCompany): boolean {
  if (company.placeUrl) return true;
  if (!company.address) return false;
  return Boolean(company.phone || company.instagram || !isNonPlaceWebsite(company.website));
}

async function acceptGoogleConsentIfShown(page: Page): Promise<void> {
  await page.evaluate(() => {
    const consentWords = [
      'accept all',
      'i agree',
      'agree',
      'принять все',
      'принять',
      'согласен',
      'соглашаюсь',
      'прийняти всі',
      'прийняти',
      'погоджуюся'
    ];
    const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
    const button = buttons.find((element) => {
      const text = `${element.textContent ?? ''} ${
        element.getAttribute('value') ?? ''
      }`.toLowerCase();
      return consentWords.some((word) => text.includes(word));
    });

    if (button instanceof HTMLElement) button.click();
  });
}

async function getPageDiagnostics(page: Page): Promise<{
  title: string;
  url: string;
  bodyText: string;
  isBlocked: boolean;
  isConsent: boolean;
}> {
  return page.evaluate(() => {
    const title = document.title;
    const url = window.location.href;
    const bodyText = (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 500);
    const haystack = `${title} ${url} ${bodyText}`.toLowerCase();

    return {
      title,
      url,
      bodyText,
      isBlocked:
        haystack.includes('/sorry/') ||
        haystack.includes('unusual traffic') ||
        haystack.includes('captcha') ||
        haystack.includes('our systems have detected'),
      isConsent:
        haystack.includes('consent.google') ||
        haystack.includes('before you continue') ||
        haystack.includes('прежде чем перейти') ||
        haystack.includes('перш ніж перейти')
    };
  });
}

async function waitForGoogleMapsResults(page: Page): Promise<boolean> {
  await acceptGoogleConsentIfShown(page);

  try {
    await page.waitForFunction(
      () =>
        Boolean(
          document.querySelector('[role="feed"], .Nv2PK, [role="article"], a.hfpxzc') ||
            document.querySelector('input#searchboxinput')
        ),
      { timeout: 45000 }
    );

    return Boolean(
      await page.$('[role="feed"], .Nv2PK, [role="article"], a.hfpxzc')
    );
  } catch {
    return false;
  }
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

async function extractCompanyDetailsInNewPage(
  browser: Browser,
  company: GoogleMapsRawCompany
): Promise<GoogleMapsRawCompany> {
  if (!company.placeUrl) return company;

  const page = await browser.newPage();
  try {
    await preparePage(page);
    return await extractCompanyDetails(page, company);
  } finally {
    await page.close();
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

      let rawCompanies: GoogleMapsRawCompany[];

      try {
        rawCompanies = await retryWithBackoff(async () => {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

          const hasResults = await waitForGoogleMapsResults(page);
          if (!hasResults) {
            const diagnostics = await getPageDiagnostics(page);
            throw new Error(
              `Google Maps results were not found. title="${diagnostics.title}" url="${diagnostics.url}" blocked=${diagnostics.isBlocked} consent=${diagnostics.isConsent} body="${diagnostics.bodyText}"`
            );
          }

          await autoScrollResults(page);
          return extractCompanies(page);
        }, 3, 2000);
      } catch (error) {
        logger.warn('Google Maps keyword skipped', {
          keyword,
          location,
          error: error instanceof Error ? error.message : String(error)
        });
        continue;
      }

      rawCompanies = rawCompanies
        .filter(isLikelyGoogleMapsPlace)
        .slice(0, env.GOOGLE_MAPS_MAX_RESULTS);

      if (env.GOOGLE_MAPS_PARSE_DETAILS) {
        rawCompanies = await mapWithConcurrency(
          rawCompanies,
          env.GOOGLE_MAPS_DETAILS_CONCURRENCY,
          async (company, index) => {
            if (!company.placeUrl) return company;

            logger.info('Parsing Google Maps place details', {
              keyword,
              index: index + 1,
              total: rawCompanies.length,
              name: company.name
            });

            await randomDelay(200, 700);
            return extractCompanyDetailsInNewPage(browser, company);
          }
        );
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
          googleMapsUrl: raw.placeUrl ?? '',
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
