import puppeteer, { Browser, Page } from 'puppeteer';
import { env } from '../config/env.js';

export async function createBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: env.PUPPETEER_HEADLESS,
    executablePath: env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled'
    ]
  });
}

export async function preparePage(page: Page): Promise<void> {
  await page.setViewport({ width: 1366, height: 900 });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
}
