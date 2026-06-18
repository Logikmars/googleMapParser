export type CompanySource = 'google_maps' | 'instagram' | 'open_source';

export interface CompanyData {
  name: string;
  address: string;
  phone: string;
  email: string;
  instagram: string;
  website: string;
  category: string;
  rating: number;
  source: CompanySource;
  scrapedAt: Date;
  isValid: boolean;
}

export type PartialCompanyData = Partial<CompanyData> &
  Pick<CompanyData, 'name' | 'source'>;

export interface GoogleMapsJobData {
  keywords: string[];
  location: string;
}

export interface InstagramJobData {
  hashtags?: string[];
  locations?: string[];
  competitors?: string[];
}

export interface OpenSourceJobData {
  urls: string[];
  category?: string;
}

export type ParserJobData = GoogleMapsJobData | InstagramJobData | OpenSourceJobData;

export type ParserJobName = 'googleMaps' | 'instagram' | 'openSource';
