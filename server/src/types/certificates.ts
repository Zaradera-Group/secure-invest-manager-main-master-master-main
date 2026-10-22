export type AppRole = "investment_manager" | "accountant" | "general_manager" | "super_admin" | "admin" | "software_engineer" | "staff";

export type CertificateStatus =
  | "pending_manager"
  | "pending_general_manager"
  | "pending_ceo"
  | "approved"
  | "sent";

export interface CertificateRecord {
  id: string;
  investor_id?: string | null;
  investor_name: string;
  investor_email: string;
  investor_phone?: string | null;
  investor_reference_number?: number | null;
  amount: number;
  currency_code?: string | null;
  interest_rate: number;
  issue_date?: string | null;
  investment_tenure?: string | null;
  principal_maturity_date?: string | null;
  interest_payment?: string | null;
  status: CertificateStatus;
  manager_signature: string | null;
  general_manager_signature: string | null;
  ceo_signature: string | null;
  certificate_url: string | null;
  created_by: string | null;
  manager_reviewed_by: string | null;
  general_manager_reviewed_by: string | null;
  ceo_approved_by: string | null;
  approved_at?: string | null;
  sent_at?: string | null;
  sent_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CertificateSignatoryNames {
  investmentManager: string;
  generalManager: string;
  ceo: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: AppRole;
  provider?: "supabase" | "auth0";
  permissions?: string[];
}
