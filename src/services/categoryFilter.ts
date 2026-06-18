import type { CompanyData } from '../types/index.js';
import { env } from '../config/env.js';

export interface CategoryFilterResult<T> {
  kept: T[];
  removed: T[];
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function excludedCategories(): string[] {
  const builtIn = [
    '\u0442\u0440\u0446',
    '\u0442\u0446',
    '\u0442\u043e\u0440\u0433\u043e\u0432\u0438\u0439 \u0446\u0435\u043d\u0442\u0440',
    '\u0442\u043e\u0440\u0433\u043e\u0432\u044b\u0439 \u0446\u0435\u043d\u0442\u0440',
    '\u0442\u043e\u0440\u0433\u043e\u0432\u043e \u0440\u043e\u0437\u0432\u0430\u0436\u0430\u043b\u044c\u043d\u0438\u0439 \u0446\u0435\u043d\u0442\u0440'
  ];

  return `${env.EXCLUDED_CATEGORIES},${builtIn.join(',')}`
    .split(',')
    .map((item) => normalize(item))
    .filter(Boolean);
}

export function filterExcludedCategories<T extends CompanyData>(
  companies: T[]
): CategoryFilterResult<T> {
  const excluded = excludedCategories();
  if (!excluded.length) return { kept: companies, removed: [] };

  const kept: T[] = [];
  const removed: T[] = [];

  for (const company of companies) {
    const haystack = `${normalize(company.category)} ${normalize(company.name)}`;
    const blocked = excluded.some((category) => haystack.includes(category));

    if (blocked) {
      removed.push(company);
    } else {
      kept.push(company);
    }
  }

  return { kept, removed };
}
