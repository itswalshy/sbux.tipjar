import type { ExtractionResult, Partner } from '../types';

const partnerRegex = /^(\d{4,6})\s+(.*?\S)\s+(US[A-Z0-9]+)\s+([0-9]+(?:\.[0-9]{1,2})?)$/;

export function parseManualText(content: string): Pick<ExtractionResult, 'partners' | 'total_tippable_hours' | 'store_number' | 'time_period' | 'warnings'> {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const partners: Partner[] = [];
  const warnings: string[] = [];

  for (const line of lines) {
    const match = partnerRegex.exec(line);
    if (match) {
      const [, number, name, globalId, hours] = match;
      partners.push({
        partner_number: number,
        name,
        partner_global_id: globalId,
        hours: Number.parseFloat(hours)
      });
    }
  }

  const hoursMatch = content.match(/Total Tippable Hours:\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  const storeMatch = content.match(/Store\s+#?(\d{4,6})/i);
  const dateMatch = content.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[–-]\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/);

  if (!partners.length) {
    warnings.push('No partner rows detected in the pasted text.');
  }

  return {
    partners,
    total_tippable_hours: hoursMatch ? Number.parseFloat(hoursMatch[1]) : undefined,
    store_number: storeMatch ? storeMatch[1] : undefined,
    time_period: dateMatch ? `${dateMatch[1]}–${dateMatch[2]}` : undefined,
    warnings
  };
}
