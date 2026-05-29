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

export const sendPlainEmail = async (email: string, subject: string, html: string) => {
  await sendEmail({ email, subject, html });
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

export const sendBirthdayEmail = async (email: string, name: string, age: number | null) => {
  const ageText = age ? `your ${formatOrdinal(age)}` : '';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Happy Birthday!</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #f24c21 0%, #f5a623 100%); color: white; padding: 40px 20px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { padding: 30px 20px; background: #f8f9fa; }
        .birthday-message { background: white; padding: 30px; border-radius: 10px; margin: 20px 0; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .celebration { font-size: 32px; margin: 20px 0; }
        .name { font-size: 28px; font-weight: bold; color: #f24c21; margin: 20px 0; }
        .message { font-size: 18px; line-height: 1.8; color: #555; }
        .footer { text-align: center; padding: 20px; font-size: 14px; color: #777; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Happy Birthday!</h1>
        </div>

        <div class="content">
          <div class="birthday-message">
            <div class="celebration">Celebrate today</div>
            <div class="name">Dear ${name},</div>
            <div class="message">
              <p>Wishing you a fantastic birthday filled with joy, laughter, and the moments that matter most.</p>
              ${age ? `<p>May ${ageText} be filled with success, good health, and prosperity.</p>` : ''}
              <p>Thank you for being a valued member of our investment community. We look forward to many more successful years together.</p>
              <p><strong>Best wishes from all of us at Zaradera Credit Limited.</strong></p>
            </div>
          </div>
        </div>

        <div class="footer">
          <p>This birthday greeting was sent automatically from the Zaradera Credit Limited Investment Management System.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail({
    email,
    subject: `Happy Birthday ${name}!`,
    html,
  });
};

function formatOrdinal(value: number): string {
  const remainder10 = value % 10;
  const remainder100 = value % 100;
  if (remainder10 === 1 && remainder100 !== 11) return `${value}st`;
  if (remainder10 === 2 && remainder100 !== 12) return `${value}nd`;
  if (remainder10 === 3 && remainder100 !== 13) return `${value}rd`;
  return `${value}th`;
}

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
