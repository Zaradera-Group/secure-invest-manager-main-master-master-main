import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'npm:pdf-lib'

type SignatureSource = string | null | undefined

export type CertificatePdfData = {
  investorName: string
  investorEmail: string
  amount: number
  interestRate: number
  issueDate: string
  statusLabel: string
  currency?: string
  managerSignature?: SignatureSource
  generalManagerSignature?: SignatureSource
  ceoSignature?: SignatureSource
}

export async function buildCertificatePdf(data: CertificatePdfData) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595.28, 841.89])
  const titleFont = await pdf.embedFont(StandardFonts.HelveticaBold)
  const bodyFont = await pdf.embedFont(StandardFonts.Helvetica)

  page.drawRectangle({
    x: 28,
    y: 28,
    width: page.getWidth() - 56,
    height: page.getHeight() - 56,
    borderColor: rgb(0.15, 0.24, 0.36),
    borderWidth: 2,
  })

  page.drawText('Investment Certificate', {
    x: 150,
    y: 760,
    size: 24,
    font: titleFont,
    color: rgb(0.1, 0.2, 0.35),
  })

  page.drawText('Zaradera Credit Limited', {
    x: 190,
    y: 728,
    size: 12,
    font: bodyFont,
    color: rgb(0.25, 0.3, 0.35),
  })

  const leftRows = [
    ['Investor Name', data.investorName],
    ['Investor Email', data.investorEmail],
    ['Issue Date', formatDate(data.issueDate)],
  ]

  const rightRows = [
    ['Investment Amount', formatCurrency(data.amount, data.currency || 'USD')],
    ['Interest Rate', `${data.interestRate.toFixed(2)}%`],
    ['Workflow Status', data.statusLabel],
  ]

  const headerY = 672
  page.drawText('Certificate Details', {
    x: 72,
    y: headerY,
    size: 14,
    font: titleFont,
    color: rgb(0.1, 0.2, 0.35),
  })

  let leftY = headerY - 28
  leftRows.forEach(([label, value]) => {
    page.drawText(`${label}:`, {
      x: 72,
      y: leftY,
      size: 11,
      font: titleFont,
      color: rgb(0.12, 0.16, 0.22),
    })
    page.drawText(value, {
      x: 72,
      y: leftY - 14,
      size: 11,
      font: bodyFont,
      color: rgb(0.18, 0.22, 0.28),
    })
    leftY -= 38
  })

  let rightY = headerY - 28
  rightRows.forEach(([label, value]) => {
    page.drawText(`${label}:`, {
      x: 320,
      y: rightY,
      size: 11,
      font: titleFont,
      color: rgb(0.12, 0.16, 0.22),
    })
    page.drawText(value, {
      x: 320,
      y: rightY - 14,
      size: 11,
      font: bodyFont,
      color: rgb(0.18, 0.22, 0.28),
    })
    rightY -= 38
  })

  page.drawText(
    'This certificate confirms the investment details stated above and is subject to all applicable terms, approvals, and compliance checks of the company.',
    {
      x: 72,
      y: 430,
      size: 11,
      font: bodyFont,
      color: rgb(0.18, 0.2, 0.24),
      maxWidth: 450,
      lineHeight: 16,
    },
  )

  await drawSignatureBlock(pdf, page, bodyFont, titleFont, {
    title: 'Manager Signature',
    x: 72,
    y: 220,
    signature: data.managerSignature,
  })

  await drawSignatureBlock(pdf, page, bodyFont, titleFont, {
    title: 'CEO Signature',
    x: 330,
    y: 220,
    signature: data.ceoSignature,
  })

  await drawSignatureBlock(pdf, page, bodyFont, titleFont, {
    title: 'General Manager Signature',
    x: 72,
    y: 140,
    signature: data.generalManagerSignature,
  })

  return await pdf.save()
}

async function drawSignatureBlock(
  pdf: PDFDocument,
  page: PDFPage,
  bodyFont: PDFFont,
  titleFont: PDFFont,
  args: { title: string; x: number; y: number; signature?: SignatureSource },
) {
  const { title, x, y, signature } = args
  page.drawText(title, {
    x,
    y,
    size: 12,
    font: titleFont,
    color: rgb(0.12, 0.16, 0.22),
  })

  page.drawLine({
    start: { x, y: y - 8 },
    end: { x: x + 170, y: y - 8 },
    thickness: 1,
    color: rgb(0.45, 0.48, 0.54),
  })

  if (!signature) {
    page.drawText('Pending signature', {
      x,
      y: y - 28,
      size: 10,
      font: bodyFont,
      color: rgb(0.55, 0.58, 0.62),
    })
    return
  }

  const imageBytes = await readSignatureBytes(signature)
  if (!imageBytes) {
    page.drawText('Signature on file', {
      x,
      y: y - 28,
      size: 10,
      font: bodyFont,
      color: rgb(0.35, 0.4, 0.45),
    })
    return
  }

  const embeddedImage = isPngSignature(signature)
    ? await pdf.embedPng(imageBytes)
    : await pdf.embedJpg(imageBytes)

  const scaled = embeddedImage.scale(0.35)
  page.drawImage(embeddedImage, {
    x,
    y: y - 68,
    width: Math.min(scaled.width, 160),
    height: Math.min(scaled.height, 52),
  })
}

async function readSignatureBytes(signature: string) {
  if (signature.startsWith('data:image/')) {
    const base64 = signature.split(',', 2)[1]
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  }

  if (signature.startsWith('http://') || signature.startsWith('https://')) {
    const response = await fetch(signature)
    if (!response.ok) return null
    return new Uint8Array(await response.arrayBuffer())
  }

  return null
}

function isPngSignature(signature: string) {
  return signature.startsWith('data:image/png') || signature.endsWith('.png')
}

function formatCurrency(amount: number, currency: string = 'USD') {
  if (currency === 'NGN') {
    // Use text format to avoid Unicode symbol issues in PDF
    return `NGN ${amount.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
}
