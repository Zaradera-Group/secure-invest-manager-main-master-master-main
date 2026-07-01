import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, PDFFont, StandardFonts, rgb } from "pdf-lib";
import { adminSupabase } from "./supabase.js";
import { env } from "../config/env.js";
import type { AppRole, CertificateRecord, CertificateSignatoryNames } from "../types/certificates.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const serverRootDir = path.resolve(currentDir, "..", "..");
const certificateBackgroundPath = path.resolve(serverRootDir, "..", "public", "assets", "image_2.png");
const certificateSealPath = path.resolve(serverRootDir, "..", "public", "assets", "zaradera-seal.png");
const loadCertificateBackground = async (): Promise<Uint8Array | null> => {
  try {
    return await readFile(certificateBackgroundPath);
  } catch {
    return null;
  }
};

const loadCertificateSeal = async (): Promise<Uint8Array | null> => {
  try {
    return await readFile(certificateSealPath);
  } catch {
    return null;
  }
};

const drawSignature = async (
  pdfDoc: PDFDocument,
  page: ReturnType<PDFDocument["addPage"]>,
  signature: string | null,
  x: number,
  y: number,
  width: number,
  height: number,
) => {
  if (!signature) {
    return;
  }

  try {
    let bytes: Uint8Array | null = null;
    let isJpeg = false;

    if (/^https?:\/\//i.test(signature)) {
      const response = await fetch(signature);
      if (!response.ok) {
        return;
      }

      bytes = new Uint8Array(await response.arrayBuffer());
      isJpeg = (response.headers.get("content-type")?.includes("jpeg") ?? false)
        || signature.toLowerCase().includes(".jpg")
        || signature.toLowerCase().includes(".jpeg");
    } else {
      const base64Payload = signature.includes(",") ? signature.split(",")[1] : signature;
      bytes = Uint8Array.from(Buffer.from(base64Payload, "base64"));
      isJpeg = signature.includes("image/jpeg") || signature.toLowerCase().includes(".jpg") || signature.toLowerCase().includes(".jpeg");
    }

    if (!bytes?.length) {
      return;
    }

    const image = isJpeg
      ? await pdfDoc.embedJpg(bytes)
      : await pdfDoc.embedPng(bytes);

    page.drawImage(image, { x, y, width, height });
  } catch {
    // Leave the signature area empty if the stored value cannot be decoded.
  }
};

const drawSeal = async (
  pdfDoc: PDFDocument,
  page: ReturnType<PDFDocument["addPage"]>,
  sealBytes: Uint8Array | null,
  options: {
    centerX: number;
    centerY: number;
    width: number;
    height: number;
  },
) => {
  if (!sealBytes) {
    return;
  }

  try {
    const image = await pdfDoc.embedPng(sealBytes);
    page.drawImage(image, {
      x: options.centerX - options.width / 2,
      y: options.centerY - options.height / 2,
      width: options.width,
      height: options.height,
    });
  } catch {
    // Leave the seal area empty if the image cannot be decoded.
  }
};

const drawWrappedText = (
  page: ReturnType<PDFDocument["addPage"]>,
  text: string,
  options: {
    x: number;
    y: number;
    maxWidth: number;
    lineHeight: number;
    size: number;
    font: PDFFont;
  },
) => {
  const content = text.trim();
  if (!content) {
    return options.y;
  }

  const words = content.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    const width = options.font.widthOfTextAtSize(candidate, options.size);

    if (width <= options.maxWidth) {
      currentLine = candidate;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  lines.forEach((line, index) => {
    page.drawText(line, {
      x: options.x,
      y: options.y - index * options.lineHeight,
      size: options.size,
      font: options.font,
      color: rgb(0.08, 0.08, 0.08),
    });
  });

  return options.y - lines.length * options.lineHeight;
};

const drawLabelValueLine = (
  page: ReturnType<PDFDocument["addPage"]>,
  label: string,
  value: string,
  options: {
    x: number;
    y: number;
    labelFont: PDFFont;
    valueFont: PDFFont;
    size: number;
    maxWidth: number;
  },
) => {
  const labelText = `${label}: `;
  const labelWidth = options.labelFont.widthOfTextAtSize(labelText, options.size);
  const valueX = options.x + labelWidth;
  const availableValueWidth = Math.max(options.maxWidth - labelWidth, 80);
  const safeValue = value.trim() || "Pending";
  const valueSize = fitTextToWidth(safeValue, options.valueFont, options.size, availableValueWidth, 8);

  page.drawText(labelText, {
    x: options.x,
    y: options.y,
    size: options.size,
    font: options.labelFont,
    color: rgb(0.08, 0.08, 0.08),
  });

  page.drawText(safeValue, {
    x: valueX,
    y: options.y,
    size: valueSize,
    font: options.valueFont,
    color: rgb(0.28, 0.28, 0.28),
  });
};

const drawTermItem = (
  page: ReturnType<PDFDocument["addPage"]>,
  item: {
    index: string;
    title: string;
    body: string;
  },
  options: {
    x: number;
    y: number;
    maxWidth: number;
    lineHeight: number;
    titleSize: number;
    bodySize: number;
    titleFont: PDFFont;
    bodyFont: PDFFont;
  },
) => {
  page.drawText(`${item.index}. ${item.title}`, {
    x: options.x,
    y: options.y,
    size: options.titleSize,
    font: options.titleFont,
    color: rgb(0.08, 0.08, 0.08),
  });

  let endY = options.y;

  if (item.body.trim()) {
    endY = drawWrappedText(page, item.body, {
      x: options.x + 18,
      y: options.y - options.lineHeight,
      maxWidth: options.maxWidth - 18,
      lineHeight: options.lineHeight,
      size: options.bodySize,
      font: options.bodyFont,
    });
  }

  return Math.min(endY, options.y) - 8;
};

const formatCurrency = (value: number, currencyCode = "NGN") => {
  if (currencyCode === "NGN") {
    return `NGN ${value.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
};

const numberToWordsBelowThousand = (value: number): string => {
  const ones = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
  ];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

  if (value < 20) {
    return ones[value];
  }

  if (value < 100) {
    const remainder = value % 10;
    const tensValue = tens[Math.floor(value / 10)] ?? "";
    const onesValue = ones[remainder] ?? "";
    return remainder === 0 ? tensValue : `${tensValue}-${onesValue}`;
  }

  const remainder = value % 100;
  const hundredValue = ones[Math.floor(value / 100)] ?? "";
  const hundredPart = `${hundredValue} hundred`;
  return remainder === 0 ? hundredPart : `${hundredPart} and ${numberToWordsBelowThousand(remainder)}`;
};

const numberToWords = (value: number): string => {
  if (!Number.isFinite(value) || value < 0) {
    return "";
  }

  if (value === 0) {
    return "zero";
  }

  const scales = [
    { size: 1_000_000_000, label: "billion" },
    { size: 1_000_000, label: "million" },
    { size: 1_000, label: "thousand" },
  ] as const;

  let remainder = Math.floor(value);
  const parts: string[] = [];

  for (const scale of scales) {
    if (remainder >= scale.size) {
      const chunk = Math.floor(remainder / scale.size);
      parts.push(`${numberToWordsBelowThousand(chunk)} ${scale.label}`);
      remainder %= scale.size;
    }
  }

  if (remainder > 0) {
    parts.push(numberToWordsBelowThousand(remainder));
  }

  return parts.join(" ");
};

const formatCurrencyWords = (value: number, currencyCode = "NGN") =>
  `${numberToWords(Math.round(value))} ${currencyCode.toLowerCase()} only`;

const drawCenteredText = (
  page: ReturnType<PDFDocument["addPage"]>,
  text: string,
  options: {
    centerX: number;
    y: number;
    maxWidth: number;
    size: number;
    font: PDFFont;
  },
) => {
  let output = text.trim();

  while (output.length > 0 && options.font.widthOfTextAtSize(output, options.size) > options.maxWidth) {
    output = output.slice(0, -1).trimEnd();
  }

  const width = options.font.widthOfTextAtSize(output, options.size);
  page.drawText(output, {
    x: options.centerX - width / 2,
    y: options.y,
    size: options.size,
    font: options.font,
    color: rgb(0.08, 0.08, 0.08),
  });
};

const fitTextToWidth = (
  text: string,
  font: PDFFont,
  initialSize: number,
  maxWidth: number,
  minSize = 7,
) => {
  let size = initialSize;

  while (size > minSize && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 0.5;
  }

  return size;
};

const formatDate = (value?: string | null) => {
  if (!value) {
    return "Pending";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("en-GB");
};

const parseTenureMonths = (investmentTenure?: string | null) => {
  if (!investmentTenure) {
    return 0;
  }

  const match = /(\d+(?:\.\d+)?)/.exec(investmentTenure);
  return match ? Number.parseFloat(match[1]) : 0;
};

export const generateCertificatePdf = async (
  certificate: CertificateRecord,
  signatories: CertificateSignatoryNames,
  options?: {
    creatorRole?: AppRole | null;
  },
): Promise<Uint8Array> => {
  const backgroundBytes = await loadCertificateBackground();
  const sealBytes = await loadCertificateSeal();
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);

  if (backgroundBytes) {
    const backgroundImage = await pdfDoc.embedPng(backgroundBytes);
    page.drawImage(backgroundImage, {
      x: 0,
      y: 0,
      width: page.getWidth(),
      height: page.getHeight(),
    });
  }

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pageHeight = page.getHeight();
  const currencyCode = certificate.currency_code ?? "NGN";
  const amount = Number(certificate.amount);
  const interestRatePerMonth = Number(certificate.interest_rate);
  const tenureMonths = parseTenureMonths(certificate.investment_tenure);
  const tenureLabel = certificate.investment_tenure?.trim() || `${tenureMonths || 0} month(s)`;
  const monthlyReturnAmount = amount * (interestRatePerMonth / 100);
  const calculatedInterest = monthlyReturnAmount * tenureMonths;
  const issueDate = formatDate(certificate.issue_date ?? certificate.created_at);
  const maturityDate = formatDate(certificate.principal_maturity_date);
  const investmentReference = certificate.investor_reference_number ? String(certificate.investor_reference_number) : "Pending";
  const interestPaymentDescription = certificate.interest_payment?.trim()
    || `Interest for the tenor of ${tenureLabel} is structured as ${calculatedInterest.toFixed(2)} at the rate of ${interestRatePerMonth}% per month, with a monthly return of ${formatCurrency(monthlyReturnAmount, currencyCode)} and a total return of ${formatCurrency(calculatedInterest, currencyCode)} (${formatCurrencyWords(calculatedInterest, currencyCode)}).`;
  const certificateTitleY = pageHeight - 114;
  const certificateDetailsStartY = pageHeight - 152;
  const signatureY = 88;
  const signatureWidth = 112;
  const signatureHeight = 28;
  const signatoryNameY = 84;
  const signatoryTitleY = 70;
  const shouldShowCeoSeal = Boolean(
    certificate.ceo_signature
      || certificate.ceo_approved_by
      || certificate.approved_at
      || certificate.sent_by
      || certificate.sent_at
      || certificate.status === "approved"
      || certificate.status === "sent",
  );

  page.drawText("Certificate of Investment", {
    x: 170,
    y: certificateTitleY,
    size: 16,
    font: boldFont,
    color: rgb(0.08, 0.08, 0.08),
  });

  const detailLines = [
    { label: "Date of Issue", value: issueDate },
    { label: "Investor Reference", value: investmentReference },
    { label: "Investor Name", value: certificate.investor_name },
    { label: "Investment Amount", value: formatCurrency(amount, currencyCode) },
    { label: "Currency", value: currencyCode },
    { label: "Investment Tenue", value: tenureLabel },
    { label: "Interest Rate", value: `${interestRatePerMonth}% per month` },
    { label: "Monthly Return", value: formatCurrency(monthlyReturnAmount, currencyCode) },
    { label: "Principal Maturity Date", value: maturityDate },
  ] as const;

  let detailCursorY = certificateDetailsStartY;
  detailLines.forEach((line) => {
    drawLabelValueLine(page, line.label, line.value, {
      x: 62,
      y: detailCursorY,
      size: 11,
      maxWidth: 470,
      labelFont: boldFont,
      valueFont: font,
    });
    detailCursorY -= 26;
  });

  page.drawText("Terms and Conditions", {
    x: 60,
    y: 446,
    size: 13,
    font: boldFont,
    color: rgb(0.08, 0.08, 0.08),
  });

  const terms = [
    {
      index: "1",
      title: "Principal Repayment",
      body: `The principal sum of ${formatCurrency(amount, currencyCode)} shall be repaid in full to the investor on the maturity date stated above.`,
    },
    {
      index: "2",
      title: "Interest Payment",
      body: interestPaymentDescription,
    },
    {
      index: "3",
      title: "Early Termination",
      body: "i. If the investor requests withdrawal before maturity, Zaradera Credit reserves the right to deduct the full amount of interest paid upfront from the principal. ii. An additional penalty of 2% of the principal shall apply for breach of tenure.",
    },
    {
      index: "4",
      title: "Notification of Early Liquidation",
      body: "i. Investors must provide written notice at least 30 business days prior to the intended liquidation date.",
    },
    {
      index: "5",
      title: "Rollover",
      body: "A notification of three days before liquidation is needed.",
    },
    {
      index: "6",
      title: "Maturity Date Adjustment",
      body: "If the stated maturity date falls on a weekend or public holiday, repayment of the principal shall be made on the next official business day. No additional interest shall accrue for the extension period.",
    },
  ] as const;

  let cursorY = 428;
  terms.forEach((term) => {
    cursorY = drawTermItem(page, term, {
      x: 60,
      y: cursorY,
      maxWidth: 475,
      lineHeight: 12,
      titleSize: 11,
      bodySize: 9.2,
      titleFont: boldFont,
      bodyFont: font,
    }) - 10;
  });

  const thankYouY = Math.max(cursorY - 14, signatureY + signatureHeight + 4);

  drawWrappedText(page, "Thank you for believing in us to serve you better.", {
    x: 60,
    y: thankYouY,
    maxWidth: 475,
    lineHeight: 11,
    size: 10,
    font,
  });

  if (shouldShowCeoSeal) {
    await drawSeal(pdfDoc, page, sealBytes, {
      centerX: 485,
      centerY: 116,
      width: 92,
      height: 92,
    });
  }

  const signatoryColumns = [
    {
      name: signatories.investmentManager,
      title: "Investment Manager",
      centerX: 110,
      signature: certificate.manager_signature,
      showIdentity: true,
      showSignature: true,
      showSeal: false,
    },
    {
      name: signatories.generalManager,
      title: "General Manager",
      centerX: 297.5,
      signature: certificate.general_manager_signature,
      showIdentity: true,
      showSignature: true,
      showSeal: false,
    },
    {
      name: signatories.ceo,
      title: "CEO",
      centerX: 485,
      signature: null,
      showIdentity: true,
      showSignature: false,
      showSeal: shouldShowCeoSeal,
    },
  ] as const;

  signatoryColumns.forEach((column) => {
    if (!column.showIdentity) {
      return;
    }

    const nameSize = fitTextToWidth(column.name, boldFont, 10, 140);
    const titleSize = fitTextToWidth(column.title, font, 9, 140);

    drawCenteredText(page, column.name, {
      centerX: column.centerX,
      y: signatoryNameY,
      maxWidth: 140,
      size: nameSize,
      font: boldFont,
    });

    drawCenteredText(page, column.title, {
      centerX: column.centerX,
      y: signatoryTitleY,
      maxWidth: 140,
      size: titleSize,
      font,
    });
  });

  await drawSignature(pdfDoc, page, certificate.manager_signature, 54, signatureY, signatureWidth, signatureHeight);
  await drawSignature(pdfDoc, page, certificate.general_manager_signature, 241.5, signatureY, signatureWidth, signatureHeight);

  return pdfDoc.save();
};

export const uploadCertificatePdf = async (
  certificateId: string,
  pdfBytes: Uint8Array,
): Promise<string> => {
  const filePath = `certificates/${certificateId}.pdf`;

  const { error } = await adminSupabase.storage
    .from(env.CERTIFICATE_STORAGE_BUCKET)
    .upload(filePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to upload certificate PDF: ${error.message}`);
  }

  return filePath;
};
