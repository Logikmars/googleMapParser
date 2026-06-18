import type { CompanyData } from '../types/index.js';

function companyKey(company: CompanyData): string {
  const phone = company.phone.trim();
  const email = company.email.trim().toLowerCase();
  const website = company.website.trim().toLowerCase();

  if (phone && email) return `phone-email:${phone}|${email}`;
  if (phone) return `phone:${phone}`;
  if (email) return `email:${email}`;
  if (website) return `website:${website}`;
  return `name-address:${company.name.trim().toLowerCase()}|${company.address.trim().toLowerCase()}`;
}

export function deduplicateCompanies<T extends CompanyData>(companies: T[]): T[] {
  const seen = new Set<string>();

  return companies.filter((company) => {
    const key = companyKey(company);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
