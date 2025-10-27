export type Partner = {
  partner_number: string;
  partner_global_id?: string;
  name: string;
  hours: number;
};

export type ExtractionResult = {
  store_number?: string;
  time_period?: string;
  total_tippable_hours?: number;
  partners: Partner[];
  confidence?: number;
  warnings: string[];
};

export type RoundingMode = 'none' | 'cent' | 'dime' | 'quarter' | 'dollar';
