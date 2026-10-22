import { z } from "zod";
import { randomUUID } from "node:crypto";
import { adminSupabase } from "../lib/supabase.js";
import {
  sendCeoNotificationEmail,
  sendGeneralManagerNotificationEmail,
  sendInvestorCertificateEmail,
  sendManagerNotificationEmail,
} from "../lib/email.js";
import { generateCertificatePdf, uploadCertificatePdf } from "../lib/pdf.js";
import {
  createSignedObjectUrl,
  deleteObject,
  downloadObject,
  isS3StorageEnabled,
  uploadObject,
} from "../lib/storage.js";
import {
  sendCeoNotificationSms,
  sendGeneralManagerNotificationSms,
  sendInvestorCertificateSms,
  sendManagerNotificationSms,
} from "../lib/sms.js";
import { insertAuditLog } from "../lib/audit.js";
import { env } from "../config/env.js";
import { getMongoDb, isMongoConfigured } from "../lib/mongodb.js";
import {
  createNativeCertificateNotification,
  listCertificateNotificationsFromMongo,
  mirrorNotificationToMongo,
  mirrorNotificationToMongoSafely,
} from "../repositories/notifications.mongo.js";
import { enqueueNotificationDelivery } from "../repositories/notification-delivery-outbox.mongo.js";
import { getStaffDirectoryEntryFromMongo, listStaffDirectoryFromMongo } from "../repositories/staff-directory.mongo.js";
import { listActiveStaffContactsByRoles } from "../repositories/staff-contacts.mongo.js";
import {
  deleteWorkflowRecordsByFieldFromMongoSafely,
  deleteWorkflowRecordsFromMongo,
  deleteWorkflowRecordsFromMongoSafely,
  getWorkflowRecordFromMongo,
  listWorkflowRecordsFromMongo,
  mirrorWorkflowRecordsToMongo,
  mirrorWorkflowRecordsToMongoSafely,
} from "../repositories/workflow-data.mongo.js";
import {
  buildTransactionCertificateInput,
  shouldCreateTransactionCertificate,
  type InvestorInvestmentSnapshot,
} from "./pipelines/certificateTransactionPipeline.js";
import type {
  AppRole,
  AuthenticatedUser,
  CertificateRecord,
  CertificateSignatoryNames,
  CertificateStatus,
} from "../types/certificates.js";

const createCertificateSchema = z.object({
  investorId: z.string().uuid().optional(),
  investorName: z.string().min(1),
  investorEmail: z.string().email(),
  investorPhone: z.string().optional(),
  investorReferenceNumber: z.coerce.number().int().nonnegative().optional(),
  amount: z.coerce.number().nonnegative(),
  currencyCode: z.string().min(3).max(3).default("NGN"),
  interestRate: z.coerce.number().nonnegative(),
  investmentType: z.enum(["Upfront", "Monthly", "Quarterly", "At Maturity"]).optional(),
  issueDate: z.string().optional(),
  investmentTenure: z.string().optional(),
  principalMaturityDate: z.string().optional(),
  interestPayment: z.string().optional(),
});

const updateInvestorSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  reference_number: z.coerce.number().int().nonnegative().nullable().optional(),
  investor_category: z.string().optional(),
  category_reference_name: z.string().nullable().optional(),
  category_reference_email: z.string().email().nullable().optional(),
  category_notes: z.string().nullable().optional(),
  date_of_birth: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  nin: z.string().nullable().optional(),
  bvn: z.string().nullable().optional(),
  occupation: z.string().nullable().optional(),
  source_of_funds: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  next_of_kin_name: z.string().nullable().optional(),
  next_of_kin_phone: z.string().nullable().optional(),
  next_of_kin_relationship: z.string().nullable().optional(),
  passport_photo_url: z.string().nullable().optional(),
  currency_code: z.string().min(3).max(3).optional(),
  nin_verification_status: z.string().optional(),
  bvn_verification_status: z.string().optional(),
  verification_provider: z.string().nullable().optional(),
  last_verified_at: z.string().nullable().optional(),
  investment_amount: z.coerce.number().nonnegative().optional(),
  start_date: z.string().optional(),
  maturity_date: z.string().optional(),
  tenure: z.coerce.number().int().nonnegative().optional(),
  percentage: z.coerce.number().nonnegative().optional(),
  investment_type: z.enum(["Upfront", "Monthly", "Quarterly", "At Maturity"]).optional(),
  expected_maturity_amount: z.coerce.number().nonnegative().optional(),
  client_account_number: z.string().optional(),
  client_bank: z.string().optional(),
  brought_by: z.string().optional().nullable(),
});

const createInvestorSchema = updateInvestorSchema.extend({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  investment_amount: z.coerce.number().nonnegative(),
  start_date: z.string().min(1),
  maturity_date: z.string().min(1),
  tenure: z.coerce.number().int().nonnegative(),
  percentage: z.coerce.number().nonnegative(),
  investment_type: z.enum(["Upfront", "Monthly", "Quarterly", "At Maturity"]),
  expected_maturity_amount: z.coerce.number().nonnegative(),
  client_account_number: z.string().min(1),
  client_bank: z.string().min(1),
});

const MIN_SIGNATURE_DATA_URL_LENGTH = 1500;

const isMeaningfulSignature = (value: string) => {
  const normalized = value.trim();

  if (!normalized.startsWith("data:image/")) {
    return false;
  }

  return normalized.length >= MIN_SIGNATURE_DATA_URL_LENGTH;
};

const signatureSchema = z.object({
  signature: z
    .string()
    .min(1)
    .refine((value) => isMeaningfulSignature(value), "A full signature is required before submitting."),
});

const optionalSignatureSchema = z.object({
  signature: z
    .string()
    .min(1)
    .refine((value) => isMeaningfulSignature(value), "A full signature is required before submitting.")
    .nullable()
    .optional(),
});

const normalizeReferenceNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Math.trunc(value);
    return normalized >= 0 ? normalized : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      const normalized = Math.trunc(parsed);
      return normalized >= 0 ? normalized : null;
    }
  }

  return null;
};

const getTodayIsoDate = () => new Date().toISOString().split("T")[0];

const parseTenureMonths = (investmentTenure?: string) => {
  if (!investmentTenure) {
    return 0;
  }

  const match = /(\d+(?:\.\d+)?)/.exec(investmentTenure);
  return match ? Number.parseFloat(match[1]) : 0;
};

const calculateInterestPayment = (amount: number, interestRate: number, investmentTenure?: string) => {
  const tenureMonths = parseTenureMonths(investmentTenure);
  return amount * (interestRate / 100) * tenureMonths;
};

const buildInterestPaymentDescription = (
  amount: number,
  interestRate: number,
  investmentTenure?: string,
  investmentType?: "Upfront" | "Monthly" | "Quarterly" | "At Maturity",
) => {
  const tenureMonths = parseTenureMonths(investmentTenure);
  const monthlyReturn = amount * (interestRate / 100);
  const totalReturn = monthlyReturn * tenureMonths;

  switch (investmentType) {
    case "Upfront":
      return `Upfront interest payment of ${totalReturn.toFixed(2)} for ${tenureMonths} month(s)`;
    case "Monthly":
      return `Monthly interest payment of ${monthlyReturn.toFixed(2)} for ${tenureMonths} month(s)`;
    case "Quarterly":
      return `Quarterly interest payment of ${(monthlyReturn * 3).toFixed(2)} every 3 months across ${tenureMonths} month(s)`;
    case "At Maturity":
      return `Interest paid at maturity: ${totalReturn.toFixed(2)} after ${tenureMonths} month(s)`;
    default:
      return totalReturn.toFixed(2);
  }
};

const stageConfig: Record<
  Extract<CertificateStatus, "pending_manager" | "pending_general_manager" | "pending_ceo">,
  { userRole: "manager" | "general_manager" | "ceo"; appRole: AppRole }
> = {
  pending_manager: { userRole: "manager", appRole: "investment_manager" },
  pending_general_manager: { userRole: "general_manager", appRole: "general_manager" },
  pending_ceo: { userRole: "ceo", appRole: "super_admin" },
};

const isManagerEquivalentRole = (role: AppRole) => role === "investment_manager" || role === "accountant";

type CreatorSummary = {
  id: string;
  full_name: string | null;
  role: string | null;
  roleLabel: string;
  displayName: string;
};

type DashboardScope = "staff" | "executive" | "all";

type DashboardInvestorRow = {
  id: string;
  name: string;
  investment_amount: number;
  maturity_date: string;
  liquidation_status: string;
  investment_type: string;
  created_by: string | null;
  currency_code: string | null;
  expected_maturity_amount: number;
  client_bank: string;
};

type InvestorReadRecord = Record<string, any> & {
  creator: CreatorSummary | null;
};

const formatCreatorRoleLabel = (role: string | null | undefined) => {
  switch (role) {
    case "investment_manager":
      return "Investment Manager";
    case "accountant":
      return "Accountant";
    case "general_manager":
      return "General Manager";
    case "admin":
      return "IT Manager";
    case "super_admin":
      return "CEO";
    case "software_engineer":
      return "Software Engineer";
    case "staff":
      return "Staff";
    default:
      return "Staff";
  }
};

export class CertificatesService {
  async listInvestorsForRead(actor: AuthenticatedUser): Promise<InvestorReadRecord[]> {
    const isExecutive = actor.role === "admin" || actor.role === "super_admin";
    const investors = (await this.readInvestors()).filter((investor) => isExecutive || investor.created_by === actor.id);

    if (!isExecutive) {
      return investors.map((investor) => ({ ...investor, creator: null }));
    }

    const creatorIds = [...new Set(
      investors
        .map((investor) => investor.created_by)
        .filter((creatorId): creatorId is string => Boolean(creatorId)),
    )];
    const creatorDirectory = await this.getInvestorCreatorDirectory(creatorIds);

    return investors.map((investor) => ({
      ...investor,
      creator: investor.created_by ? creatorDirectory.get(investor.created_by) ?? null : null,
    }));
  }

  async getCertificateInbox(actor: AuthenticatedUser, scope: DashboardScope, limit: number) {
    const certificates = await this.listCertificateInboxRows(actor, scope, limit);
    const investors = await this.listInvestorsForRead(actor);
    const investorsById = new Map(investors.map((investor) => [investor.id, investor]));
    const investorsByEmailAndName = new Map(
      investors.map((investor) => [`${String(investor.email).toLowerCase()}::${investor.name}`, investor]),
    );

    return certificates.map((certificate) => {
      const matchedInvestor = (certificate.investor_id ? investorsById.get(certificate.investor_id) : undefined)
        ?? investorsByEmailAndName.get(`${certificate.investor_email.toLowerCase()}::${certificate.investor_name}`);

      return {
        certificate,
        investor: {
          id: matchedInvestor?.id,
          name: certificate.investor_name,
          email: certificate.investor_email,
          category: matchedInvestor?.investor_category ?? null,
        },
        nextActionLabel: this.getInboxActionLabel(actor.role, certificate),
        href: matchedInvestor?.id ? `/investors/${matchedInvestor.id}` : "/certificates",
      };
    });
  }

  async getPendingApprovalCount(actor: AuthenticatedUser, scope: DashboardScope) {
    return (await this.listCertificateInboxRows(actor, scope)).length;
  }

  async listCertificatesForRead(actor: AuthenticatedUser) {
    const certificates = await this.readCertificatesForRead();
    const visibleCertificates = certificates.filter((certificate) => this.canReadCertificate(certificate, actor));
    const investors = await this.listInvestorsForRead(actor);
    const investorsById = new Map(investors.map((investor) => [investor.id, investor]));
    const investorsByEmailAndName = new Map(
      investors.map((investor) => [`${String(investor.email).toLowerCase()}::${investor.name}`, investor]),
    );

    return visibleCertificates.map((certificate) => {
      const investor = (certificate.investor_id ? investorsById.get(certificate.investor_id) : undefined)
        ?? investorsByEmailAndName.get(`${certificate.investor_email.toLowerCase()}::${certificate.investor_name}`);

      return {
        ...certificate,
        investor_category: investor?.investor_category ?? null,
      };
    });
  }

  async getCertificateApprovalEvents(certificateId: string, actor: AuthenticatedUser) {
    const certificate = await this.getCertificate(certificateId);
    await this.assertCertificateAccess(certificate, actor);

    const preferMongo = env.NOTIFICATIONS_DATA_SOURCE === "mongo"
      || env.NOTIFICATIONS_WRITE_MODE === "dual"
      || env.WORKFLOW_DATA_MONGO_WRITE_MODE !== "supabase";
    if (preferMongo && !isMongoConfigured()) {
      throw new Error("MongoDB is required for Mongo-primary certificate notification reads");
    }
    if (preferMongo) {
      try {
        return await listCertificateNotificationsFromMongo(certificateId);
      } catch (error) {
        throw new Error(`Failed to fetch certificate notifications from MongoDB: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const { data, error } = await adminSupabase
      .from("notifications")
      .select("id, user_role, message, created_at")
      .eq("certificate_id", certificateId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch certificate approval events: ${error.message}`);
    }

    return data ?? [];
  }

  async getDashboardPortfolioSummary(actor: AuthenticatedUser, scope: DashboardScope) {
    const investors = await this.getDashboardInvestorsForRead(actor, scope);
    const now = new Date();
    const maturingSoon = investors.filter((investor) => {
      const maturityDate = new Date(investor.maturity_date);
      const diffDays = Math.ceil((maturityDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return diffDays >= 0 && diffDays <= 30;
    }).length;
    const foreignCurrencyCodes = Array.from(
      new Set(
        investors
          .map((investor) => (investor.currency_code ?? "NGN").toUpperCase())
          .filter((currencyCode) => currencyCode !== "NGN"),
      ),
    ).sort();

    return {
      user_id: actor.id,
      total_investments: investors.length,
      total_investment_value: investors.reduce((sum, investor) => sum + Number(investor.investment_amount ?? 0), 0),
      active_investments: investors.filter((investor) => investor.liquidation_status === "Active").length,
      maturing_soon: maturingSoon,
      liquidated_investments: investors.filter((investor) => investor.liquidation_status === "Liquidated").length,
      foreign_currency_investments: investors.filter(
        (investor) => (investor.currency_code ?? "NGN").toUpperCase() !== "NGN",
      ).length,
      foreign_currency_codes: foreignCurrencyCodes,
    };
  }

  async getDashboardInvestmentTypeSummary(actor: AuthenticatedUser, scope: DashboardScope) {
    const investors = await this.getDashboardInvestorsForRead(actor, scope);
    const totals = new Map<string, { investor_count: number; total_investment_value: number }>();

    for (const investor of investors) {
      const current = totals.get(investor.investment_type) ?? { investor_count: 0, total_investment_value: 0 };
      totals.set(investor.investment_type, {
        investor_count: current.investor_count + 1,
        total_investment_value: current.total_investment_value + Number(investor.investment_amount ?? 0),
      });
    }

    return Array.from(totals.entries())
      .map(([investment_type, total]) => ({
        user_id: actor.id,
        investment_type,
        investor_count: total.investor_count,
        total_investment_value: total.total_investment_value,
      }))
      .sort((left, right) => left.investment_type.localeCompare(right.investment_type));
  }

  async getDashboardUpcomingMaturities(actor: AuthenticatedUser, scope: DashboardScope, limit: number) {
    const investors = await this.getDashboardInvestorsForRead(actor, scope);

    return investors
      .filter((investor) => investor.liquidation_status === "Active")
      .sort((left, right) => new Date(left.maturity_date).getTime() - new Date(right.maturity_date).getTime())
      .slice(0, limit);
  }

  async getMaturityAlerts(actor: AuthenticatedUser, page: number, pageSize: number) {
    const scope: DashboardScope = actor.role === "admin" || actor.role === "super_admin" ? "all" : "staff";
    const investors = await this.getDashboardInvestorsForRead(actor, scope);
    const from = page * pageSize;

    return investors
      .filter((investor) => investor.liquidation_status === "Active")
      .sort((left, right) => new Date(left.maturity_date).getTime() - new Date(right.maturity_date).getTime())
      .slice(from, from + pageSize)
      .map((investor) => ({
        id: investor.id,
        name: investor.name,
        maturity_date: investor.maturity_date,
        liquidation_status: investor.liquidation_status,
        investment_type: investor.investment_type,
        expected_maturity_amount: investor.expected_maturity_amount,
        client_bank: investor.client_bank,
      }));
  }

  async getInvestorForRead(actor: AuthenticatedUser, investorId: string) {
    const data = await this.readInvestor(investorId);

    if (!data) {
      throw new Error(`Investor not found: ${investorId}`);
    }

    const isExecutive = actor.role === "admin" || actor.role === "super_admin";
    if (!isExecutive && data.created_by !== actor.id) {
      throw new Error("Investor not found");
    }

    return data;
  }

  private async getInvestorCreatorDirectory(userIds: string[]) {
    if (!userIds.length) {
      return new Map<string, CreatorSummary>();
    }

    const preferMongo = env.STAFF_DIRECTORY_MONGO_READ_MODE === "mongo"
      || env.WORKFLOW_DATA_MONGO_WRITE_MODE !== "supabase";
    if (preferMongo && !isMongoConfigured()) {
      throw new Error("MongoDB is required for Mongo-primary creator lookups");
    }
    if (preferMongo) {
      try {
        const entries = await listStaffDirectoryFromMongo();
        const entriesByUserId = new Map(entries.map((entry) => [entry.userId, entry]));
        const missingUserIds = userIds.filter((userId) => !entriesByUserId.has(userId));

        if (missingUserIds.length === 0) {
          return new Map<string, CreatorSummary>(
            userIds.map((userId) => {
              const entry = entriesByUserId.get(userId);
              const role = entry?.roles[0] ?? null;
              const fullName = entry?.fullName?.trim() || null;
              const roleLabel = formatCreatorRoleLabel(role);

              return [
                userId,
                {
                  id: userId,
                  full_name: fullName,
                  role,
                  roleLabel,
                  displayName: fullName || roleLabel,
                },
              ];
            }),
          );
        }
      } catch (error) {
        throw new Error(`Failed to resolve certificate creators from MongoDB: ${error instanceof Error ? error.message : String(error)}`);
      }

      return new Map<string, CreatorSummary>();
    }

    const [profilesResult, rolesResult] = await Promise.all([
      adminSupabase.from("profiles").select("id, full_name").in("id", userIds),
      adminSupabase.from("user_roles").select("user_id, role").in("user_id", userIds),
    ]);

    if (profilesResult.error) {
      throw new Error(`Failed to fetch investor creator profiles: ${profilesResult.error.message}`);
    }

    if (rolesResult.error) {
      throw new Error(`Failed to fetch investor creator roles: ${rolesResult.error.message}`);
    }

    const profilesById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
    const rolesByUserId = new Map((rolesResult.data ?? []).map((role) => [role.user_id, role.role]));

    return new Map<string, CreatorSummary>(
      userIds.map((userId) => {
        const fullName = profilesById.get(userId)?.full_name?.trim() || null;
        const role = rolesByUserId.get(userId) ?? null;
        const roleLabel = formatCreatorRoleLabel(role);

        return [
          userId,
          {
            id: userId,
            full_name: fullName,
            role,
            roleLabel,
            displayName: fullName || roleLabel,
          },
        ];
      }),
    );
  }

  private async getDashboardInvestorsForRead(actor: AuthenticatedUser, scope: DashboardScope) {
    const investors = (await this.readInvestors()) as DashboardInvestorRow[];
    const isExecutive = actor.role === "admin" || actor.role === "super_admin";

    if (!isExecutive) {
      return investors.filter((investor) => investor.created_by === actor.id);
    }

    if (scope === "executive") {
      return investors.filter((investor) => investor.created_by === actor.id);
    }

    if (scope === "staff") {
      return investors.filter((investor) => investor.created_by !== actor.id);
    }

    return investors;
  }

  private async readInvestors(): Promise<Array<Record<string, any>>> {
    const preferMongo = env.WORKFLOW_DATA_MONGO_READ_MODE === "mongo"
      || env.WORKFLOW_DATA_MONGO_WRITE_MODE !== "supabase";
    if (preferMongo && !isMongoConfigured()) {
      throw new Error("MongoDB is required for Mongo-primary investor reads");
    }
    if (preferMongo) {
      try {
        return await listWorkflowRecordsFromMongo("investors") as Array<Record<string, any>>;
      } catch (error) {
        throw new Error(`Failed to fetch investors from MongoDB: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const { data, error } = await adminSupabase
      .from("investors")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch investors: ${error.message}`);
    }

    return (data ?? []) as Array<Record<string, any>>;
  }

  private async readInvestor(investorId: string): Promise<Record<string, any> | null> {
    const preferMongo = env.WORKFLOW_DATA_MONGO_READ_MODE === "mongo"
      || env.WORKFLOW_DATA_MONGO_WRITE_MODE !== "supabase";
    if (preferMongo && !isMongoConfigured()) {
      throw new Error("MongoDB is required for Mongo-primary investor reads");
    }
    if (preferMongo) {
      try {
        const record = await getWorkflowRecordFromMongo("investors", investorId);
        if (record) return record as Record<string, any>;
      } catch (error) {
        throw new Error(`Failed to fetch investor from MongoDB: ${error instanceof Error ? error.message : String(error)}`);
      }

      return null;
    }

    const { data, error } = await adminSupabase
      .from("investors")
      .select("*")
      .eq("id", investorId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch investor: ${error.message}`);
    }

    return data as Record<string, any> | null;
  }

  async createInvestor(actor: AuthenticatedUser, payload: unknown) {
    const input = createInvestorSchema.parse(payload);
    if (env.WORKFLOW_DATA_MONGO_WRITE_MODE === "mongo") {
      const now = new Date().toISOString();
      const record = {
        id: randomUUID(),
        ...input,
        created_by: actor.id,
        created_at: now,
        updated_at: now,
      };
      await this.writeMongoWorkflowRecord("investors", record);
      await this.mirrorWorkflowRecordToSupabase("investors", record);
      return record;
    }

    const { data, error } = await adminSupabase
      .from("investors")
      .insert({
        ...input,
        created_by: actor.id,
      })
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(`Failed to create investor: ${error?.message ?? "Unknown error"}`);
    }

    await this.mirrorInvestorWrite(data as Record<string, unknown>);

    return data;
  }

  private async mirrorInvestorWrite(record: Record<string, unknown>) {
    const input = { table: "investors" as const, records: [record] };
    if (env.WORKFLOW_DATA_MONGO_WRITE_MODE === "dual") {
      if (!isMongoConfigured()) {
        throw new Error("MongoDB is required while WORKFLOW_DATA_MONGO_WRITE_MODE=dual");
      }
      const mirrored = await mirrorWorkflowRecordsToMongo(input);
      if (mirrored !== 1) {
        throw new Error("Investor was saved in Supabase but could not be mirrored to MongoDB");
      }
      return;
    }
    mirrorWorkflowRecordsToMongoSafely(input);
  }

  async getLatestCertificateForInvestor(
    actor: AuthenticatedUser,
    investorEmail: string,
    investorName: string,
    investorId?: string | null,
  ) {
    const normalizedEmail = investorEmail.trim().toLowerCase();
    const data = await this.readLatestCertificateForInvestor(investorId, normalizedEmail, investorName);

    if (!data && investorId) {
      const fallbackData = await this.readLatestCertificateForInvestor(null, normalizedEmail, investorName);

      if (!fallbackData) {
        return null;
      }

      await this.assertCertificateAccess(fallbackData, actor);
      return fallbackData;
    }

    if (!data) {
      return null;
    }

    await this.assertCertificateAccess(data, actor);
    return data;
  }

  private async readCertificatesForRead(): Promise<CertificateRecord[]> {
    const preferMongo = env.CERTIFICATES_MONGO_READ_MODE === "mongo"
      || env.WORKFLOW_DATA_MONGO_WRITE_MODE !== "supabase";
    if (preferMongo && !isMongoConfigured()) {
      throw new Error("MongoDB is required for Mongo-primary certificate reads");
    }
    if (preferMongo) {
      try {
        return await listWorkflowRecordsFromMongo("certificates") as unknown as CertificateRecord[];
      } catch (error) {
        throw new Error(`Failed to fetch certificates from MongoDB: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const { data, error } = await adminSupabase
      .from("certificates")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch certificates: ${error.message}`);
    }

    return (data ?? []) as CertificateRecord[];
  }

  private async readLatestCertificateForInvestor(
    investorId: string | null | undefined,
    normalizedEmail: string,
    investorName: string,
  ): Promise<CertificateRecord | null> {
    const preferMongo = env.CERTIFICATES_MONGO_READ_MODE === "mongo"
      || env.WORKFLOW_DATA_MONGO_WRITE_MODE !== "supabase";
    if (preferMongo && !isMongoConfigured()) {
      throw new Error("MongoDB is required for Mongo-primary certificate reads");
    }
    if (preferMongo) {
      try {
        const certificates = await listWorkflowRecordsFromMongo("certificates") as unknown as CertificateRecord[];
        const matches = certificates.filter((certificate) => {
          if (investorId) return certificate.investor_id === investorId;
          return certificate.investor_email?.trim().toLowerCase() === normalizedEmail
            && certificate.investor_name === investorName;
        });

        return matches.sort((left, right) => (
          Date.parse(right.created_at ?? "") - Date.parse(left.created_at ?? "")
        ))[0] ?? null;
      } catch (error) {
        throw new Error(`Failed to fetch latest certificate from MongoDB: ${error instanceof Error ? error.message : String(error)}`);
      }

      return null;
    }

    let query = adminSupabase
      .from("certificates")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1);

    if (investorId) {
      query = query.eq("investor_id", investorId);
    } else {
      query = query
        .eq("investor_email", normalizedEmail)
        .eq("investor_name", investorName);
    }

    const { data, error } = await query.maybeSingle<CertificateRecord>();

    if (error) {
      throw new Error(`Failed to load certificate: ${error.message}`);
    }
    return data;
  }

  async refreshCertificateForInvestor(
    actor: AuthenticatedUser,
    investorId: string,
    options?: { issueDate?: string },
  ) {
    const investor = await this.getInvestorById(investorId);
    const latestCertificate = await this.getLatestCertificateForInvestorById(investorId, investor.email, investor.name);
    const issueDate = options?.issueDate ?? latestCertificate?.issue_date ?? getTodayIsoDate();
    const certificatePayload = {
      investorId: investor.id,
      investorName: investor.name,
      investorEmail: investor.email,
      investorPhone: investor.phone ?? undefined,
      amount: Number(investor.investment_amount ?? 0),
      currencyCode: investor.currency_code ?? "NGN",
      interestRate: Number(investor.percentage ?? 0),
      investmentType: investor.investment_type ?? undefined,
      issueDate: latestCertificate?.issue_date ?? undefined,
      investmentTenure: investor.tenure ? `${investor.tenure} months` : undefined,
      principalMaturityDate: investor.maturity_date ?? undefined,
      interestPayment: undefined,
    } as const;

    if (!latestCertificate) {
      return this.createCertificate(actor, {
        investorId: certificatePayload.investorId,
        investorName: certificatePayload.investorName,
        investorEmail: certificatePayload.investorEmail,
        investorPhone: certificatePayload.investorPhone,
        issueDate,
        amount: certificatePayload.amount,
        currencyCode: certificatePayload.currencyCode,
        interestRate: certificatePayload.interestRate,
        investmentType: certificatePayload.investmentType,
        investmentTenure: certificatePayload.investmentTenure,
        principalMaturityDate: certificatePayload.principalMaturityDate,
      });
    }

    if (actor.role === "general_manager" && latestCertificate.created_by !== actor.id) {
      throw new Error("General Managers can only refresh certificates they created.");
    }

    if (isManagerEquivalentRole(actor.role) && latestCertificate.created_by !== actor.id) {
      throw new Error("Investment Managers and Accountants can only refresh certificates they created.");
    }

    const updated = await this.updateCertificate(latestCertificate.id, {
      investor_id: investor.id,
      investor_name: investor.name,
      investor_email: investor.email,
      investor_phone: investor.phone ?? null,
      issue_date: issueDate,
      amount: Number(investor.investment_amount ?? 0),
      currency_code: investor.currency_code ?? "NGN",
      interest_rate: Number(investor.percentage ?? 0),
      investment_tenure: investor.tenure ? `${investor.tenure} months` : null,
      principal_maturity_date: investor.maturity_date ?? null,
      interest_payment: this.buildInterestPaymentFromSnapshot(
        Number(investor.investment_amount ?? 0),
        Number(investor.percentage ?? 0),
        investor.tenure ? `${investor.tenure} months` : undefined,
        investor.investment_type ?? undefined,
        latestCertificate.interest_payment ?? null,
      ),
    });

    const refreshedCertificate = await this.persistPdf(updated, { investorId: investor.id });

    await insertAuditLog({
      action: "certificate_refreshed_after_investor_update",
      actorUserId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      certificateId: refreshedCertificate.id,
      targetEmail: refreshedCertificate.investor_email,
      metadata: {
        investorId: investor.id,
      },
    });

    return refreshedCertificate;
  }

  async permanentlyDeleteInvestor(actor: AuthenticatedUser, investorId: string) {
    const investor = await this.getInvestorById(investorId);
    this.assertDeletePermission(actor, investor.created_by);

    const certificates = await this.getCertificatesForInvestor(investor.id, investor.email, investor.name);
    const certificateIds = certificates.map((certificate) => certificate.id);

    await Promise.all(
      certificates.map(async (certificate) => {
        await this.removeCertificateArtifact(certificate);
      }),
    );

    if (env.WORKFLOW_DATA_MONGO_WRITE_MODE === "mongo") {
      if (!isMongoConfigured()) {
        throw new Error("MongoDB is required while WORKFLOW_DATA_MONGO_WRITE_MODE=mongo");
      }

      const db = await getMongoDb();
      await Promise.all([
        deleteWorkflowRecordsFromMongo({ table: "investors", supabaseIds: [investor.id] }),
        deleteWorkflowRecordsFromMongo({ table: "certificates", supabaseIds: certificateIds }),
        db.collection("certificate_approval_events").deleteMany({ certificateId: { $in: certificateIds } }),
        db.collection("investor_certificates").deleteMany({ investorId: investor.id }),
        db.collection("notifications").deleteMany({ certificateId: { $in: certificateIds } }),
      ]);

      const legacyCleanup = [
        adminSupabase.from("dashboard_notifications").delete().eq("related_investor_id", investor.id),
        adminSupabase.from("email_notifications").delete().eq("investor_id", investor.id),
        adminSupabase.from("email_notifications_archive").delete().eq("investor_id", investor.id),
        adminSupabase.from("notification_jobs").delete().eq("investor_id", investor.id),
        adminSupabase.from("notification_jobs_archive").delete().eq("investor_id", investor.id),
        adminSupabase.from("certificate_approval_events").delete().in("certificate_id", certificateIds),
        adminSupabase.from("notifications").delete().in("certificate_id", certificateIds),
        adminSupabase.from("certificates").delete().in("id", certificateIds),
        adminSupabase.from("investor_certificates").delete().eq("investor_id", investor.id),
        adminSupabase.from("investors").delete().eq("id", investor.id),
      ];
      const cleanupResults = await Promise.all(legacyCleanup);
      cleanupResults.forEach((result, index) => {
        if (result.error) {
          console.warn("[workflow-data.mongo] Mongo delete succeeded but Supabase compatibility cleanup failed", {
            investorId: investor.id,
            operation: index,
            reason: result.error.message,
          });
        }
      });

      await insertAuditLog({
        action: "investor_deleted_permanently",
        actorUserId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        targetEmail: investor.email,
        metadata: {
          investorId: investor.id,
          investorName: investor.name,
          certificateCount: certificates.length,
          writeAuthority: "mongo",
        },
      });

      return { message: "Investor deleted permanently." };
    }

    await Promise.all([
      adminSupabase.from("dashboard_notifications").delete().eq("related_investor_id", investor.id),
      adminSupabase.from("email_notifications").delete().eq("investor_id", investor.id),
      adminSupabase.from("email_notifications_archive").delete().eq("investor_id", investor.id),
      adminSupabase.from("notification_jobs").delete().eq("investor_id", investor.id),
      adminSupabase.from("notification_jobs_archive").delete().eq("investor_id", investor.id),
    ]);

    if (certificateIds.length) {
      await Promise.all([
        adminSupabase.from("certificate_approval_events").delete().in("certificate_id", certificateIds),
        adminSupabase.from("notifications").delete().in("certificate_id", certificateIds),
        adminSupabase.from("certificates").delete().in("id", certificateIds),
      ]);
    }

    await adminSupabase.from("investor_certificates").delete().eq("investor_id", investor.id);
    await adminSupabase.from("investors").delete().eq("id", investor.id);

    if (env.WORKFLOW_DATA_MONGO_WRITE_MODE === "dual") {
      if (!isMongoConfigured()) {
        throw new Error("MongoDB is required while WORKFLOW_DATA_MONGO_WRITE_MODE=dual");
      }
      await Promise.all([
        deleteWorkflowRecordsFromMongo({ table: "investors", supabaseIds: [investor.id] }),
        deleteWorkflowRecordsFromMongo({ table: "certificates", supabaseIds: certificateIds }),
      ]);
      const db = await getMongoDb();
      await Promise.all([
        db.collection("certificate_approval_events").deleteMany({ certificateId: { $in: certificateIds } }),
        db.collection("investor_certificates").deleteMany({ investorId: investor.id }),
      ]);
    } else {
      deleteWorkflowRecordsFromMongoSafely({ table: "investors", supabaseIds: [investor.id] });
      deleteWorkflowRecordsFromMongoSafely({ table: "certificates", supabaseIds: certificateIds });
      deleteWorkflowRecordsByFieldFromMongoSafely("certificate_approval_events", "certificateId", certificateIds);
      deleteWorkflowRecordsByFieldFromMongoSafely("investor_certificates", "investorId", [investor.id]);
    }

    await insertAuditLog({
      action: "investor_deleted_permanently",
      actorUserId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      targetEmail: investor.email,
      metadata: {
        investorId: investor.id,
        investorName: investor.name,
        certificateCount: certificates.length,
      },
    });

    return { message: "Investor deleted permanently." };
  }

  async updateInvestorAndRefreshCertificate(actor: AuthenticatedUser, investorId: string, payload: unknown) {
    const input = updateInvestorSchema.parse(payload);
    const investorBeforeUpdate = await this.getInvestorById(investorId);
    const existingCertificate = await this.getLatestCertificateForInvestorById(
      investorId,
      investorBeforeUpdate.email,
      investorBeforeUpdate.name,
    );

    this.assertDeletePermission(actor, investorBeforeUpdate.created_by);

    if (existingCertificate) {
      if (actor.role === "general_manager" && existingCertificate.created_by !== actor.id) {
        throw new Error("General Managers can only refresh certificates they created.");
      }

      if (isManagerEquivalentRole(actor.role) && existingCertificate.created_by !== actor.id) {
        throw new Error("Investment Managers and Accountants can only refresh certificates they created.");
      }
    }

    let data: Record<string, any>;
    if (env.WORKFLOW_DATA_MONGO_WRITE_MODE === "mongo") {
      const updatedRecord = {
        ...investorBeforeUpdate,
        ...input,
        id: investorId,
        updated_at: new Date().toISOString(),
      };
      await this.writeMongoWorkflowRecord("investors", updatedRecord);
      await this.mirrorWorkflowRecordToSupabase("investors", updatedRecord);
      data = updatedRecord;
    } else {
      const result = await adminSupabase
        .from("investors")
        .update(input)
        .eq("id", investorId)
        .select("*")
        .single();

      if (result.error || !result.data) {
        throw new Error(`Failed to update investor: ${result.error?.message ?? "Unknown error"}`);
      }
      data = result.data as Record<string, any>;
    }

    await this.mirrorInvestorWrite(data as Record<string, unknown>);

    const shouldCreateTransactionCertificateFlag = shouldCreateTransactionCertificate(investorBeforeUpdate, input);
    const issueDate = shouldCreateTransactionCertificateFlag
      ? getTodayIsoDate()
      : existingCertificate?.issue_date ?? getTodayIsoDate();

    const investmentType = data.investment_type ?? undefined;
    const transactionPayload = buildTransactionCertificateInput({
      investorId,
      investorName: data.name,
      investorEmail: data.email,
      investorPhone: data.phone,
      investorReferenceNumber: normalizeReferenceNumber(data.reference_number),
      amount: Number(data.investment_amount ?? 0),
      currencyCode: data.currency_code ?? "NGN",
      interestRate: Number(data.percentage ?? 0),
      investmentType,
      issueDate,
      investmentTenure: data.tenure ? `${data.tenure} months` : undefined,
      principalMaturityDate: data.maturity_date ?? undefined,
      interestPayment: this.buildInterestPaymentFromSnapshot(
        Number(data.investment_amount ?? 0),
        Number(data.percentage ?? 0),
        data.tenure ? `${data.tenure} months` : undefined,
        investmentType ?? undefined,
        existingCertificate?.interest_payment ?? null,
      ),
    });

    const refreshedCertificate = shouldCreateTransactionCertificateFlag
      ? await this.createCertificateFromSnapshot(actor, transactionPayload, {
          forceFullApprovalWorkflow: true,
        })
      : await this.refreshCertificateForInvestor(actor, investorId, { issueDate });

    await insertAuditLog({
      action: "certificate_refreshed_after_investor_update",
      actorUserId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      certificateId: refreshedCertificate.id,
      targetEmail: refreshedCertificate.investor_email,
      metadata: {
        investorId,
        investorName: data.name,
        updatedFields: Object.keys(input),
      },
    });

    return data;
  }

  async createCertificate(actor: AuthenticatedUser, payload: unknown) {
    const input = createCertificateSchema.parse(payload);
    return this.createCertificateFromSnapshot(actor, input);
  }

  private async createCertificateFromSnapshot(
    actor: AuthenticatedUser,
    input: {
      investorId?: string;
      investorName: string;
      investorEmail: string;
      investorPhone?: string | null;
      investorReferenceNumber?: number | null;
      amount: number;
      currencyCode: string;
      interestRate: number;
      investmentType?: "Upfront" | "Monthly" | "Quarterly" | "At Maturity" | null;
      issueDate?: string;
      investmentTenure?: string;
      principalMaturityDate?: string | null;
      interestPayment?: string | null;
    },
    options: {
      forceFullApprovalWorkflow?: boolean;
    } = {},
  ) {
    if (actor.role === "general_manager") {
      throw new Error("General Managers cannot create certificates right now.");
    }

    const issueDate = input.issueDate ?? getTodayIsoDate();
    const calculatedInterestPayment = calculateInterestPayment(
      input.amount,
      input.interestRate,
      input.investmentTenure,
    );
    const interestPaymentDescription = input.interestPayment?.trim()
      || buildInterestPaymentDescription(
        input.amount,
        input.interestRate,
        input.investmentTenure,
        input.investmentType ?? undefined,
      );
    const initialStatus: CertificateStatus = "pending_manager";

    if (env.WORKFLOW_DATA_MONGO_WRITE_MODE === "mongo") {
      const now = new Date().toISOString();
      const record: CertificateRecord = {
        id: randomUUID(),
        investor_id: input.investorId ?? null,
        investor_name: input.investorName,
        investor_email: input.investorEmail,
        investor_phone: input.investorPhone ?? null,
        investor_reference_number: input.investorReferenceNumber ?? null,
        amount: input.amount,
        currency_code: input.currencyCode,
        interest_rate: input.interestRate,
        issue_date: issueDate,
        investment_tenure: input.investmentTenure ?? null,
        principal_maturity_date: input.principalMaturityDate ?? null,
        interest_payment: interestPaymentDescription,
        status: initialStatus,
        manager_signature: null,
        general_manager_signature: null,
        ceo_signature: null,
        certificate_url: null,
        created_by: actor.id,
        manager_reviewed_by: null,
        general_manager_reviewed_by: null,
        ceo_approved_by: null,
        approved_at: null,
        sent_at: null,
        sent_by: null,
        created_at: now,
        updated_at: now,
      };
      await this.writeMongoWorkflowRecord("certificates", record as unknown as Record<string, unknown>);
      await this.mirrorWorkflowRecordToSupabase("certificates", record as unknown as Record<string, unknown>);

      const refreshedCertificate = await this.persistPdf(record, {
        investorId: input.investorId,
        investorReferenceNumber: input.investorReferenceNumber ?? null,
      });
      await this.notifyStageUsers(initialStatus, refreshedCertificate);
      await insertAuditLog({
        action: "certificate_created",
        actorUserId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        certificateId: refreshedCertificate.id,
        targetEmail: refreshedCertificate.investor_email,
        metadata: {
          initialStatus,
          investmentType: input.investmentType ?? null,
          calculatedInterestPayment,
          forceFullApprovalWorkflow: options.forceFullApprovalWorkflow === true,
          writeAuthority: "mongo",
        },
      });
      return refreshedCertificate;
    }

    const { data, error } = await adminSupabase
      .from("certificates")
      .insert({
        investor_id: input.investorId ?? null,
        investor_name: input.investorName,
        investor_email: input.investorEmail,
        investor_phone: input.investorPhone ?? null,
        amount: input.amount,
        currency_code: input.currencyCode,
        interest_rate: input.interestRate,
        issue_date: issueDate,
        investment_tenure: input.investmentTenure ?? null,
        principal_maturity_date: input.principalMaturityDate ?? null,
        interest_payment: interestPaymentDescription,
        approved_at: null,
        ceo_approved_by: null,
        status: initialStatus,
        created_by: actor.id,
      })
      .select("*")
      .single<CertificateRecord>();

    if (error || !data) {
      throw new Error(`Failed to create certificate: ${error?.message ?? "Unknown error"}`);
    }

    await this.mirrorCertificateWrite(data as unknown as Record<string, unknown>);

    const refreshedCertificate = await this.persistPdf(data, {
      investorId: input.investorId,
      investorReferenceNumber: input.investorReferenceNumber ?? null,
    });

    await this.notifyStageUsers(initialStatus, refreshedCertificate);

    await insertAuditLog({
      action: "certificate_created",
      actorUserId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      certificateId: refreshedCertificate.id,
      targetEmail: refreshedCertificate.investor_email,
      metadata: {
        initialStatus,
        investmentType: input.investmentType ?? null,
        calculatedInterestPayment,
        forceFullApprovalWorkflow: options.forceFullApprovalWorkflow === true,
      },
    });

    return refreshedCertificate;
  }

  async managerApprove(certificateId: string, actor: AuthenticatedUser, payload: unknown) {
    const input = signatureSchema.parse(payload);
    const certificate = await this.getCertificate(certificateId);

    if (certificate.status !== "pending_manager") {
      throw new Error("Certificate is not awaiting investment manager action");
    }

    const nextStatus: CertificateStatus = "pending_general_manager";

    const updated = await this.updateCertificate(certificateId, {
      manager_signature: input.signature,
      manager_reviewed_by: actor.id,
      status: nextStatus,
    });

    const refreshedCertificate = await this.persistPdf(updated);
    await this.notifyStageUsers(nextStatus as Extract<CertificateStatus, "pending_general_manager" | "pending_ceo">, refreshedCertificate);
    await insertAuditLog({
      action: "certificate_signed_by_manager",
      actorUserId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      certificateId: refreshedCertificate.id,
      targetEmail: refreshedCertificate.investor_email,
    });

    return refreshedCertificate;
  }

  async generalManagerApprove(certificateId: string, actor: AuthenticatedUser, payload: unknown) {
    const input = signatureSchema.parse(payload);
    const certificate = await this.getCertificate(certificateId);

    if (certificate.status !== "pending_general_manager") {
      throw new Error("Certificate is not awaiting general manager action");
    }

    const nextStatus: CertificateStatus = "pending_ceo";

    const updated = await this.updateCertificate(certificateId, {
      general_manager_signature: input.signature,
      general_manager_reviewed_by: actor.id,
      status: nextStatus,
    });

    const refreshedCertificate = await this.persistPdf(updated);
    await this.notifyStageUsers(nextStatus as Extract<CertificateStatus, "pending_manager" | "pending_ceo">, refreshedCertificate);
    await insertAuditLog({
      action: "certificate_signed_by_general_manager",
      actorUserId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      certificateId: refreshedCertificate.id,
      targetEmail: refreshedCertificate.investor_email,
    });

    return refreshedCertificate;
  }

  async ceoApprove(certificateId: string, actor: AuthenticatedUser, payload: unknown) {
    const input = optionalSignatureSchema.parse(payload);
    const certificate = await this.getCertificate(certificateId);
    if (certificate.status !== "pending_ceo") {
      throw new Error("Certificate is not awaiting CEO approval");
    }

    const approvedCertificate = await this.updateCertificate(certificateId, {
      ceo_signature: input.signature ?? certificate.ceo_signature,
      ceo_approved_by: actor.id,
      approved_at: new Date().toISOString(),
      status: "approved",
    });

    const refreshedCertificate = await this.persistPdf(approvedCertificate);

    const finalSenderUserId = refreshedCertificate.manager_reviewed_by ?? refreshedCertificate.created_by;
    if (finalSenderUserId) {
      await this.insertNotification({
        certificateId,
        message: `Certificate for ${refreshedCertificate.investor_name} has been approved and is ready to send to the investor.`,
        recipientUserId: finalSenderUserId,
        userRole: "manager",
        actionPath: await this.getInvestorActionPath(refreshedCertificate),
      });
    }

    await insertAuditLog({
      action: "certificate_approved_by_ceo",
      actorUserId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      certificateId,
      targetEmail: refreshedCertificate.investor_email,
      metadata: {
        directCeoFlow: false,
      },
    });

    return refreshedCertificate;
  }

  async sendCertificate(certificateId: string, actor: AuthenticatedUser) {
    const certificate = await this.getCertificate(certificateId);

    if (certificate.status !== "approved") {
      throw new Error("Certificate must be approved before sending");
    }

    if (isManagerEquivalentRole(actor.role)) {
      // Investment Managers and Accountants share final delivery rights after CEO approval.
    } else if (actor.role === "general_manager" && certificate.created_by !== actor.id) {
      throw new Error("Only the originating General Manager can send this certificate.");
    }
    else if (actor.role !== "admin") {
      throw new Error("Forbidden for current role");
    }

    const refreshedCertificate = await this.persistPdf(certificate);
    const signedCertificateLink = await this.createInvestorCertificateEmailLink(refreshedCertificate);
    await this.sendEmailSafely("investor certificate", () =>
      sendInvestorCertificateEmail(refreshedCertificate.investor_email, refreshedCertificate, signedCertificateLink)
    );
    const investorPhone = refreshedCertificate.investor_phone?.trim();
    if (investorPhone) {
      await this.sendSmsSafely("investor certificate", () =>
        sendInvestorCertificateSms(investorPhone, refreshedCertificate, signedCertificateLink)
      );
    }
    const sentCertificate = await this.updateCertificate(certificateId, {
      sent_at: new Date().toISOString(),
      sent_by: actor.id,
      status: "sent",
    });

    await this.insertNotification({
      certificateId,
      message: `Your certificate for ${refreshedCertificate.investor_name} is ready.`,
      recipientEmail: refreshedCertificate.investor_email,
      userRole: "investor",
    });

    await insertAuditLog({
      action: "certificate_sent_to_investor",
      actorUserId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      certificateId,
      targetEmail: refreshedCertificate.investor_email,
      metadata: {
        directCeoFlow: false,
      },
    });

    return sentCertificate;
  }

  async createDownloadUrl(certificateId: string, actor: AuthenticatedUser) {
    let certificate = await this.getCertificate(certificateId);
    await this.assertCertificateAccess(certificate, actor);
    this.assertCertificateRenderable(certificate);

    certificate = await this.ensureCertificateFile(certificate);

    const existingDownloadUrl = this.resolveCertificateUrl(certificate.certificate_url);
    if (existingDownloadUrl) {
      await insertAuditLog({
        action: "certificate_download_link_generated",
        actorUserId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        certificateId,
        targetEmail: certificate.investor_email,
        metadata: {
          deliveryMode: "existing_url",
        },
      });

      return { signedUrl: existingDownloadUrl };
    }

    const storagePath = await this.getCertificateStoragePath(certificate);

    const signedUrl = await createSignedObjectUrl(storagePath, 60 * 10);

    await insertAuditLog({
      action: "certificate_download_link_generated",
      actorUserId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      certificateId,
      targetEmail: certificate.investor_email,
    });

    return { signedUrl };
  }

  async getCertificatePdfFile(certificateId: string, actor: AuthenticatedUser) {
    let certificate = await this.getCertificate(certificateId);
    await this.assertCertificateAccess(certificate, actor);
    this.assertCertificateRenderable(certificate);

    certificate = await this.ensureCertificateFile(certificate);

    const existingDownloadUrl = this.resolveCertificateUrl(certificate.certificate_url);
    if (existingDownloadUrl) {
      const response = await fetch(existingDownloadUrl);
      if (response.ok) {
        await insertAuditLog({
          action: "certificate_download_link_generated",
          actorUserId: actor.id,
          actorEmail: actor.email,
          actorRole: actor.role,
          certificateId,
          targetEmail: certificate.investor_email,
          metadata: {
            deliveryMode: "existing_url_direct_file",
          },
        });

        return {
          fileName: `${certificate.investor_name.replace(/\s+/g, "-").toLowerCase()}-certificate.pdf`,
          bytes: Buffer.from(await response.arrayBuffer()),
        };
      }
    }

    const storagePath = await this.getCertificateStoragePath(certificate);

    try {
      const bytes = await downloadObject(storagePath);
      await insertAuditLog({
        action: "certificate_download_link_generated",
        actorUserId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        certificateId,
        targetEmail: certificate.investor_email,
        metadata: {
          deliveryMode: "direct_file",
        },
      });

      return {
        fileName: `${certificate.investor_name.replace(/\s+/g, "-").toLowerCase()}-certificate.pdf`,
        bytes,
      };
    } catch {
      certificate = await this.persistPdf(certificate);
      const retryPath = await this.getCertificateStoragePath(certificate);
      const retryBytes = await downloadObject(retryPath);

      await insertAuditLog({
        action: "certificate_download_link_generated",
        actorUserId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        certificateId,
        targetEmail: certificate.investor_email,
        metadata: {
          deliveryMode: "direct_file",
          retried: true,
        },
      });

      return {
        fileName: `${certificate.investor_name.replace(/\s+/g, "-").toLowerCase()}-certificate.pdf`,
        bytes: retryBytes,
      };
    }
  }

  private async ensureCertificateFile(certificate: CertificateRecord) {
    return this.persistPdf(certificate);
  }

  private async listCertificateInboxRows(actor: AuthenticatedUser, scope: DashboardScope, limit?: number) {
    const statuses = this.getInboxStatuses(actor.role);
    if (statuses.length === 0) return [] as CertificateRecord[];
    const certificates = await this.readCertificatesForRead();
    const filtered = certificates
      .filter((certificate) => statuses.includes(certificate.status))
      .filter((certificate) => {
        if (actor.role === "admin" || actor.role === "super_admin") {
          if (scope === "executive") return certificate.created_by === actor.id;
          if (scope === "staff") return certificate.created_by !== actor.id;
        }
        return true;
      })
      .filter((certificate) => {
      if (isManagerEquivalentRole(actor.role)) {
        return certificate.status === "pending_manager" || certificate.status === "approved" || certificate.created_by === actor.id;
      }
      if (actor.role === "general_manager") {
        return certificate.status === "pending_general_manager" || certificate.created_by === actor.id;
      }
      return true;
      })
      .sort((left, right) => Date.parse(right.created_at ?? "") - Date.parse(left.created_at ?? ""));

    return limit === undefined ? filtered : filtered.slice(0, limit);
  }

  private getInboxStatuses(role: AppRole): CertificateStatus[] {
    if (isManagerEquivalentRole(role)) return ["pending_manager", "approved"];
    if (role === "general_manager") return ["pending_general_manager", "approved"];
    if (role === "admin") return ["pending_manager", "pending_general_manager", "pending_ceo", "approved"];
    return role === "super_admin" ? ["pending_ceo"] : [];
  }

  private getInboxActionLabel(role: AppRole, certificate: CertificateRecord) {
    if (isManagerEquivalentRole(role) && certificate.status === "pending_manager") return "Review and sign";
    if (role === "admin" && certificate.status === "pending_manager") return "Sign as Investment Manager";
    if ((isManagerEquivalentRole(role) || role === "admin" || role === "general_manager") && certificate.status === "approved") return "Send to investor";
    if (role === "general_manager" && certificate.status === "pending_general_manager") return "Approve and sign";
    if (role === "admin" && certificate.status === "pending_general_manager") return "Sign as General Manager";
    if ((role === "admin" || role === "super_admin") && certificate.status === "pending_ceo") return "Final approval";
    return "Review certificate";
  }

  private canReadCertificate(certificate: CertificateRecord, actor: AuthenticatedUser) {
    switch (actor.role) {
      case "admin":
      case "super_admin":
        return true;
      case "general_manager":
        return certificate.status === "pending_general_manager"
          || certificate.general_manager_reviewed_by === actor.id
          || certificate.created_by === actor.id;
      case "investment_manager":
      case "accountant":
        return certificate.status === "pending_manager"
          || certificate.status === "approved"
          || certificate.created_by === actor.id
          || certificate.manager_reviewed_by === actor.id;
      default:
        return false;
    }
  }

  private assertCertificateRenderable(certificate: CertificateRecord) {
    const missing: string[] = [];

    if (certificate.status === "pending_general_manager") {
      if (!certificate.manager_signature) missing.push("Investment Manager signature");
    } else if (certificate.status === "pending_ceo") {
      if (!certificate.manager_signature) missing.push("Investment Manager signature");
      if (!certificate.general_manager_signature) missing.push("General Manager signature");
    } else if (certificate.status === "approved" || certificate.status === "sent") {
      if (!certificate.manager_signature) missing.push("Investment Manager signature");
      if (!certificate.general_manager_signature) missing.push("General Manager signature");
      if (!certificate.ceo_approved_by && !certificate.approved_at) missing.push("CEO approval");
    }

    if (missing.length > 0) {
      throw new Error(
        `Certificate is not ready to view. Missing required workflow step(s): ${missing.join(", ")}.`,
      );
    }
  }

  private async notifyStageUsers(
    status: Extract<CertificateStatus, "pending_manager" | "pending_general_manager" | "pending_ceo">,
    certificate: CertificateRecord,
  ) {
    const stage = stageConfig[status];
    const recipientRoles = stage.appRole === "investment_manager"
      ? (["investment_manager", "accountant"] as AppRole[])
      : [stage.appRole];
    const recipients = await this.getUsersByRoles(recipientRoles);
    const investorActionPath = await this.getInvestorActionPath(certificate);

    await Promise.all(
      recipients.map(async (recipient) => {
        const message = this.buildNotificationMessage(status, certificate);

        await this.insertNotification({
          certificateId: certificate.id,
          message,
          recipientUserId: recipient.id,
          recipientEmail: recipient.email,
          userRole: stage.userRole,
          actionPath: investorActionPath,
        });

        if (env.CERTIFICATE_NOTIFICATION_DELIVERY_AUTHORITY === "render") {
          const deliveryIntents: Promise<unknown>[] = [];
          if (recipient.email) deliveryIntents.push(this.enqueueStageDeliveryIntent(status, certificate, recipient, "email"));
          if (recipient.phone?.trim()) {
            deliveryIntents.push(this.enqueueStageDeliveryIntent(status, certificate, recipient, "sms", recipient.phone.trim()));
          }
          await Promise.all(deliveryIntents);
          return;
        }

        if (!recipient.email) return;
        this.mirrorStageDeliveryIntentSafely(status, certificate, recipient, "email");

        if (status === "pending_manager") {
          await this.sendEmailSafely("manager notification", () =>
            sendManagerNotificationEmail(recipient.email!, certificate)
          );
        } else if (status === "pending_general_manager") {
          await this.sendEmailSafely("general manager notification", () =>
            sendGeneralManagerNotificationEmail(recipient.email!, certificate)
          );
        } else {
          await this.sendEmailSafely("CEO notification", () => sendCeoNotificationEmail(recipient.email!, certificate));
        }

        if (!recipient.phone) {
          return;
        }

        const recipientPhone = recipient.phone.trim();
        this.mirrorStageDeliveryIntentSafely(status, certificate, recipient, "sms", recipientPhone);

        if (status === "pending_manager") {
          await this.sendSmsSafely("manager notification", () => sendManagerNotificationSms(recipientPhone, certificate));
        } else if (status === "pending_general_manager") {
          await this.sendSmsSafely("general manager notification", () =>
            sendGeneralManagerNotificationSms(recipientPhone, certificate)
          );
        } else {
          await this.sendSmsSafely("CEO notification", () => sendCeoNotificationSms(recipientPhone, certificate));
        }
      }),
    );
  }

  private mirrorStageDeliveryIntentSafely(
    status: Extract<CertificateStatus, "pending_manager" | "pending_general_manager" | "pending_ceo">,
    certificate: CertificateRecord,
    recipient: { id: string; email?: string; phone?: string },
    channel: "email" | "sms",
    recipientOverride?: string,
  ) {
    if (!env.CERTIFICATE_NOTIFICATION_OUTBOX_SHADOW_ENABLED || !isMongoConfigured()) return;

    const destination = recipientOverride ?? recipient.email;
    if (!destination) return;

    void this.enqueueStageDeliveryIntent(status, certificate, recipient, channel, recipientOverride, "shadow").catch((error) => {
      console.warn("[certificates.notifications] Failed to mirror delivery intent to MongoDB outbox", {
        certificateId: certificate.id,
        stage: status,
        channel,
        reason: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private async enqueueStageDeliveryIntent(
    status: Extract<CertificateStatus, "pending_manager" | "pending_general_manager" | "pending_ceo">,
    certificate: CertificateRecord,
    recipient: { id: string; email?: string; phone?: string },
    channel: "email" | "sms",
    recipientOverride?: string,
    deliveryMode: "shadow" | "live" = "live",
  ) {
    const destination = recipientOverride ?? recipient.email;
    if (!destination) throw new Error(`Certificate ${channel} notification is missing a recipient`);

    await enqueueNotificationDelivery({
      notificationType: "certificate_stage_notification",
      channel,
      deliveryMode,
      recipient: destination,
      payload: {
        certificateId: certificate.id,
        investorName: certificate.investor_name,
        stage: status,
        recipientUserId: recipient.id,
      },
      dedupeKey: `certificate_stage_notification:${deliveryMode}:${certificate.id}:${status}:${recipient.id}:${channel}`,
    });
  }

  private buildNotificationMessage(status: CertificateStatus, certificate: CertificateRecord) {
    switch (status) {
      case "pending_manager":
        return `Certificate for ${certificate.investor_name} is ready for investment manager review.`;
      case "pending_general_manager":
        return `Certificate for ${certificate.investor_name} is ready for general manager review.`;
      case "pending_ceo":
        return `Certificate for ${certificate.investor_name} is ready for CEO approval.`;
      default:
        return `Certificate for ${certificate.investor_name} has changed status.`;
    }
  }

  private async insertNotification(input: {
    certificateId: string;
    message: string;
    userRole: "manager" | "general_manager" | "ceo" | "investor";
    recipientUserId?: string;
    recipientEmail?: string;
    actionPath?: string | null;
  }) {
    let actionPath = input.actionPath?.trim() || null;

    if (actionPath === "/investors") {
      actionPath = null;
    }

    if (!actionPath && input.userRole !== "investor") {
      try {
        const certificate = await this.getCertificate(input.certificateId);
        actionPath = await this.getInvestorActionPath(certificate);
      } catch (error) {
        console.warn("[certificates.notifications] Failed to resolve investor action path", {
          certificateId: input.certificateId,
          message: error instanceof Error ? error.message : "Unexpected error",
        });
      }
    }

    const notification = {
      certificate_id: input.certificateId,
      title: "Certificate workflow update",
      detail: input.message,
      message: input.message,
      user_role: input.userRole,
      recipient_user_id: input.recipientUserId ?? null,
      recipient_email: input.recipientEmail ?? null,
      action_path: actionPath,
      is_read: false,
    };

    if (env.WORKFLOW_DATA_MONGO_WRITE_MODE === "mongo") {
      await createNativeCertificateNotification({
        certificateId: input.certificateId,
        title: notification.title,
        detail: notification.detail,
        userRole: notification.user_role,
        recipientUserId: notification.recipient_user_id ?? undefined,
        recipientEmail: notification.recipient_email ?? undefined,
        actionPath: notification.action_path,
      });
      return;
    }

    const { data, error } = await adminSupabase.from("notifications").insert(notification).select("*").single();

    if (error || !data) {
      throw new Error(`Failed to insert notification: ${error?.message ?? "Unknown error"}`);
    }

    const mirrorInput = {
      notificationId: String(data.id),
      notification: data as Record<string, unknown>,
      createdAt: String(data.created_at ?? new Date().toISOString()),
    };
    if (env.WORKFLOW_DATA_MONGO_WRITE_MODE === "dual") {
      if (!isMongoConfigured()) {
        throw new Error("MongoDB is required while WORKFLOW_DATA_MONGO_WRITE_MODE=dual");
      }
      await mirrorNotificationToMongo(mirrorInput);
    } else {
      mirrorNotificationToMongoSafely(mirrorInput);
    }
  }

  private async sendSmsSafely(label: string, action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      console.warn(`[certificates.sms] ${label} SMS failed:`, error);
    }
  }

  private async sendEmailSafely(label: string, action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      console.warn(`[certificates.email] ${label} email failed:`, error);
    }
  }

  private async getUsersByRoles(roles: AppRole[]) {
    const preferMongo = env.WORKFLOW_DATA_MONGO_READ_MODE === "mongo"
      || env.WORKFLOW_DATA_MONGO_WRITE_MODE !== "supabase";
    if (preferMongo && !isMongoConfigured()) {
      throw new Error("MongoDB is required for Mongo-primary certificate recipient lookups");
    }
    if (preferMongo) {
      try {
        const contacts = await listActiveStaffContactsByRoles(roles);
        return contacts
          .filter((contact) => contact.roles.some((role) => roles.includes(role as AppRole)))
          .map((contact) => ({ id: contact.userId, email: contact.email ?? undefined, phone: contact.phone ?? undefined }));
      } catch (error) {
        throw new Error(`Failed to resolve certificate recipients from MongoDB: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const { data, error } = await adminSupabase
      .from("user_roles")
      .select("user_id")
      .in("role", roles);

    if (error) {
      throw new Error(`Failed to fetch users for roles ${roles.join(", ")}: ${error.message}`);
    }

    const userIds = [...new Set((data ?? []).map((row) => row.user_id as string))];

    if (userIds.length === 0) {
      return [];
    }

    const { data: authUsers, error: usersError } = await adminSupabase.auth.admin.listUsers();

    if (usersError) {
      throw new Error(`Failed to fetch auth users for roles ${roles.join(", ")}: ${usersError.message}`);
    }

    return (authUsers.users ?? [])
      .filter((user) => userIds.includes(user.id))
      .map((user) => ({
        id: user.id,
        email: user.email,
        phone: user.phone ?? undefined,
      }));
  }

  private async getRoleForUser(userId?: string | null): Promise<AppRole | null> {
    if (!userId) {
      return null;
    }

    const preferMongo = env.WORKFLOW_DATA_MONGO_READ_MODE === "mongo"
      || env.WORKFLOW_DATA_MONGO_WRITE_MODE !== "supabase";
    if (preferMongo && !isMongoConfigured()) {
      throw new Error("MongoDB is required for Mongo-primary staff role lookups");
    }
    if (preferMongo) {
      try {
        const entry = await getStaffDirectoryEntryFromMongo(userId);
        const role = entry?.roles[0];
        if (role) return role as AppRole;
      } catch (error) {
        throw new Error(`Failed to resolve staff role from MongoDB: ${error instanceof Error ? error.message : String(error)}`);
      }

      return null;
    }

    const { data, error } = await adminSupabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch role for user ${userId}: ${error.message}`);
    }

    return (data?.role as AppRole | undefined) ?? null;
  }

  private async persistPdf(
    certificate: CertificateRecord,
    investorContext?: {
      investorId?: string;
      investorReferenceNumber?: number | null;
    },
  ) {
    const signatories = await this.getSignatoryNames();
    const investorSnapshot = await this.getInvestorSnapshot(certificate, investorContext);
    const creatorRole = await this.getRoleForUser(certificate.created_by);
    const managerSignature = await this.getRenderableSignature(certificate.manager_signature, certificate.id, "manager");
    const generalManagerSignature = await this.getRenderableSignature(
      certificate.general_manager_signature,
      certificate.id,
      "general-manager",
    );
    const ceoSignature = await this.getRenderableSignature(certificate.ceo_signature, certificate.id, "ceo");
    const pdfBytes = await generateCertificatePdf(
      {
        ...certificate,
        investor_name: investorSnapshot.name,
        investor_email: investorSnapshot.email,
        investor_phone: investorSnapshot.phone,
        amount: investorSnapshot.amount,
        currency_code: investorSnapshot.currencyCode,
        interest_rate: investorSnapshot.interestRate,
        investment_tenure: investorSnapshot.investmentTenure,
        principal_maturity_date: investorSnapshot.principalMaturityDate,
        interest_payment: investorSnapshot.interestPayment ?? certificate.interest_payment,
        investor_reference_number: investorSnapshot.referenceNumber,
        manager_signature: managerSignature,
        general_manager_signature: generalManagerSignature,
        ceo_signature: ceoSignature,
      },
      signatories,
      {
        creatorRole,
      },
    );
    const certificateUrl = await uploadCertificatePdf(certificate.id, pdfBytes);

    return this.updateCertificate(certificate.id, { certificate_url: certificateUrl });
  }

  private async getRenderableSignature(
    signature: string | null,
    certificateId: string,
    role: "manager" | "general-manager" | "ceo",
  ) {
    if (!signature) {
      return null;
    }

    if (signature.startsWith("http://") || signature.startsWith("https://")) {
      return signature;
    }

    if (!signature.startsWith("data:image/")) {
      return null;
    }

    const [header, base64] = signature.split(",", 2);
    if (!base64 || !header.startsWith("data:image/")) {
      return null;
    }

    const contentType = header.substring(5, header.indexOf(";"));
    const extension = contentType.includes("png") ? "png" : "jpg";
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const filePath = `signature-cache/${role}/${certificateId}-${Date.now()}.${extension}`;

    try {
      const storagePath = await uploadObject({
        path: filePath,
        bytes,
        contentType,
      });

      return createSignedObjectUrl(storagePath, 60 * 60 * 24 * 7);
    } catch (error) {
      console.warn("Failed to cache certificate signature for PDF rendering", {
        certificateId,
        role,
        message: error instanceof Error ? error.message : "Unknown error",
      });
      return signature;
    }
  }

  private async getInvestorSnapshot(
    certificate: CertificateRecord,
    investorContext?: {
      investorId?: string;
      investorReferenceNumber?: number | null;
    },
  ) {
    const investorId = investorContext?.investorId ?? certificate.investor_id ?? null;
    const preferMongo = env.WORKFLOW_DATA_MONGO_READ_MODE === "mongo"
      || env.WORKFLOW_DATA_MONGO_WRITE_MODE !== "supabase";
    let data: Record<string, any> | null = null;

    if (preferMongo && !isMongoConfigured()) {
      throw new Error("MongoDB is required for Mongo-primary investor snapshot reads");
    }
    if (preferMongo) {
      try {
        if (investorId) {
          data = await getWorkflowRecordFromMongo("investors", investorId) as Record<string, any> | null;
        } else {
          const investors = await listWorkflowRecordsFromMongo("investors") as Array<Record<string, any>>;
          data = investors
            .filter((investor) => investor.email === certificate.investor_email && investor.name === certificate.investor_name)
            .sort((left, right) => Date.parse(String(right.updated_at ?? "")) - Date.parse(String(left.updated_at ?? "")))[0] ?? null;
        }
      } catch (error) {
        throw new Error(`Failed to fetch investor snapshot from MongoDB: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (!data) {
      let query = adminSupabase
        .from("investors")
        .select("name, email, phone, reference_number, investment_amount, currency_code, percentage, tenure, maturity_date, investment_type");
      if (investorId) {
        query = query.eq("id", investorId);
      } else {
        query = query
          .eq("email", certificate.investor_email)
          .eq("name", certificate.investor_name)
          .order("updated_at", { ascending: false })
          .limit(1);
      }
      const result = await query.maybeSingle();
      if (result.error) throw new Error(`Failed to fetch investor details: ${result.error.message}`);
      data = result.data as Record<string, any> | null;
    }

    const amount = Number(data?.investment_amount ?? certificate.amount);
    const interestRate = Number(data?.percentage ?? certificate.interest_rate);
    const investmentTenure = data?.tenure ? `${data.tenure} months` : (certificate.investment_tenure ?? null);
    const principalMaturityDate = data?.maturity_date ?? certificate.principal_maturity_date ?? null;
    const referenceNumber =
      normalizeReferenceNumber(investorContext?.investorReferenceNumber)
        ?? normalizeReferenceNumber(data?.reference_number)
        ?? certificate.investor_reference_number
        ?? null;
    const interestPayment = this.buildInterestPaymentFromSnapshot(
      amount,
      interestRate,
      investmentTenure,
      data?.investment_type ?? undefined,
      certificate.interest_payment ?? null,
    );

    return {
      name: data?.name ?? certificate.investor_name,
      email: data?.email ?? certificate.investor_email,
      phone: data?.phone ?? certificate.investor_phone ?? null,
      amount,
      currencyCode: data?.currency_code ?? certificate.currency_code ?? "NGN",
      interestRate,
      investmentTenure,
      principalMaturityDate,
      referenceNumber,
      interestPayment,
    };
  }

  private async getInvestorById(investorId: string) {
    const preferMongo = env.WORKFLOW_DATA_MONGO_READ_MODE === "mongo"
      || env.WORKFLOW_DATA_MONGO_WRITE_MODE !== "supabase";
    if (preferMongo && !isMongoConfigured()) {
      throw new Error("MongoDB is required for Mongo-primary investor reads");
    }
    if (preferMongo) {
      try {
        const record = await getWorkflowRecordFromMongo("investors", investorId);
        if (record) return record as {
          id: string;
          name: string;
          email: string;
          phone: string | null;
          created_by: string | null;
          reference_number: number | null;
          investment_amount: number;
          currency_code: string | null;
          percentage: number;
          start_date: string;
          tenure: number | null;
          maturity_date: string | null;
          investment_type: "Upfront" | "Monthly" | "Quarterly" | "At Maturity" | null;
          client_account_number: string;
          client_bank: string;
          expected_maturity_amount: number;
        };
      } catch (error) {
        throw new Error(`Failed to fetch investor from MongoDB: ${error instanceof Error ? error.message : String(error)}`);
      }

      throw new Error(`Investor not found in MongoDB: ${investorId}`);
    }

    const { data, error } = await adminSupabase
      .from("investors")
      .select("*")
      .eq("id", investorId)
      .maybeSingle();

    if (error || !data) {
      throw new Error(`Investor not found: ${error?.message ?? investorId}`);
    }

    return data as {
      id: string;
      name: string;
      email: string;
      phone: string | null;
      created_by: string | null;
      reference_number: number | null;
      investment_amount: number;
      currency_code: string | null;
      percentage: number;
      start_date: string;
      tenure: number | null;
      maturity_date: string | null;
      investment_type: "Upfront" | "Monthly" | "Quarterly" | "At Maturity" | null;
      client_account_number: string;
      client_bank: string;
      expected_maturity_amount: number;
    };
  }

  private async getLatestCertificateForInvestorById(investorId: string, investorEmail: string, investorName: string) {
    const certificates = await this.readCertificatesForRead();
    const normalizedEmail = investorEmail.trim().toLowerCase();
    const matches = certificates.filter((certificate) => (
      certificate.investor_id === investorId
      || (certificate.investor_email?.trim().toLowerCase() === normalizedEmail && certificate.investor_name === investorName)
    ));
    return matches.sort((left, right) => Date.parse(right.created_at ?? "") - Date.parse(left.created_at ?? ""))[0] ?? null;
  }

  private async getCertificatesForInvestor(investorId: string, investorEmail: string, investorName: string) {
    const normalizedEmail = investorEmail.trim().toLowerCase();
    const uniqueCertificates = new Map<string, CertificateRecord>();
    (await this.readCertificatesForRead())
      .filter((certificate) => (
        certificate.investor_id === investorId
        || (certificate.investor_email?.trim().toLowerCase() === normalizedEmail && certificate.investor_name === investorName)
      ))
      .forEach((certificate) => {
        uniqueCertificates.set(certificate.id, certificate);
    });

    return [...uniqueCertificates.values()];
  }

  private async removeCertificateArtifact(certificate: CertificateRecord) {
    const storagePath = certificate.certificate_url?.trim();
    if (!storagePath) {
      return;
    }

    const normalizedPath = this.extractStoragePath(storagePath) ?? storagePath;
    try {
      await deleteObject(normalizedPath);
    } catch (error) {
      console.warn("Failed to remove certificate artifact", {
        certificateId: certificate.id,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  private assertDeletePermission(actor: AuthenticatedUser, createdBy: string | null) {
    if (actor.role === "admin" || actor.role === "super_admin") {
      return;
    }

    if ((isManagerEquivalentRole(actor.role) || actor.role === "general_manager") && createdBy === actor.id) {
      return;
    }

    throw new Error("Forbidden for current role");
  }

  private buildInterestPaymentFromSnapshot(
    amount: number,
    interestRate: number,
    investmentTenure?: string | null,
    investmentType?: "Upfront" | "Monthly" | "Quarterly" | "At Maturity",
    fallback?: string | null,
  ) {
    const derived = buildInterestPaymentDescription(
      amount,
      interestRate,
      investmentTenure ?? undefined,
      investmentType,
    ).trim();

    return derived || fallback || null;
  }

  private async createInvestorCertificateEmailLink(certificate: CertificateRecord) {
    const storagePath = await this.getCertificateStoragePath(certificate);
    return createSignedObjectUrl(storagePath, 60 * 60 * 24 * 7);
  }

  private async getCertificateStoragePath(certificate: CertificateRecord): Promise<string> {
    const certificateUrl = certificate.certificate_url?.trim();
    if (!certificateUrl) {
      const refreshed = await this.persistPdf(certificate);
      return this.getCertificateStoragePath(refreshed);
    }

    const directPath = this.extractStoragePath(certificateUrl);
    if (directPath) {
      if (directPath !== certificateUrl) {
        await this.updateCertificate(certificate.id, { certificate_url: directPath });
      }
      return directPath;
    }

    const refreshed = await this.persistPdf(certificate);
    const refreshedPath = refreshed.certificate_url?.trim();
    const normalizedRefreshedPath = refreshedPath ? this.extractStoragePath(refreshedPath) : null;

    if (!normalizedRefreshedPath) {
      throw new Error("Certificate file is not available");
    }

    return normalizedRefreshedPath;
  }

  private extractStoragePath(value: string): string | null {
    const trimmed = value.trim();

    if (!trimmed) {
      return null;
    }

    if (!/^https?:\/\//i.test(trimmed)) {
      if (/^s3:\/\//i.test(trimmed)) {
        const parsed = new URL(trimmed);
        return decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
      }
      return trimmed.replace(/^\/+/, "");
    }

    try {
      const parsed = new URL(trimmed);
      const markers = [
        `/storage/v1/object/public/${env.CERTIFICATE_STORAGE_BUCKET}/`,
        `/storage/v1/object/sign/${env.CERTIFICATE_STORAGE_BUCKET}/`,
        `/storage/v1/object/authenticated/${env.CERTIFICATE_STORAGE_BUCKET}/`,
        `/storage/v1/object/${env.CERTIFICATE_STORAGE_BUCKET}/`,
      ];

      for (const marker of markers) {
        const index = parsed.pathname.indexOf(marker);
        if (index >= 0) {
          return decodeURIComponent(parsed.pathname.slice(index + marker.length));
        }
      }

      if (env.S3_BUCKET) {
        const host = parsed.hostname.toLowerCase();
        const bucket = env.S3_BUCKET.toLowerCase();
        const isVirtualHostedS3 = host === `${bucket}.s3.amazonaws.com`
          || host.startsWith(`${bucket}.s3.`)
          || host === `${bucket}.s3-accelerate.amazonaws.com`;
        const isPathStyleS3 = host === "s3.amazonaws.com"
          || host.startsWith("s3.")
          || host === "s3-accelerate.amazonaws.com";

        if (isVirtualHostedS3) {
          return decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
        }

        if (isPathStyleS3) {
          const path = parsed.pathname.replace(/^\/+/, "");
          const bucketPrefix = `${env.S3_BUCKET}/`;
          if (path.startsWith(bucketPrefix)) {
            return decodeURIComponent(path.slice(bucketPrefix.length));
          }
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  private resolveCertificateUrl(value?: string | null) {
    const normalized = value?.trim();
    if (!normalized || !/^https?:\/\//i.test(normalized)) {
      return null;
    }

    try {
      const parsed = new URL(normalized);
      const isStorageAsset = parsed.pathname.includes('/storage/v1/object/');
      if (isS3StorageEnabled() && this.extractStoragePath(normalized)) {
        return null;
      }
      return isStorageAsset ? normalized : null;
    } catch {
      return null;
    }
  }

  private async getSignatoryNames(): Promise<CertificateSignatoryNames> {
    return {
      investmentManager: await this.getDisplayNameForRole("investment_manager", "Investment Manager"),
      generalManager: await this.getDisplayNameForRole("general_manager", "General Manager"),
      ceo: await this.getDisplayNameForRole("super_admin", "CEO"),
    };
  }

  private async getDisplayNameForRole(role: AppRole, fallback: string) {
    const preferMongo = env.WORKFLOW_DATA_MONGO_READ_MODE === "mongo"
      || env.WORKFLOW_DATA_MONGO_WRITE_MODE !== "supabase";
    if (preferMongo && !isMongoConfigured()) {
      throw new Error("MongoDB is required for Mongo-primary signatory lookups");
    }
    if (preferMongo) {
      try {
        const staffDirectory = await listStaffDirectoryFromMongo();
        const staffMember = staffDirectory.find((entry) => entry.roles.includes(role));
        if (staffMember?.fullName?.trim()) return staffMember.fullName.trim();
      } catch (error) {
        throw new Error(`Failed to resolve signatory from MongoDB: ${error instanceof Error ? error.message : String(error)}`);
      }

      return fallback;
    }

    const { data, error } = await adminSupabase
      .from("user_roles")
      .select("user_id")
      .eq("role", role)
      .limit(1)
      .maybeSingle();

    if (error || !data?.user_id) {
      return fallback;
    }

    const { data: profile } = await adminSupabase
      .from("profiles")
      .select("full_name")
      .eq("id", data.user_id)
      .maybeSingle();

    if (profile?.full_name?.trim()) {
      return profile.full_name.trim();
    }

    const { data: authUser } = await adminSupabase.auth.admin.getUserById(data.user_id);
    return authUser.user?.email ?? fallback;
  }

  private async getCertificate(certificateId: string) {
    const preferMongo = env.CERTIFICATES_MONGO_READ_MODE === "mongo"
      || env.WORKFLOW_DATA_MONGO_WRITE_MODE !== "supabase";
    if (preferMongo && !isMongoConfigured()) {
      throw new Error("MongoDB is required for Mongo-primary certificate reads");
    }
    if (preferMongo) {
      try {
        const record = await getWorkflowRecordFromMongo("certificates", certificateId);
        if (record) return record as unknown as CertificateRecord;
      } catch (error) {
        throw new Error(`Failed to fetch certificate from MongoDB: ${error instanceof Error ? error.message : String(error)}`);
      }

      throw new Error(`Certificate not found in MongoDB: ${certificateId}`);
    }

    const { data, error } = await adminSupabase
      .from("certificates")
      .select("*")
      .eq("id", certificateId)
      .single<CertificateRecord>();

    if (error || !data) {
      throw new Error(`Certificate not found: ${error?.message ?? certificateId}`);
    }

    return data;
  }

  private async getInvestorActionPath(certificate: CertificateRecord) {
    const preferMongo = env.WORKFLOW_DATA_MONGO_READ_MODE === "mongo"
      || env.WORKFLOW_DATA_MONGO_WRITE_MODE !== "supabase";
    if (preferMongo && !isMongoConfigured()) {
      throw new Error("MongoDB is required for Mongo-primary investor action paths");
    }
    if (preferMongo) {
      try {
        if (certificate.investor_id) {
          const investor = await getWorkflowRecordFromMongo("investors", certificate.investor_id);
          if (investor?.id) return `/investors/${investor.id}`;
        }
        const investors = await listWorkflowRecordsFromMongo("investors") as Array<Record<string, unknown>>;
        const investor = investors
          .filter((record) => String(record.email ?? "").toLowerCase() === certificate.investor_email.trim().toLowerCase())
          .sort((left, right) => Date.parse(String(right.updated_at ?? "")) - Date.parse(String(left.updated_at ?? "")))[0];
        if (investor?.id) return `/investors/${investor.id}`;
      } catch (error) {
        throw new Error(`Failed to resolve investor action path from MongoDB: ${error instanceof Error ? error.message : String(error)}`);
      }

      return null;
    }

    if (certificate.investor_id) {
      const { data: investorById, error: investorByIdError } = await adminSupabase
        .from("investors")
        .select("id")
        .eq("id", certificate.investor_id)
        .maybeSingle();

      if (!investorByIdError && investorById?.id) {
        return `/investors/${investorById.id}`;
      }
    }

    const { data, error } = await adminSupabase
      .from("investors")
      .select("id")
      .ilike("email", certificate.investor_email.trim())
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data?.id) {
      console.warn("[certificates.notifications] Could not resolve investor detail path for certificate", {
        certificateId: certificate.id,
        investorId: certificate.investor_id,
        investorEmail: certificate.investor_email,
      });
      return null;
    }

    return `/investors/${data.id}`;
  }

  private async assertCertificateAccess(certificate: CertificateRecord, actor: AuthenticatedUser) {
    if (!this.canReadCertificate(certificate, actor)) throw new Error("Forbidden for current role");
  }

  private async updateCertificate(
    certificateId: string,
    updates: Partial<CertificateRecord> & Record<string, unknown>,
  ) {
    const { investor_reference_number: _ignoredInvestorReferenceNumber, ...sanitizedUpdates } = updates;

    if (env.WORKFLOW_DATA_MONGO_WRITE_MODE === "mongo") {
      const current = await getWorkflowRecordFromMongo("certificates", certificateId);
      if (!current) {
        throw new Error(`Certificate not found in MongoDB: ${certificateId}`);
      }

      const record = {
        ...current,
        ...sanitizedUpdates,
        id: certificateId,
        updated_at: new Date().toISOString(),
      };
      await this.writeMongoWorkflowRecord("certificates", record);
      await this.mirrorWorkflowRecordToSupabase("certificates", record);
      return record as unknown as CertificateRecord;
    }

    const { data, error } = await adminSupabase
      .from("certificates")
      .update(sanitizedUpdates)
      .eq("id", certificateId)
      .select("*")
      .single<CertificateRecord>();

    if (error || !data) {
      throw new Error(`Failed to update certificate: ${error?.message ?? "Unknown error"}`);
    }

    await this.mirrorCertificateWrite(data as unknown as Record<string, unknown>);

    return data;
  }

  private async mirrorCertificateWrite(record: Record<string, unknown>) {
    const input = { table: "certificates" as const, records: [record] };
    if (env.WORKFLOW_DATA_MONGO_WRITE_MODE === "dual") {
      if (!isMongoConfigured()) {
        throw new Error("MongoDB is required while WORKFLOW_DATA_MONGO_WRITE_MODE=dual");
      }
      const mirrored = await mirrorWorkflowRecordsToMongo(input);
      if (mirrored !== 1) {
        throw new Error("Certificate was saved in Supabase but could not be mirrored to MongoDB");
      }
      return;
    }
    mirrorWorkflowRecordsToMongoSafely(input);
  }

  private async writeMongoWorkflowRecord(
    table: "investors" | "certificates",
    record: Record<string, unknown>,
  ) {
    if (!isMongoConfigured()) {
      throw new Error(`MongoDB is required while WORKFLOW_DATA_MONGO_WRITE_MODE=mongo for ${table}`);
    }

    const mirrored = await mirrorWorkflowRecordsToMongo({ table, records: [record] });
    if (mirrored !== 1) {
      throw new Error(`Failed to write ${table} record to MongoDB`);
    }
  }

  private async mirrorWorkflowRecordToSupabase(
    table: "investors" | "certificates",
    record: Record<string, unknown>,
  ) {
    const compatibleRecord = Object.fromEntries(
      Object.entries(record).filter(([, value]) => value !== undefined),
    );
    const { error } = await adminSupabase
      .from(table)
      .upsert(compatibleRecord, { onConflict: "id" });

    if (error) {
      console.warn(`[workflow-data.mongo] MongoDB write succeeded but Supabase compatibility mirror failed for ${table}`, {
        recordId: record.id,
        reason: error.message,
      });
    }
  }
}
