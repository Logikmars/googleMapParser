import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';
import { env } from '../config/env.js';

function stripPhoneNoise(phone: string): string {
  return phone
    .replace(/[^\d+]/g, '')
    .replace(/(?!^)\+/g, '');
}

function withPlus(value: string): string {
  return value.startsWith('+') ? value : `+${value}`;
}

function normalizeUkrainianCandidate(value: string): string {
  const compact = stripPhoneNoise(value);
  const digits = compact.replace(/\D/g, '');

  if (compact.startsWith('+380') && digits.length === 12) return compact;
  if (compact.startsWith('+38') && digits.length === 12) return `+${digits}`;
  if (compact.startsWith('+3') && digits.length === 12) return `+${digits}`;
  if (compact.startsWith('+38') && digits.length === 11) return `+380${digits.slice(2)}`;
  if (compact.startsWith('+3') && digits.length === 10) return `+380${digits.slice(1)}`;
  if (compact.startsWith('+') && digits.length === 12 && digits.startsWith('380')) {
    return `+${digits}`;
  }

  if (digits.length === 12 && digits.startsWith('380')) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith('38')) return `+380${digits.slice(2)}`;
  if (digits.length === 11 && digits.startsWith('80')) return `+3${digits}`;
  if (digits.length === 10 && digits.startsWith('3')) return `+380${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith('0')) return `+38${digits}`;
  if (digits.length === 9) return `+380${digits}`;

  return compact;
}

export function normalizePhone(
  phone: string | undefined,
  region: CountryCode = env.DEFAULT_PHONE_REGION as CountryCode
): string {
  if (!phone) return '';

  const compact = stripPhoneNoise(phone);
  if (compact.replace(/\D/g, '').length < 9) return '';

  const candidates =
    region === 'UA'
      ? [normalizeUkrainianCandidate(compact), compact]
      : [compact, withPlus(compact)];

  for (const candidate of candidates) {
    const parsed = parsePhoneNumberFromString(candidate, region);
    if (parsed?.isValid()) return parsed.number;
  }

  const fallback = parsePhoneNumberFromString(normalizeUkrainianCandidate(compact), 'UA');
  return fallback?.isValid() ? fallback.number : '';
}

export function normalizeEmail(email: string | undefined): string {
  return email?.toLowerCase().trim() ?? '';
}

export function normalizeInstagram(value: string | undefined): string {
  if (!value) return '';

  const trimmed = value.trim();
  const username = trimmed
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0];

  return username ? `https://instagram.com/${username}` : '';
}

export function normalizeWebsite(value: string | undefined): string {
  if (!value) return '';

  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.trim();
  }
}
