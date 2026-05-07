export type InvestmentType = 'Upfront' | 'Monthly' | 'Quarterly' | 'At Maturity';
export type LiquidationStatus = 'Active' | 'Matured' | 'Liquidated' | 'Pending';
export type Gender = 'Male' | 'Female' | 'Other';

export interface Investor {
  id: string;
  name: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  gender: Gender;
  investmentAmount: number;
  startDate: string;
  maturityDate: string;
  tenure: number; // months
  percentage: number;
  investmentType: InvestmentType;
  expectedMaturityAmount: number;
  clientAccountNumber: string;
  clientBank: string;
  broughtBy: string;
  investmentCertificateUrl?: string;
  liquidationStatus: LiquidationStatus;
  createdAt: string;
  updatedAt: string;
}

export function calculateMonthlyReturn(principal: number, rate: number): number {
  return (principal * rate) / 100;
}

export function calculateTotalReturn(principal: number, rate: number, tenureMonths: number): number {
  return calculateMonthlyReturn(principal, rate) * tenureMonths;
}

export function calculateMaturityAmount(
  principal: number,
  rate: number,
  tenureMonths: number,
  type: InvestmentType
): number {
  if (type === 'Upfront') {
    return principal;
  }

  return principal + calculateTotalReturn(principal, rate, tenureMonths);
}

export function daysUntilMaturity(maturityDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maturity = new Date(maturityDate);
  maturity.setHours(0, 0, 0, 0);
  return Math.ceil((maturity.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}
