import mongoose, { Document, Schema } from 'mongoose';
import type { CompanyData } from '../types/index.js';

export interface ICompany extends CompanyData, Document {}

const CompanySchema = new Schema<ICompany>(
  {
    name: { type: String, required: true, trim: true, index: true },
    address: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true, index: true },
    email: { type: String, default: '', lowercase: true, trim: true, index: true },
    instagram: { type: String, default: '', trim: true },
    website: { type: String, default: '', trim: true },
    category: { type: String, default: '', trim: true, index: true },
    rating: { type: Number, min: 0, max: 5, default: 0 },
    source: {
      type: String,
      enum: ['google_maps', 'instagram', 'open_source'],
      required: true,
      index: true
    },
    scrapedAt: { type: Date, default: Date.now, index: true },
    isValid: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);

CompanySchema.index(
  { phone: 1, email: 1 },
  {
    unique: true,
    partialFilterExpression: {
      phone: { $type: 'string', $gt: '' },
      email: { $type: 'string', $gt: '' }
    }
  }
);

CompanySchema.index(
  { website: 1 },
  {
    unique: true,
    partialFilterExpression: {
      website: { $type: 'string', $gt: '' }
    }
  }
);

export const Company =
  mongoose.models.Company || mongoose.model<ICompany>('Company', CompanySchema);
