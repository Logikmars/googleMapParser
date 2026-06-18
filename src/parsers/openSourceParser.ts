import axios from 'axios';
import * as cheerio from 'cheerio';
import type { Browser } from 'puppeteer';
import type { PartialCompanyData } from '../types/index.js';
import { createBrowser, preparePage } from './browser.js';
import { logger } from '../utils/logger.js';
import { retryWithBackoff } from '../utils/rateLimit.js';
import { validateEmail } from '../services/validator.js';

const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const phoneRegex = /(?:\+?\d[\d\s().-]{6,}\d)/g;
const contactWords = [
  'contact',
  'contacts',
  'contact-us',
  'about',
  'about-us',
  'impressum',
  'support',
  'feedback',
  'reservation',
  'booking',
  'kontakty',
  'kontakt',
  'contatti',
  'despre',
  '\u043a\u043e\u043d\u0442\u0430\u043a',
  '\u043a\u043e\u043d\u0442\u0430\u043a\u0442\u0438',
  '\u043e \u043d\u0430\u0441',
  '\u043f\u0440\u043e \u043d\u0430\u0441'
];

function absoluteUrl(baseUrl: string, href: string): string {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return '';
  }
}

function cleanEmail(value: string): string {
  return value
    .replace(/^mailto:/i, '')
    .split('?')[0]
    .trim()
    .toLowerCase();
}

function cleanPhone(value: string): string {
  return value.replace(/^tel:/i, '').trim();
}

function decodeCloudflareEmail(hex: string): string {
  const key = Number.parseInt(hex.slice(0, 2), 16);
  let email = '';

  for (let i = 2; i < hex.length; i += 2) {
    email += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16) ^ key);
  }

  return email;
}

function findContactLinks(baseUrl: string, html: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href') ?? '';
    const text = $(element).text().toLowerCase();
    const haystack = `${text} ${href}`.toLowerCase();

    if (contactWords.some((word) => haystack.includes(word))) {
      const url = absoluteUrl(baseUrl, href);
      if (url && url.startsWith('http')) links.add(url);
    }
  });

  const origin = new URL(baseUrl).origin;
  for (const path of ['/contact', '/contacts', '/contact-us', '/about', '/about-us']) {
    links.add(`${origin}${path}`);
  }

  return Array.from(links).slice(0, 8);
}

async function fetchStatic(url: string): Promise<string> {
  const response = await axios.get<string>(url, {
    timeout: 20000,
    maxRedirects: 5,
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    validateStatus: (status) => status >= 200 && status < 400
  });

  return response.data;
}

async function fetchRendered(browser: Browser, url: string): Promise<string> {
  const page = await browser.newPage();
  try {
    await preparePage(page);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    return await page.content();
  } finally {
    await page.close();
  }
}

function extractEmails(html: string): string[] {
  const $ = cheerio.load(html);
  const emails = new Set<string>();

  $('a[href^="mailto:"]').each((_, element) => {
    const href = $(element).attr('href');
    if (href) emails.add(cleanEmail(href));
  });

  $('[data-cfemail]').each((_, element) => {
    const encoded = $(element).attr('data-cfemail');
    if (encoded) emails.add(decodeCloudflareEmail(encoded));
  });

  for (const match of html.matchAll(emailRegex)) {
    emails.add(cleanEmail(match[0]));
  }

  return Array.from(emails).filter(validateEmail);
}

function extractPhones(html: string): string[] {
  const $ = cheerio.load(html);
  const phones = new Set<string>();
  const text = $.text().replace(/\s+/g, ' ');

  $('a[href^="tel:"]').each((_, element) => {
    const href = $(element).attr('href');
    if (href) phones.add(cleanPhone(href));
  });

  for (const match of text.matchAll(phoneRegex)) {
    phones.add(cleanPhone(match[0]));
  }

  return Array.from(phones);
}

function extractCompany(url: string, htmlPages: string[], category = ''): PartialCompanyData | null {
  const html = htmlPages.join('\n');
  const $ = cheerio.load(htmlPages[0] ?? '');
  const emails = extractEmails(html);
  const phones = extractPhones(html);
  const title = $('title').text().trim() || new URL(url).hostname.replace(/^www\./, '');

  if (!emails.length && !phones.length) return null;

  return {
    name: title,
    address: '',
    phone: phones[0] ?? '',
    email: emails[0] ?? '',
    instagram:
      html.match(/https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9_.]+/i)?.[0] ?? '',
    website: url,
    category,
    rating: 0,
    source: 'open_source',
    scrapedAt: new Date(),
    isValid: false
  };
}

export async function parseOpenSources(
  urls: string[],
  category = ''
): Promise<PartialCompanyData[]> {
  if (!urls.length) return [];

  const browser = await createBrowser();

  try {
    const companies: PartialCompanyData[] = [];

    for (const url of urls) {
      logger.info('Parsing open source website', { url });

      try {
        const firstHtml = await retryWithBackoff(async () => {
          try {
            return await fetchStatic(url);
          } catch {
            return fetchRendered(browser, url);
          }
        }, 2, 1500);

        const contactLinks = findContactLinks(url, firstHtml);
        const pages = [firstHtml];

        for (const contactUrl of contactLinks) {
          try {
            const html = await retryWithBackoff(async () => {
              try {
                return await fetchStatic(contactUrl);
              } catch {
                return fetchRendered(browser, contactUrl);
              }
            }, 1, 1000);
            pages.push(html);
          } catch (error) {
            logger.warn('Contact page parsing failed', {
              url: contactUrl,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }

        const company = extractCompany(url, pages, category);
        if (company) companies.push(company);
      } catch (error) {
        logger.warn('Website parsing failed', {
          url,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return companies;
  } finally {
    await browser.close();
  }
}
