export const INVESTOR_CATEGORY_OPTIONS = [
  { value: 'nw', label: 'New Investor', shortLabel: 'NW' },
  { value: 'tu', label: 'Top-Up Investor', shortLabel: 'TU' },
  { value: 'rw', label: 'Renewal Investor', shortLabel: 'RW' },
] as const;

export type InvestorCategory = (typeof INVESTOR_CATEGORY_OPTIONS)[number]['value'];

export const getInvestorCategoryLabel = (category?: string | null) => {
  const match = INVESTOR_CATEGORY_OPTIONS.find((option) => option.value === category);
  return match?.label ?? 'New Investor';
};

export const getInvestorCategoryShortLabel = (category?: string | null) => {
  const match = INVESTOR_CATEGORY_OPTIONS.find((option) => option.value === category);
  return match?.shortLabel ?? 'NW';
};

export const getInvestorCategoryBadgeClass = (category?: string | null) => {
  switch (category) {
    case 'tu':
      return 'bg-blue-100 text-blue-900';
    case 'rw':
      return 'bg-violet-100 text-violet-900';
    case 'nw':
    default:
      return 'bg-emerald-100 text-emerald-900';
  }
};
