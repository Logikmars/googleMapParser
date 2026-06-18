import validator from 'validator';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';
import { env } from '../config/env.js';
import { normalizePhone } from './normalizer.js';

const blockedEmailFragments = ['noreply', 'no-reply', 'donotreply', 'do-not-reply', 'example.com'];

export function validateEmail(email: string | undefined): boolean {
  if (!email) return false;

  const normalized = email.toLowerCase().trim();
  if (!validator.isEmail(normalized)) return false;
  return !blockedEmailFragments.some((fragment) => normalized.includes(fragment));
}

export function validatePhone(
  phone: string | undefined,
  region: CountryCode = env.DEFAULT_PHONE_REGION as CountryCode
): boolean {
  if (!phone) return false;

  const normalized = normalizePhone(phone, region);
  if (!normalized) return false;

  const parsed = parsePhoneNumberFromString(normalized, region);
  return parsed?.isValid() ?? false;
}

export function hasAnyContact(company: {
  phone?: string;
  email?: string;
  instagram?: string;
}): boolean {
  return Boolean(company.phone?.trim() || company.email?.trim() || company.instagram?.trim());
}

export function isCompanyValid(
  phone: string | undefined,
  email: string | undefined,
  instagram: string | undefined
): boolean {
  return Boolean(validateEmail(email) || validatePhone(phone) || instagram?.trim());
}
