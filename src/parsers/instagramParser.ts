import { IgApiClient } from 'instagram-private-api';
import { env } from '../config/env.js';
import type { PartialCompanyData } from '../types/index.js';
import { createRateLimiter, retryWithBackoff } from '../utils/rateLimit.js';
import { logger } from '../utils/logger.js';

type InstagramProfileLike = {
  username?: string;
  full_name?: string;
  biography?: string;
  external_url?: string;
  business_phone_number?: string;
  business_email?: string;
  public_email?: string;
  contact_phone_number?: string;
  is_business?: boolean;
  category?: string;
};

type InstagramLocationLike = {
  pk?: string | number;
  id?: string | number;
  external_id?: string | number;
};

function extractEmail(text: string): string {
  return text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0] ?? '';
}

function extractPhone(text: string): string {
  return text.match(/(?:\+?\d[\d\s().-]{6,}\d)/)?.[0] ?? '';
}

async function loginIfConfigured(ig: IgApiClient): Promise<void> {
  if (!env.INSTAGRAM_USERNAME || !env.INSTAGRAM_PASSWORD) {
    logger.warn('Instagram credentials are empty; Instagram parser will be skipped.');
    return;
  }

  ig.state.generateDevice(env.INSTAGRAM_USERNAME);
  await ig.account.login(env.INSTAGRAM_USERNAME, env.INSTAGRAM_PASSWORD);
}

async function profileToCompany(profile: InstagramProfileLike): Promise<PartialCompanyData | null> {
  const username = profile.username;
  if (!username) return null;

  const biography = profile.biography ?? '';
  const email = profile.business_email || profile.public_email || extractEmail(biography);
  const phone =
    profile.business_phone_number || profile.contact_phone_number || extractPhone(biography);

  if (!profile.is_business && !email && !phone) {
    return null;
  }

  return {
    name: profile.full_name || username,
    address: '',
    phone,
    email,
    instagram: `https://instagram.com/${username}`,
    website: profile.external_url ?? '',
    category: profile.category ?? '',
    rating: 0,
    source: 'instagram',
    scrapedAt: new Date(),
    isValid: false
  };
}

export async function parseInstagram(options: {
  hashtags?: string[];
  locations?: string[];
  competitors?: string[];
}): Promise<PartialCompanyData[]> {
  if (!env.INSTAGRAM_USERNAME || !env.INSTAGRAM_PASSWORD) {
    return [];
  }

  const ig = new IgApiClient();
  await loginIfConfigured(ig);

  const limiter = createRateLimiter(env.INSTAGRAM_MAX_REQUESTS_PER_MINUTE, 60_000);
  const usernames = new Set<string>(options.competitors?.map((value) => value.replace(/^@/, '')) ?? []);

  for (const hashtag of options.hashtags ?? []) {
    await limiter.add(async () => {
      const normalized = hashtag.replace(/^#/, '');
      logger.info('Parsing Instagram hashtag', { hashtag: normalized });
      const feed = ig.feed.tags(normalized, 'recent');
      const posts = await retryWithBackoff(() => feed.items(), 3, 3000);

      for (const post of posts.slice(0, 50)) {
        const username = post.user?.username;
        if (username) usernames.add(username);
      }
    });
  }

  for (const locationName of options.locations ?? []) {
    await limiter.add(async () => {
      logger.info('Parsing Instagram location', { location: locationName });
      const locations = await retryWithBackoff(
        () => ig.search.location(0, 0, locationName),
        3,
        3000
      );
      const location = locations?.[0] as InstagramLocationLike | undefined;
      const locationId = location?.pk ?? location?.id ?? location?.external_id;
      if (!locationId) return;

      const feed = ig.feed.location(Number(locationId), 'recent');
      const posts = await retryWithBackoff(() => feed.items(), 3, 3000);
      for (const post of posts.slice(0, 50)) {
        const username = post.user?.username;
        if (username) usernames.add(username);
      }
    });
  }

  const companies: PartialCompanyData[] = [];

  for (const username of usernames) {
    await limiter.add(async () => {
      logger.info('Parsing Instagram profile', { username });
      const userId = await retryWithBackoff(() => ig.user.getIdByUsername(username), 3, 3000);
      const profile = (await retryWithBackoff(
        () => ig.user.info(userId),
        3,
        3000
      )) as InstagramProfileLike;
      const company = await profileToCompany(profile);
      if (company) companies.push(company);
    });
  }

  return companies;
}
