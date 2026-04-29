import { Resend } from "resend";
import { env } from "../config/env.js";
import type { CertificateRecord } from "../types/certificates.js";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

interface EmailRecipient {
  email: string;
  subject: string;
  html: string;
}

const sendEmail = async ({ email, subject, html }: EmailRecipient) => {
  if (!env.EMAIL_DELIVERY_ENABLED || !resend || !env.RESEND_FROM_EMAIL) {
    console.log(`[email] skipped delivery to ${email}: email delivery is disabled or not configured`);
    return;
  }

  await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to: email,
    subject,
    html,
  });
};

export const sendManagerNotificationEmail = async (email: string, certificate: CertificateRecord) => {
  await sendEmail({
    email,
    subject: "Certificate awaiting manager review",
    html: `<p>A certificate for <strong>${certificate.investor_name}</strong> is ready for manager review.</p><p>Status: ${certificate.status}</p>`,
  });
};

export const sendGeneralManagerNotificationEmail = async (
  email: string,
  certificate: CertificateRecord,
) => {
  await sendEmail({
    email,
    subject: "Certificate awaiting general manager review",
    html: `<p>A certificate for <strong>${certificate.investor_name}</strong> is ready for general manager review.</p><p>Status: ${certificate.status}</p>`,
  });
};

export const sendCeoNotificationEmail = async (email: string, certificate: CertificateRecord) => {
  await sendEmail({
    email,
    subject: "Certificate awaiting CEO approval",
    html: `<p>A certificate for <strong>${certificate.investor_name}</strong> is ready for CEO approval.</p><p>Status: ${certificate.status}</p>`,
  });
};

export const sendInvestorCertificateEmail = async (
  email: string,
  certificate: CertificateRecord,
  certificateLink?: string | null,
) => {
  const resolvedCertificateLink = certificateLink ?? certificate.certificate_url ?? "#";

  await sendEmail({
    email,
    subject: "Your investment certificate",
    html: `<p>Your certificate has been approved and issued.</p><p><a href="${resolvedCertificateLink}">Download certificate</a></p>`,
  });
};
