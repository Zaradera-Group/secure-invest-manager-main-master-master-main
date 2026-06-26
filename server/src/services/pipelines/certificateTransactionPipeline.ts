export type InvestmentType = "Upfront" | "Monthly" | "Quarterly" | "At Maturity";

export type InvestorInvestmentSnapshot = {
  investor_category?: string | null;
  investment_amount: number;
  currency_code: string | null;
  percentage: number;
  investment_type: InvestmentType | null;
  tenure: number | null;
  maturity_date: string | null;
  start_date: string;
  expected_maturity_amount: number;
  client_account_number: string;
  client_bank: string;
  category_reference_name?: string | null;
  category_reference_email?: string | null;
  category_notes?: string | null;
};

export type TransactionCertificateInput = {
  investorId?: string;
  investorName: string;
  investorEmail: string;
  investorPhone?: string | null;
  investorReferenceNumber?: number | null;
  amount: number;
  currencyCode: string;
  interestRate: number;
  investmentType?: InvestmentType | null;
  issueDate?: string;
  investmentTenure?: string;
  principalMaturityDate?: string | null;
  interestPayment?: string | null;
};

const TRANSACTION_CATEGORIES = new Set(["tu", "rw"]);

export function shouldCreateTransactionCertificate(
  before: InvestorInvestmentSnapshot,
  after: Partial<InvestorInvestmentSnapshot>,
) {
  const nextCategory = after.investor_category ?? before.investor_category ?? null;
  if (nextCategory && TRANSACTION_CATEGORIES.has(nextCategory)) {
    return true;
  }

  return hasInvestmentChanged(before, after);
}

export function buildTransactionCertificateInput(args: {
  investorId: string;
  investorName: string;
  investorEmail: string;
  investorPhone?: string | null;
  investorReferenceNumber?: number | null;
  amount: number;
  currencyCode?: string | null;
  interestRate: number;
  investmentType?: InvestmentType | null;
  issueDate: string;
  investmentTenure?: string | null;
  principalMaturityDate?: string | null;
  interestPayment?: string | null;
}): TransactionCertificateInput {
  return {
    investorId: args.investorId,
    investorName: args.investorName,
    investorEmail: args.investorEmail,
    investorPhone: args.investorPhone ?? null,
    investorReferenceNumber: args.investorReferenceNumber ?? null,
    amount: args.amount,
    currencyCode: args.currencyCode?.trim() || "NGN",
    interestRate: args.interestRate,
    investmentType: args.investmentType ?? undefined,
    issueDate: args.issueDate,
    investmentTenure: args.investmentTenure ?? undefined,
    principalMaturityDate: args.principalMaturityDate ?? undefined,
    interestPayment: args.interestPayment ?? null,
  };
}

function hasInvestmentChanged(
  before: InvestorInvestmentSnapshot,
  after: Partial<InvestorInvestmentSnapshot>,
) {
  const beforeEntry = [
    Number(before.investment_amount ?? 0),
    before.tenure ?? null,
    Number(before.percentage ?? 0),
    before.investment_type ?? null,
    before.investor_category ?? null,
    before.start_date,
    before.maturity_date ?? null,
    (before.currency_code ?? "NGN").toUpperCase(),
    before.client_account_number,
    before.client_bank,
    Number(before.expected_maturity_amount ?? 0),
    before.category_reference_name ?? null,
    before.category_reference_email ?? null,
    before.category_notes ?? null,
  ];

  const afterEntry = [
    Number(after.investment_amount ?? before.investment_amount ?? 0),
    after.tenure ?? before.tenure ?? null,
    Number(after.percentage ?? before.percentage ?? 0),
    after.investment_type ?? before.investment_type ?? null,
    after.investor_category ?? before.investor_category ?? null,
    after.start_date ?? before.start_date,
    after.maturity_date ?? before.maturity_date ?? null,
    (after.currency_code ?? before.currency_code ?? "NGN").toUpperCase(),
    after.client_account_number ?? before.client_account_number,
    after.client_bank ?? before.client_bank,
    Number(after.expected_maturity_amount ?? before.expected_maturity_amount ?? 0),
    after.category_reference_name ?? before.category_reference_name ?? null,
    after.category_reference_email ?? before.category_reference_email ?? null,
    after.category_notes ?? before.category_notes ?? null,
  ];

  return beforeEntry.some((value, index) => afterEntry[index] !== value);
}
