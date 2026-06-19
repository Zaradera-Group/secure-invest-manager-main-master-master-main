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

export const sendBirthdayEmail = async (email: string, name: string, _age: number | null) => {
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
              <p>Thank you for your continued trust and confidence in Zaraderavest. We remain committed to helping you achieve your financial goals through secure and rewarding investment opportunities.</p>
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

export const sendInvestorCertificateEmail = async (
  email: string,
  certificate: CertificateRecord,
  certificateLink?: string | null,
) => {
  const resolvedCertificateLink = certificateLink ?? certificate.certificate_url;

  if (!resolvedCertificateLink) {
    throw new Error('A certificate download link is required before sending the investor email.');
  }

  await sendEmail({
    email,
    subject: "Your investment certificate",
    html: `
      <p>Your certificate has been approved and issued.</p>
      <p>
        <a href="${resolvedCertificateLink}" target="_blank" rel="noreferrer" style="display:inline-block;padding:12px 18px;background:#0f4c81;color:#ffffff;text-decoration:none;border-radius:6px;">
          Download certificate
        </a>
      </p>
      <p>If the button does not open automatically, use this link: <a href="${resolvedCertificateLink}">${resolvedCertificateLink}</a></p>
    `,
  });
};
