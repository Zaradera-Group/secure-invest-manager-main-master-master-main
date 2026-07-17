import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib'
import { createClient } from 'npm:@supabase/supabase-js'
import { getCertificateActionUpdates, type CertificateAction, type AppRole } from './certificateAction.ts'

type TemplateRecord = {
  id: string
  storage_bucket?: string | null
  storage_path?: string | null
  source_url?: string | null
}

const TEMPLATE_BUCKET = 'certificate-templates'
const GENERATED_BUCKET = 'generated-certificates'
const SIGNATURE_BUCKET = 'certificate-signatures'
const CERTIFICATE_EMAILS_ENABLED = (Deno.env.get('CERTIFICATE_WORKFLOW_EMAILS_ENABLED') ?? 'false').toLowerCase() === 'true'

export async function processCertificateWorkflow(args: {
  supabaseClient: ReturnType<typeof createClient>
  investorId: string
  action: CertificateAction
  requestedByUserId: string
  issueDate?: string
  notes?: string
  signatureDataUrl?: string
  requestOrigin?: string
}) {
  const { supabaseClient, investorId, action, requestedByUserId, issueDate, notes, signatureDataUrl } = args
  const requestOrigin = args.requestOrigin ?? Deno.env.get('PUBLIC_APP_URL') ?? ''

  const actingUserEmail = await getAuthUserEmail(supabaseClient, requestedByUserId)
  const role = await getUserRole(supabaseClient, requestedByUserId)
  ensureActionAllowed(role, action)

  const investor = await getInvestor(supabaseClient, investorId)
  const template = await getActiveTemplate(supabaseClient, requestOrigin)

  let certificate = await getCertificate(supabaseClient, investorId)
  if (!certificate) {
    certificate = await createDraftCertificate(
      supabaseClient,
      investor,
      isUuid(template.id) ? template.id : null,
      requestedByUserId,
      issueDate,
    )
  }

  let uploadedSignatureUrl: string | null = null
  if (signatureDataUrl) {
    uploadedSignatureUrl = await uploadSignature(supabaseClient, requestedByUserId, investorId, signatureDataUrl)
  }

  certificate = await applyAction({
    supabaseClient,
    certificate,
    investor,
    action,
    role,
    userId: requestedByUserId,
    uploadedSignatureUrl,
    notes,
    issueDate,
  })

  const generated = await generateCertificatePdf({
    supabaseClient,
    investor,
    template,
    certificate,
  })

  const updatedCertificate = await updateGeneratedCertificate(supabaseClient, certificate.id, generated.storagePath)

  if (action === 'approve_ceo') {
    await sendCertificateEmail({
      recipientEmail: actingUserEmail ?? '',
      recipientName: 'CEO',
      certificateUrl: generated.signedUrl,
      investorName: investor.name,
      notificationType: 'certificate_ceo_approval',
      userId: requestedByUserId,
      investorId: investor.id,
    })
  }

  if (action === 'approve_investment_manager') {
    await sendCertificateEmail({
      recipientEmail: investor.email,
      recipientName: investor.name,
      certificateUrl: generated.signedUrl,
      investorName: investor.name,
      notificationType: 'certificate_delivery',
      userId: requestedByUserId,
      investorId: investor.id,
    })
  }

  return {
    certificate: updatedCertificate,
    certificateUrl: generated.signedUrl,
    message: getSuccessMessage(action),
  }
}

async function getUserRole(supabaseClient: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await supabaseClient
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data?.role) throw new Error('User has no assigned role.')
  return data.role as AppRole
}

async function getAuthUserEmail(supabaseClient: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await supabaseClient.auth.admin.getUserById(userId)
  if (error) throw error
  return data.user.email ?? null
}

function ensureActionAllowed(role: AppRole, action: CertificateAction) {
  const permissions: Record<CertificateAction, AppRole[]> = {
    generate: ['investment_manager', 'accountant'],
    approve_investment_manager: ['investment_manager', 'accountant'],
    approve_general_manager: ['general_manager'],
    approve_ceo: ['super_admin'],
    send_to_investor: ['investment_manager', 'accountant'],
  }

  if (!permissions[action].includes(role)) {
    throw new Error('You do not have permission to perform this certificate action.')
  }
}

async function getInvestor(supabaseClient: ReturnType<typeof createClient>, investorId: string) {
  const { data, error } = await supabaseClient
    .from('investors')
    .select('*')
    .eq('id', investorId)
    .single()

  if (error || !data) throw error ?? new Error('Investor not found.')
  return data
}

async function getActiveTemplate(supabaseClient: ReturnType<typeof createClient>, requestOrigin: string) {
  const { data, error } = await supabaseClient
    .from('certificate_templates')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (data) return data as TemplateRecord

  const fallbackBaseUrl = requestOrigin.trim()
  if (!fallbackBaseUrl) {
    throw new Error('No active certificate template found.')
  }

  return {
    id: 'bundled-template',
    source_url: `${fallbackBaseUrl.replace(/\/$/, '')}/templates/investor-certificate-template.pdf`,
  } satisfies TemplateRecord
}

async function getCertificate(supabaseClient: ReturnType<typeof createClient>, investorId: string) {
  const { data, error } = await supabaseClient
    .from('investor_certificates')
    .select('*')
    .eq('investor_id', investorId)
    .maybeSingle()

  if (error) throw error
  return data
}

function calculateInterestPayment(investor: Record<string, unknown>) {
  const investmentAmount = Number(investor.investment_amount ?? 0)
  const expectedMaturityAmount = Number(investor.expected_maturity_amount ?? 0)
  const tenure = Number(investor.tenure ?? 0)
  const mode = String(investor.investment_type ?? '')
  const totalInterest = Math.max(0, expectedMaturityAmount - investmentAmount)

  if (mode === 'Monthly' && tenure > 0) return totalInterest / tenure
  if (mode === 'Quarterly' && tenure > 0) return totalInterest / Math.max(1, Math.ceil(tenure / 3))
  return totalInterest
}

async function createDraftCertificate(
  supabaseClient: ReturnType<typeof createClient>,
  investor: Record<string, unknown>,
  templateId: string | null,
  userId: string,
  issueDate?: string,
) {
  const { data, error } = await supabaseClient
    .from('investor_certificates')
    .insert({
      investor_id: investor.id as string,
      template_id: templateId,
      mode_of_payment: investor.investment_type as string,
      calculated_interest_payment: calculateInterestPayment(investor),
      created_by: userId,
      status: 'draft',
      issue_date: issueDate,
    })
    .select('*')
    .single()

  if (error) throw error
  return data
}

async function uploadSignature(
  supabaseClient: ReturnType<typeof createClient>,
  userId: string,
  investorId: string,
  signatureDataUrl: string,
) {
  const match = signatureDataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/)
  if (!match) throw new Error('Invalid signature format. Please sign again.')

  const mimeType = match[1]
  const base64Data = match[2]
  const extension = mimeType.includes('png') ? 'png' : 'jpg'
  const buffer = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0))
  const path = `${userId}/${investorId}-${Date.now()}.${extension}`

  const { error } = await supabaseClient.storage
    .from(SIGNATURE_BUCKET)
    .upload(path, buffer, { contentType: mimeType, upsert: true })

  if (error) throw error

  // Persist the renderable payload so certificate regeneration does not depend on an expiring signed URL.
  return signatureDataUrl
}

async function applyAction(args: {
  supabaseClient: ReturnType<typeof createClient>
  certificate: Record<string, unknown>
  investor: Record<string, unknown>
  action: CertificateAction
  role: AppRole
  userId: string
  uploadedSignatureUrl: string | null
  notes?: string
  issueDate?: string
}) {
  const { supabaseClient, certificate, investor, action, role, userId, uploadedSignatureUrl, notes, issueDate } = args
  const now = new Date().toISOString()

  const updates = getCertificateActionUpdates({
    action,
    certificate,
    role,
    now,
    userId,
    uploadedSignatureUrl,
    issueDate,
  })

  const { data, error } = await supabaseClient
    .from('investor_certificates')
    .update(updates)
    .eq('id', certificate.id as string)
    .select('*')
    .single()

  if (error) throw error

  const { error: eventError } = await supabaseClient
    .from('certificate_approval_events')
    .insert({
      certificate_id: certificate.id as string,
      approver_id: userId,
      approver_role: role,
      action,
      signature_url: uploadedSignatureUrl,
      notes: notes ?? null,
    })

  if (eventError) throw eventError

  if (action === 'generate') {
    await sendApprovalNotifications(supabaseClient, ['general_manager'], `Certificate for ${investor.name} is ready for General Manager review and signature.`, userId, investor.id as string, 'certificate_general_manager_review')
  } else if (action === 'approve_general_manager') {
    await sendApprovalNotifications(supabaseClient, ['super_admin'], `Certificate for ${investor.name} is ready for CEO final approval.`, userId, investor.id as string, 'certificate_ceo_review')
  } else if (action === 'approve_ceo') {
    await sendApprovalNotifications(supabaseClient, ['investment_manager', 'accountant'], `Certificate for ${investor.name} has CEO approval and is waiting for the Investment Manager final signature.`, userId, investor.id as string, 'certificate_investment_manager_finalization')
  }

  return data
}

async function generateCertificatePdf(args: {
  supabaseClient: ReturnType<typeof createClient>
  investor: Record<string, unknown>
  template: TemplateRecord
  certificate: Record<string, unknown>
}) {
  const { supabaseClient, investor, template, certificate } = args
  const templateBytes = await getTemplateBytes(supabaseClient, template)
  const pdfDoc = await PDFDocument.load(templateBytes)
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const firstPage = pdfDoc.getPages()[0]
  const { width, height } = firstPage.getSize()
  const ceoSealBytes = await loadCeoSealBytes()

  const investmentAmount = Number(investor.investment_amount ?? 0)
  const calculatedInterest = Number(certificate.calculated_interest_payment ?? 0)
  const issueDate = String(certificate.issue_date ?? new Date().toISOString().split('T')[0])

  firstPage.drawText('Investor Details', {
    x: 120,
    y: height - 170,
    size: 12,
    font: bold,
    color: rgb(0.12, 0.14, 0.18),
  })

  firstPage.drawText('Payment Summary', {
    x: 330,
    y: height - 170,
    size: 12,
    font: bold,
    color: rgb(0.12, 0.14, 0.18),
  })

  const leftLines = [
    { label: 'Investor Name', value: String(investor.name ?? '') },
    { label: 'Date of Issue', value: issueDate },
    { label: 'Investment Amount', value: formatCurrency(investmentAmount, String(investor.currency_code ?? 'NGN')) },
    { label: 'Mode of Payment', value: String(certificate.mode_of_payment ?? investor.investment_type ?? '') },
  ]

  const rightLines = [
    { label: 'Investment Tenure', value: `${investor.tenure ?? 0} months` },
    { label: 'Interest Rate', value: `${investor.percentage ?? 0}%` },
    { label: 'Calculated Interest Payment', value: formatCurrency(calculatedInterest, String(investor.currency_code ?? 'NGN')) },
  ]

  leftLines.forEach((line, index) => {
    const y = height - 192 - index * 28
    firstPage.drawText(`${line.label}:`, { x: 120, y, size: 11, font: bold, color: rgb(0.15, 0.15, 0.15) })
    firstPage.drawText(line.value, { x: 120, y: y - 12, size: 10.5, font, color: rgb(0.08, 0.08, 0.08) })
  })

  rightLines.forEach((line, index) => {
    const y = height - 192 - index * 28
    firstPage.drawText(`${line.label}:`, { x: 330, y, size: 11, font: bold, color: rgb(0.15, 0.15, 0.15) })
    firstPage.drawText(line.value, { x: 330, y: y - 12, size: 10.5, font, color: rgb(0.08, 0.08, 0.08) })
  })

  await drawSignatureIfPresent(pdfDoc, firstPage, certificate.investment_manager_signature_url as string | null, 120, 120, 'Investment Manager')
  await drawSignatureIfPresent(pdfDoc, firstPage, certificate.general_manager_signature_url as string | null, 300, 120, 'General Manager')
  if (certificate.ceo_approved_at) {
    firstPage.drawText('CEO Approved', { x: 460, y: 135, size: 11, font: bold, color: rgb(0.1, 0.5, 0.2) })
    await drawCeoSealIfAvailable(pdfDoc, firstPage, ceoSealBytes)
  }

  const pdfBytes = await pdfDoc.save()
  const storagePath = `generated/${investor.id}-${Date.now()}.pdf`
  const { error: uploadError } = await supabaseClient.storage
    .from(GENERATED_BUCKET)
    .upload(storagePath, pdfBytes, { contentType: 'application/pdf', upsert: true })

  if (uploadError) throw uploadError

  const { data: signedUrlData, error: signedUrlError } = await supabaseClient.storage
    .from(GENERATED_BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 24 * 7)

  if (signedUrlError) throw signedUrlError
  return { storagePath, signedUrl: signedUrlData.signedUrl }
}

async function drawSignatureIfPresent(
  pdfDoc: PDFDocument,
  page: ReturnType<PDFDocument['getPages']>[number],
  signatureUrl: string | null,
  x: number,
  y: number,
  label: string,
) {
  if (!signatureUrl) {
    page.drawText(`${label}: Pending`, { x, y, size: 10, color: rgb(0.5, 0.2, 0.2) })
    return
  }

  let bytes: Uint8Array | null = null
  let isPng = false

  if (signatureUrl.startsWith('data:image/')) {
    const [header, base64] = signatureUrl.split(',', 2)
    if (!base64) {
      page.drawText(`${label}: Pending`, { x, y, size: 10, color: rgb(0.5, 0.2, 0.2) })
      return
    }

    bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    isPng = header.includes('image/png')
  } else {
    const response = await fetch(signatureUrl)
    if (!response.ok) {
      page.drawText(`${label}: Pending`, { x, y, size: 10, color: rgb(0.5, 0.2, 0.2) })
      return
    }

    bytes = new Uint8Array(await response.arrayBuffer())
    const contentType = response.headers.get('content-type') ?? ''
    isPng = contentType.includes('png') || signatureUrl.toLowerCase().includes('.png')
  }

  if (!bytes?.length) {
    page.drawText(`${label}: Pending`, { x, y, size: 10, color: rgb(0.5, 0.2, 0.2) })
    return
  }

  const image = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes)
  page.drawImage(image, { x, y, width: 120, height: 40 })
  page.drawText(label, { x, y: y - 12, size: 9, color: rgb(0.2, 0.2, 0.2) })
}

async function loadCeoSealBytes() {
  const appUrl = Deno.env.get('PUBLIC_APP_URL')?.trim()
  if (!appUrl) {
    return null
  }

  try {
    const response = await fetch(new URL('/assets/zaradera-seal.png', appUrl).toString())
    if (!response.ok) {
      return null
    }

    return new Uint8Array(await response.arrayBuffer())
  } catch {
    return null
  }
}

async function drawCeoSealIfAvailable(
  pdfDoc: PDFDocument,
  page: ReturnType<PDFDocument['getPages']>[number],
  sealBytes: Uint8Array | null,
) {
  if (!sealBytes) {
    return
  }

  try {
    const seal = await pdfDoc.embedPng(sealBytes)
    page.drawImage(seal, {
      x: 444,
      y: 94,
      width: 92,
      height: 92,
    })
  } catch {
    // Leave the CEO seal area empty if the image cannot be decoded.
  }
}

async function updateGeneratedCertificate(
  supabaseClient: ReturnType<typeof createClient>,
  certificateId: string,
  storagePath: string,
) {
  const { data, error } = await supabaseClient
    .from('investor_certificates')
    .update({
      generated_storage_path: storagePath,
      last_generated_at: new Date().toISOString(),
    })
    .eq('id', certificateId)
    .select('*')
    .single()

  if (error) throw error
  await supabaseClient.from('investors').update({ investment_certificate_url: storagePath }).eq('id', data.investor_id as string)
  return data
}

async function getTemplateBytes(supabaseClient: ReturnType<typeof createClient>, template: TemplateRecord) {
  if (template.storage_path) {
    const { data: templateFile, error: downloadError } = await supabaseClient.storage
      .from(template.storage_bucket || TEMPLATE_BUCKET)
      .download(template.storage_path)

    if (!downloadError) return new Uint8Array(await templateFile.arrayBuffer())
  }

  if (!template.source_url) throw new Error('Certificate template could not be resolved.')

  const response = await fetch(template.source_url)
  if (!response.ok) throw new Error(`Failed to load bundled certificate template: ${response.status} ${response.statusText}`)
  return new Uint8Array(await response.arrayBuffer())
}

async function sendCertificateEmail(args: {
  recipientEmail: string
  recipientName: string
  certificateUrl: string
  investorName: string
  notificationType: string
  userId: string
  investorId: string
}) {
  if (!CERTIFICATE_EMAILS_ENABLED) {
    console.log('Certificate workflow email delivery skipped because CERTIFICATE_WORKFLOW_EMAILS_ENABLED is false')
    return
  }

  const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
    method: 'POST',
    headers: {
      apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: args.recipientEmail,
      subject: `Investment Certificate for ${args.investorName}`,
      html: `<p>Hello ${args.recipientName},</p><p>The investment certificate for <strong>${args.investorName}</strong> is ready.</p><p><a href="${args.certificateUrl}">Download Certificate</a></p>`,
      userId: args.userId,
      investorId: args.investorId,
      notificationType: args.notificationType,
    }),
  })

  if (!response.ok) console.error(`Failed to send certificate email: ${await response.text()}`)
}

async function sendApprovalNotifications(
  supabaseClient: ReturnType<typeof createClient>,
  roles: AppRole[],
  message: string,
  userId: string,
  investorId: string,
  notificationType: string,
) {
  const { data: users, error } = await supabaseClient
    .from('user_roles')
    .select('user_id, role, is_available_for_approvals')
    .in('role', roles)
    .eq('is_available_for_approvals', true)

  if (error) {
    console.error('Error fetching users for role:', error)
    return
  }

  const { data: authUsers, error: authError } = await supabaseClient.auth.admin.listUsers()
  if (authError) console.error('Error loading auth users for notifications:', authError)

  const emailByUserId = new Map((authUsers?.users ?? []).map((user) => [user.id, user.email]))

  for (const targetUser of users ?? []) {
    const email = emailByUserId.get(targetUser.user_id)
    if (!email) continue

    try {
      const emailResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
          apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: email,
          subject: 'Certificate Workflow Update',
          html: `<p>${message}</p><p>Please log in to continue the workflow.</p>`,
          userId,
          investorId,
          notificationType,
        }),
      })

      if (!emailResponse.ok) console.error('Certificate workflow email notification failed:', await emailResponse.text())
    } catch (emailError) {
      console.error('Certificate workflow email notification threw an error:', emailError)
    }
  }

  const notifications = (users ?? []).map((targetUser) => ({
    recipient_user_id: targetUser.user_id,
    target_role: targetUser.role as AppRole,
    title: 'Certificate Workflow Update',
    detail: message,
    notification_type: notificationType,
    related_investor_id: investorId,
    action_path: `/investors/${investorId}`,
  }))

  if (notifications.length) {
    await supabaseClient.from('dashboard_notifications').insert(notifications)
  }
}

function getSuccessMessage(action: CertificateAction) {
  switch (action) {
    case 'generate':
      return 'Certificate draft generated.'
    case 'approve_investment_manager':
      return 'Investment Manager final signature recorded and certificate sent to the investor.'
    case 'approve_general_manager':
      return 'General Manager signature recorded and certificate forwarded to the CEO.'
    case 'approve_ceo':
      return 'CEO approval recorded and certificate sent back to the Investment Manager for final signature.'
    case 'send_to_investor':
      return 'Investor delivery is automated after the Investment Manager final signature.'
  }
}

function formatCurrency(amount: number, currency: string) {
  if (currency === 'NGN') {
    // Use text format to avoid Unicode symbol issues in PDF
    return `NGN ${amount.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
  }
  return new Intl.NumberFormat(currency === 'NGN' ? 'en-NG' : 'en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount)
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
