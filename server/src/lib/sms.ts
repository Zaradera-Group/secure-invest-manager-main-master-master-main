import { env } from "../config/env.js";
import type { CertificateRecord } from "../types/certificates.js";

const TWILIO_API_BASE_URL = "https://api.twilio.com/2010-04-01";
const TWILIO_VERIFY_API_BASE_URL = "https://verify.twilio.com/v2";

type SmsDeliveryResult = {
  sid: string;
  status?: string;
  message?: string;
};

type DisabledSmsResponse = {
  sid: string;
  status: "disabled";
  message: string;
  disabled: true;
};

type BirthdayRecipient = {
  name: string;
  phone: string;
};

type VerificationChannel = "sms" | "call" | "email";
type CourseCertificateRecipient = {
  name: string;
  phone: string;
  certificateLink: string;
};

class NotificationServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationServiceError";
  }
}

class TwilioNotificationService {
  private readonly smsConfigured: boolean;
  private readonly verifyConfigured: boolean;
  private readonly accountSid?: string;
  private readonly authToken?: string;
  private readonly messagingServiceSid?: string;
  private readonly fromNumber?: string;
  private readonly phoneNumber?: string;
  private readonly verifyServiceSid?: string;

  constructor() {
    this.accountSid = env.TWILIO_ACCOUNT_SID;
    this.authToken = env.TWILIO_AUTH_TOKEN;
    this.messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;
    this.fromNumber = env.TWILIO_FROM_NUMBER;
    this.phoneNumber = env.TWILIO_PHONE_NUMBER;
    this.verifyServiceSid = env.TWILIO_VERIFY_SERVICE_SID;
    this.smsConfigured = Boolean(this.accountSid && this.authToken && (this.messagingServiceSid || this.fromNumber || this.phoneNumber));
    this.verifyConfigured = Boolean(this.accountSid && this.authToken && this.verifyServiceSid);
  }

  isConfigured() {
    return this.smsConfigured;
  }

  async sendSms(to: string, message: string) {
    if (!this.isSmsEnabled()) {
      return this.disabledSmsResponse();
    }

    if (!this.smsConfigured) {
      throw new NotificationServiceError(
        "Twilio SMS is not configured: provide TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and either TWILIO_MESSAGING_SERVICE_SID, TWILIO_FROM_NUMBER, or TWILIO_PHONE_NUMBER",
      );
    }

    const senderNumber = this.fromNumber ?? this.phoneNumber;

    if (!this.messagingServiceSid && !senderNumber) {
      throw new NotificationServiceError(
        "Twilio SMS is not configured: provide TWILIO_MESSAGING_SERVICE_SID, TWILIO_FROM_NUMBER, or TWILIO_PHONE_NUMBER",
      );
    }

    const body = new URLSearchParams({
      To: to,
      Body: message,
    });

    if (this.messagingServiceSid) {
      body.set("MessagingServiceSid", this.messagingServiceSid);
    } else if (senderNumber) {
      body.set("From", senderNumber);
    }

    const response = await fetch(`${TWILIO_API_BASE_URL}/Accounts/${this.accountSid}/Messages.json`, {
      method: "POST",
      headers: this.getAuthHeaders(),
      body,
    });

    const data = (await this.parseJson(response)) as SmsDeliveryResult | { message?: string; code?: number } | null;

    if (!response.ok) {
      throw new NotificationServiceError(
        `SMS delivery failed with ${response.status}: ${data?.message ?? "Unknown Twilio error"}`,
      );
    }

    return data;
  }

  async sendBirthdaySms(recipient: BirthdayRecipient) {
    return this.sendSms(
      recipient.phone,
      `Happy Birthday, ${recipient.name}! Wishing you prosperity, joy, and success.`,
    );
  }

  async sendBirthdaySmsBatch(recipients: BirthdayRecipient[]) {
    if (!this.isSmsEnabled()) {
      return {
        total: recipients.length,
        sent: 0,
        failed: 0,
        results: recipients.map((recipient) => ({
          status: "fulfilled" as const,
          value: {
            recipient,
            result: this.disabledSmsResponse(),
          },
        })),
      };
    }

    const results = await Promise.allSettled(
      recipients.map(async (recipient) => ({
        recipient,
        result: await this.sendBirthdaySms(recipient),
      })),
    );

    return {
      total: recipients.length,
      sent: results.filter((entry) => entry.status === "fulfilled").length,
      failed: results.filter((entry) => entry.status === "rejected").length,
      results,
    };
  }

  async sendCertificateReadySms(phone: string, investorName: string) {
    return this.sendSms(
      phone,
      `Congratulations ${investorName}! Your certificate is ready. Please check your email for details.`,
    );
  }

  async sendCourseCertificateSms(recipient: CourseCertificateRecipient) {
    return this.sendSms(
      recipient.phone,
      `Congratulations ${recipient.name}! Your certificate is ready: ${recipient.certificateLink}`,
    );
  }

  async sendVerificationCode(to: string, channel: VerificationChannel = "sms") {
    if (!this.isSmsEnabled()) {
      return this.disabledSmsResponse();
    }

    if (!this.verifyConfigured) {
      throw new NotificationServiceError(
        "Twilio Verify is not configured: provide TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID",
      );
    }

    if (!this.verifyServiceSid) {
      throw new NotificationServiceError(
        "Twilio Verify is not configured: provide TWILIO_VERIFY_SERVICE_SID",
      );
    }

    const response = await fetch(
      `${TWILIO_VERIFY_API_BASE_URL}/Services/${this.verifyServiceSid}/Verifications`,
      {
        method: "POST",
        headers: this.getAuthHeaders(),
        body: new URLSearchParams({
          To: to,
          Channel: channel,
        }),
      },
    );

    const data = await this.parseJson(response);
    if (!response.ok) {
      throw new NotificationServiceError(
        `Verification request failed with ${response.status}: ${this.readErrorMessage(data)}`,
      );
    }

    return data;
  }

  async verifyCode(to: string, code: string) {
    if (!this.isSmsEnabled()) {
      return this.disabledSmsResponse();
    }

    if (!this.verifyConfigured) {
      throw new NotificationServiceError(
        "Twilio Verify is not configured: provide TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID",
      );
    }

    if (!this.verifyServiceSid) {
      throw new NotificationServiceError(
        "Twilio Verify is not configured: provide TWILIO_VERIFY_SERVICE_SID",
      );
    }

    const response = await fetch(
      `${TWILIO_VERIFY_API_BASE_URL}/Services/${this.verifyServiceSid}/VerificationCheck`,
      {
        method: "POST",
        headers: this.getAuthHeaders(),
        body: new URLSearchParams({
          To: to,
          Code: code,
        }),
      },
    );

    const data = await this.parseJson(response);
    if (!response.ok) {
      throw new NotificationServiceError(
        `Verification check failed with ${response.status}: ${this.readErrorMessage(data)}`,
      );
    }

    return data;
  }

  private getAuthHeaders() {
    if (!this.accountSid || !this.authToken) {
      throw new NotificationServiceError("Twilio credentials are missing");
    }

    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");
    return {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };
  }

  private async parseJson(response: Response) {
    const raw = await response.text();

    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { message: raw };
    }
  }

  private readErrorMessage(data: unknown) {
    if (data && typeof data === "object" && "message" in data && typeof data.message === "string") {
      return data.message;
    }

    return "Unknown Twilio error";
  }

  private isSmsEnabled() {
    return env.SMS_ENABLED === true;
  }

  private disabledSmsResponse(): DisabledSmsResponse {
    // SMS disabled pending Twilio compliance verification.
    return {
      sid: "sms-disabled",
      status: "disabled",
      message: "SMS disabled pending Twilio compliance verification",
      disabled: true,
    };
  }
}

export const smsNotificationService = new TwilioNotificationService();

export const isSmsDeliveryConfigured = () => smsNotificationService.isConfigured();

export const sendManagerNotificationSms = async (phone: string, certificate: CertificateRecord) => {
  await smsNotificationService.sendSms(
    phone,
    `Certificate for ${certificate.investor_name} is awaiting Investment Manager review.`,
  );
};

export const sendGeneralManagerNotificationSms = async (
  phone: string,
  certificate: CertificateRecord,
) => {
  await smsNotificationService.sendSms(
    phone,
    `Certificate for ${certificate.investor_name} is awaiting General Manager review.`,
  );
};

export const sendCeoNotificationSms = async (phone: string, certificate: CertificateRecord) => {
  await smsNotificationService.sendSms(
    phone,
    `Certificate for ${certificate.investor_name} is awaiting CEO approval.`,
  );
};

export const sendInvestorCertificateSms = async (
  phone: string,
  certificate: CertificateRecord,
  certificateLink?: string | null,
) => {
  const resolvedCertificateLink = certificateLink ?? certificate.certificate_url ?? "";
  await smsNotificationService.sendCourseCertificateSms({
    name: certificate.investor_name,
    phone,
    certificateLink: resolvedCertificateLink,
  });
};

export const sendBirthdaySms = async (recipient: BirthdayRecipient) =>
  smsNotificationService.sendBirthdaySms(recipient);

export const sendBirthdaySmsBatch = async (recipients: BirthdayRecipient[]) =>
  smsNotificationService.sendBirthdaySmsBatch(recipients);

export const sendCourseCertificateSms = async (recipient: CourseCertificateRecipient) =>
  smsNotificationService.sendCourseCertificateSms(recipient);

export const sendVerificationCode = async (to: string, channel: VerificationChannel = "sms") =>
  smsNotificationService.sendVerificationCode(to, channel);

export const verifySmsCode = async (to: string, code: string) =>
  smsNotificationService.verifyCode(to, code);

export const sendPlainSms = async (to: string, message: string) =>
  smsNotificationService.sendSms(to, message);
