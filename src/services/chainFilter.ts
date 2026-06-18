import type { CompanyData } from '../types/index.js';
import { env } from '../config/env.js';

export interface ChainFilterResult<T> {
  kept: T[];
  removed: T[];
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\b(restaurant|restoran|cafe|coffee|shop|kyiv|lviv|львів|київ|киев)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function brandKey(value: string): string {
  const normalized = normalizeName(value);
  const tokens = normalized.split(' ').filter(Boolean);
  return tokens.slice(0, 3).join(' ') || normalized;
}

function denylist(): string[] {
  return env.CHAIN_DENYLIST
    .split(',')
    .map((item) => normalizeName(item))
    .filter(Boolean);
}

export function filterChains<T extends CompanyData>(companies: T[]): ChainFilterResult<T> {
  if (!env.EXCLUDE_CHAINS) {
    return { kept: companies, removed: [] };
  }

  const blockedBrands = denylist();
  const counts = new Map<string, number>();

  for (const company of companies) {
    const key = brandKey(company.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const kept: T[] = [];
  const removed: T[] = [];

  for (const company of companies) {
    const normalized = normalizeName(company.name);
    const key = brandKey(company.name);
    const denylisted = blockedBrands.some((brand) => normalized.includes(brand));
    const repeated = (counts.get(key) ?? 0) > env.CHAIN_MAX_SAME_NAME_PER_JOB;

    if (denylisted || repeated) {
      removed.push(company);
    } else {
      kept.push(company);
    }
  }

  return { kept, removed };
}
