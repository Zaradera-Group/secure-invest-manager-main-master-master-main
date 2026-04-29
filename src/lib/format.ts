const CURRENCY_LOCALE: Record<string, string> = {
  NGN: 'en-NG',
  USD: 'en-US',
  GBP: 'en-GB',
  EUR: 'de-DE',
};

export function formatCurrency(amount: number, currency = 'NGN'): string {
  return new Intl.NumberFormat(CURRENCY_LOCALE[currency] ?? 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNaira(amount: number): string {
  return formatCurrency(amount, 'NGN');
}

export function formatInvestorCurrency(
  amount: number,
  investor?: { currency_code?: string | null } | null,
): string {
  return formatCurrency(amount, investor?.currency_code ?? 'NGN');
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'Active':
      return 'bg-success/10 text-success';
    case 'Matured':
      return 'bg-primary/10 text-primary';
    case 'Liquidated':
      return 'bg-destructive/10 text-destructive';
    case 'Pending':
      return 'bg-warning/10 text-warning';
    default:
      return 'bg-muted text-muted-foreground';
  }
}
