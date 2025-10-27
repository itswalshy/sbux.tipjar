import type { Partner, RoundingMode } from '../types';

const ROUNDING_UNIT: Record<RoundingMode, number> = {
  none: 0,
  cent: 0.01,
  dime: 0.1,
  quarter: 0.25,
  dollar: 1
};

export type PartnerPayout = Partner & {
  payout: number;
  roundedPayout: number;
};

function applyRounding(value: number, mode: RoundingMode): number {
  if (mode === 'none') {
    return value;
  }
  const unit = ROUNDING_UNIT[mode];
  return Math.round(value / unit) * unit;
}

export function distributeTips({
  partners,
  totalTips,
  rounding,
  totalHours
}: {
  partners: Partner[];
  totalTips: number;
  rounding: RoundingMode;
  totalHours?: number;
}): {
  payouts: PartnerPayout[];
  hourlyRate: number;
  roundingDelta: number;
} {
  const hoursSum = totalHours ?? partners.reduce((sum, partner) => sum + (partner.hours || 0), 0);
  const safeHours = hoursSum > 0 ? hoursSum : 0;
  const hourlyRate = safeHours > 0 ? totalTips / safeHours : 0;

  const payouts: PartnerPayout[] = partners.map((partner) => {
    const payout = (partner.hours || 0) * hourlyRate;
    const roundedPayout = Number(applyRounding(payout, rounding).toFixed(2));
    return { ...partner, payout, roundedPayout };
  });

  if (rounding === 'none') {
    return { payouts: payouts.map((p) => ({ ...p, roundedPayout: Number(p.payout.toFixed(2)) })), hourlyRate, roundingDelta: 0 };
  }

  const roundedTotal = payouts.reduce((sum, partner) => sum + partner.roundedPayout, 0);
  const delta = Number((totalTips - roundedTotal).toFixed(2));

  if (delta === 0) {
    return { payouts, hourlyRate, roundingDelta: 0 };
  }

  // Adjust the partner with the highest fractional remainder to absorb the delta.
  const sorted = [...payouts].sort((a, b) => {
    const aFraction = a.payout - Math.floor(a.payout);
    const bFraction = b.payout - Math.floor(b.payout);
    return bFraction - aFraction;
  });

  if (sorted.length > 0) {
    sorted[0].roundedPayout = Number((sorted[0].roundedPayout + delta).toFixed(2));
  }

  return { payouts, hourlyRate, roundingDelta: delta };
}
