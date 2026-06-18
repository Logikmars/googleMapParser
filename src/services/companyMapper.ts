import type { CompanyData, PartialCompanyData } from '../types/index.js';
import {
  normalizeEmail,
  normalizeInstagram,
  normalizePhone,
  normalizeWebsite,
  normalizeWebsiteDomain
} from './normalizer.js';
import { isCompanyValid } from './validator.js';

export function toCompanyData(input: PartialCompanyData): CompanyData {
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  const instagram = normalizeInstagram(input.instagram);
  const website = normalizeWebsite(input.website);
  const websiteDomain = normalizeWebsiteDomain(website);

  return {
    name: input.name.trim(),
    address: input.address?.trim() ?? '',
    phone,
    email,
    instagram,
    website,
    websiteDomain,
    googleMapsUrl: input.googleMapsUrl?.trim() ?? '',
    category: input.category?.trim() ?? '',
    rating: Number.isFinite(input.rating) ? Number(input.rating) : 0,
    source: input.source,
    scrapedAt: input.scrapedAt ?? new Date(),
    isValid: isCompanyValid(phone, email, instagram)
  };
}
