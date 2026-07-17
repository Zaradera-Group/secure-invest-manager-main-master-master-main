import { createClient } from 'npm:@supabase/supabase-js'
import { buildCertificatePdf } from './certificatePdf.ts'
import { sendResendEmail } from './certificateEmail.ts'

export type CertificateStatus = 'pending_manager' | 'pending_general_manager' | 'pending_ceo' | 'approved' | 'sent'
export type WorkflowRole = 'investment_manager' | 'accountant' | 'general_manager' | 'super_admin' | 'investor'

export type CertificateRecord = {
  id: string
  investor_id?: string | null
  investor_name: string
  investor_email: string
  amount: number
  interest_rate: number
  issue_date?: string | null
  status: CertificateStatus
  manager_signature: string | null
  general_manager_signature: string | null
  ceo_signature: string | null
  certificate_url: string | null
  created_by: string | null
  manager_reviewed_by: string | null
  general_manager_reviewed_by: string | null
  ceo_approved_by: string | null
  sent_by: string | null
  created_at: string
  updated_at: string
  manager_notified_at: string | null
  general_manager_notified_at: string | null
  ceo_notified_at: string | null
  approved_at: string | null
  sent_at: string | null
}

export type CreateCertificateInput = {
  investor_name: string
  investor_email: string
  amount: number
  interest_rate: number
}

export type ApprovalInput = {
  certificateId: string
  signature?: string | null
}

export function createServiceClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return createClient(supabaseUrl, serviceRoleKey)
}

export function createUserClient(authorization: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  return createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: authorization,
      },
    },
  })
}

export async function requireAuthenticatedUser(
  authorization: string,
  expectedRoles: WorkflowRole[],
) {
  if (!authorization) {
    throw new Error('Missing authorization header.')
  }

  const userClient = createUserClient(authorization)
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError) throw authError
  if (!authData.user) throw new Error('Unauthorized')

  const serviceClient = createServiceClient()
  const { data: roleRow, error: roleError } = await serviceClient
    .from('user_roles')
    .select('role')
    .eq('user_id', authData.user.id)
    .limit(1)
    .maybeSingle()

  if (roleError) throw roleError

  const role = (roleRow?.role ?? 'investor') as WorkflowRole
  if (!expectedRoles.includes(role)) {
    throw new Error('Forbidden')
  }

  return {
    user: authData.user,
    role,
    serviceClient,
  }
}

export async function createCertificateRecord(
  serviceClient: ReturnType<typeof createClient>,
  createdBy: string,
  input: CreateCertificateInput,
) {
  validateCreateInput(input)

  const { data, error } = await serviceClient
    .from('certificates')
    .insert({
      investor_name: input.investor_name.trim(),
      investor_email: input.investor_email.trim().toLowerCase(),
      amount: input.amount,
      interest_rate: input.interest_rate,
      status: 'pending_manager',
      created_by: createdBy,
    })
    .select('*')
    .single()

  if (error || !data) throw error ?? new Error('Failed to create certificate.')

  const certificate = data as CertificateRecord
  const certificateUrl = await regenerateAndPersistCertificate(serviceClient, certificate)

  await notifyRole(serviceClient, {
    role: 'investment_manager',
    notificationRole: 'manager',
    title: 'Certificate awaiting manager review',
    detail: `Review and sign the certificate for ${certificate.investor_name}.`,
    notificationType: 'certificate_pending_manager',
    certificateId: certificate.id,
    certificateUrl,
    emailSubject: 'Certificate pending manager review',
    emailHtml: buildWorkflowEmailHtml({
      headline: 'Certificate review required',
      recipientLabel: 'Manager',
      body: `${certificate.investor_name}'s certificate is ready for review and signature.`,
      certificateUrl,
    }),
  })

  await updateNotificationTimestamp(serviceClient, certificate.id, 'manager_notified_at')

  return await getCertificateById(serviceClient, certificate.id)
}

export async function approveByManager(
  serviceClient: ReturnType<typeof createClient>,
  approverId: string,
  input: ApprovalInput,
) {
  const certificate = await getCertificateById(serviceClient, input.certificateId)
  if (certificate.status !== 'pending_manager') {
    throw new Error('Certificate is not awaiting manager approval.')
  }

  const signatureUrl = await normalizeSignature(serviceClient, input.signature ?? null, certificate.id, 'manager')
  if (!signatureUrl) {
    throw new Error('Manager signature is required.')
  }

  const { data, error } = await serviceClient
    .from('certificates')
    .update({
      manager_signature: signatureUrl,
      manager_reviewed_by: approverId,
      status: 'pending_general_manager',
    })
    .eq('id', certificate.id)
    .select('*')
    .single()

  if (error || !data) throw error ?? new Error('Failed to update manager approval.')

  const updated = data as CertificateRecord
  const certificateUrl = await regenerateAndPersistCertificate(serviceClient, updated)

  await notifyRole(serviceClient, {
    role: 'general_manager',
    notificationRole: 'general_manager',
    title: 'Certificate awaiting General Manager review',
    detail: `Review and sign the certificate for ${updated.investor_name}.`,
    notificationType: 'certificate_pending_general_manager',
    certificateId: updated.id,
    certificateUrl,
    emailSubject: 'Certificate pending General Manager approval',
    emailHtml: buildWorkflowEmailHtml({
      headline: 'General Manager approval required',
      recipientLabel: 'General Manager',
      body: `${updated.investor_name}'s certificate has been signed by the manager and is awaiting your approval.`,
      certificateUrl,
    }),
  })

  await updateNotificationTimestamp(serviceClient, updated.id, 'general_manager_notified_at')

  return await getCertificateById(serviceClient, updated.id)
}

export async function approveByGeneralManager(
  serviceClient: ReturnType<typeof createClient>,
  approverId: string,
  input: ApprovalInput,
) {
  const certificate = await getCertificateById(serviceClient, input.certificateId)
  if (certificate.status !== 'pending_general_manager') {
    throw new Error('Certificate is not awaiting General Manager approval.')
  }

  const signatureUrl = await normalizeSignature(serviceClient, input.signature ?? null, certificate.id, 'general-manager')
  if (!signatureUrl) {
    throw new Error('General Manager signature is required.')
  }

  const { data, error } = await serviceClient
    .from('certificates')
    .update({
      general_manager_signature: signatureUrl,
      general_manager_reviewed_by: approverId,
      status: 'pending_ceo',
    })
    .eq('id', certificate.id)
    .select('*')
    .single()

  if (error || !data) throw error ?? new Error('Failed to update General Manager approval.')

  const updated = data as CertificateRecord
  const certificateUrl = await regenerateAndPersistCertificate(serviceClient, updated)

  await notifyRole(serviceClient, {
    role: 'super_admin',
    notificationRole: 'ceo',
    title: 'Certificate awaiting CEO approval',
    detail: `Approve the certificate for ${updated.investor_name}.`,
    notificationType: 'certificate_pending_ceo',
    certificateId: updated.id,
    certificateUrl,
    emailSubject: 'Certificate pending CEO approval',
    emailHtml: buildWorkflowEmailHtml({
      headline: 'CEO approval required',
      recipientLabel: 'CEO',
      body: `${updated.investor_name}'s certificate has completed manager reviews and is awaiting final approval.`,
      certificateUrl,
    }),
  })

  await updateNotificationTimestamp(serviceClient, updated.id, 'ceo_notified_at')

  return await getCertificateById(serviceClient, updated.id)
}

export async function approveByCeo(
  serviceClient: ReturnType<typeof createClient>,
  approverId: string,
  input: ApprovalInput,
) {
  const certificate = await getCertificateById(serviceClient, input.certificateId)
  if (certificate.status !== 'pending_ceo') {
    throw new Error('Certificate is not awaiting CEO approval.')
  }

  const signatureUrl = await normalizeSignature(serviceClient, input.signature ?? null, certificate.id, 'ceo')

  const { data, error } = await serviceClient
    .from('certificates')
    .update({
      ceo_signature: signatureUrl,
      ceo_approved_by: approverId,
      status: 'approved',
      approved_at: new Date().toISOString(),
    })
    .eq('id', certificate.id)
    .select('*')
    .single()

  if (error || !data) throw error ?? new Error('Failed to update CEO approval.')

  const updated = data as CertificateRecord
  await regenerateAndPersistCertificate(serviceClient, updated)

  return await sendFinalCertificate(serviceClient, approverId, updated.id)
}

export async function sendFinalCertificate(
  serviceClient: ReturnType<typeof createClient>,
  senderId: string,
  certificateId: string,
) {
  const certificate = await getCertificateById(serviceClient, certificateId)
  if (!['approved', 'sent'].includes(certificate.status)) {
    throw new Error('Certificate must be approved before final delivery.')
  }

  const certificateUrl = await regenerateAndPersistCertificate(serviceClient, certificate)
  const downloadLink = await createSignedCertificateLink(serviceClient, certificateUrl)
  await sendResendEmail({
    to: certificate.investor_email,
    subject: 'Your final investment certificate',
    html: buildWorkflowEmailHtml({
      headline: 'Your investment certificate is ready',
      recipientLabel: certificate.investor_name,
      body: 'Your certificate has completed the approval workflow and is now available for download.',
      certificateUrl: downloadLink,
    }),
  })

  await serviceClient.from('notifications').insert({
    user_role: 'investor',
    message: `Your certificate for ${certificate.investor_name} is ready.`,
    certificate_id: certificate.id,
    recipient_email: certificate.investor_email,
  })

  const { data, error } = await serviceClient
    .from('certificates')
    .update({
      status: 'sent',
      certificate_url: certificateUrl,
      sent_by: senderId,
      sent_at: new Date().toISOString(),
    })
    .eq('id', certificate.id)
    .select('*')
    .single()

  if (error || !data) throw error ?? new Error('Failed to mark certificate as sent.')
  return data as CertificateRecord
}

export async function getCertificateById(
  serviceClient: ReturnType<typeof createClient>,
  certificateId: string,
) {
  const { data, error } = await serviceClient
    .from('certificates')
    .select('*')
    .eq('id', certificateId)
    .single()

  if (error || !data) throw error ?? new Error('Certificate not found.')
  return data as CertificateRecord
}

async function getFreshInvestorSnapshot(
  serviceClient: ReturnType<typeof createClient>,
  certificate: CertificateRecord,
) {
  let query = serviceClient
    .from('investors')
    .select('name, email, investment_amount, percentage, currency_code')

  if (certificate.investor_id) {
    query = query.eq('id', certificate.investor_id)
  } else {
    query = query
      .eq('email', certificate.investor_email.trim().toLowerCase())
      .eq('name', certificate.investor_name)
  }

  const { data, error } = await query.maybeSingle()
  if (error) throw error

  return {
    investorName: String(data?.name ?? certificate.investor_name),
    investorEmail: String(data?.email ?? certificate.investor_email),
    amount: Number(data?.investment_amount ?? certificate.amount ?? 0),
    interestRate: Number(data?.percentage ?? certificate.interest_rate ?? 0),
  }
}

async function regenerateAndPersistCertificate(
  serviceClient: ReturnType<typeof createClient>,
  certificate: CertificateRecord,
) {
  const freshInvestor = await getFreshInvestorSnapshot(serviceClient, certificate)
  const pdfBytes = await buildCertificatePdf({
    investorName: freshInvestor.investorName,
    investorEmail: freshInvestor.investorEmail,
    amount: freshInvestor.amount,
    interestRate: freshInvestor.interestRate,
    issueDate: certificate.issue_date ?? certificate.approved_at ?? certificate.created_at,
    statusLabel: humanizeStatus(certificate.status),
    managerSignature: certificate.manager_signature,
    generalManagerSignature: certificate.general_manager_signature,
    ceoSignature: certificate.ceo_signature,
  })

  const path = `certificates/${certificate.id}.pdf`
  const { error: uploadError } = await serviceClient.storage
    .from('certificates')
    .upload(path, pdfBytes, {
      contentType: 'application/pdf',
      upsert: true,
    })

  if (uploadError) throw uploadError

  const { data: urlData } = serviceClient.storage.from('certificates').getPublicUrl(path)
  const certificateUrl = urlData.publicUrl

  const { error: updateError } = await serviceClient
    .from('certificates')
    .update({
      certificate_url: certificateUrl,
    })
    .eq('id', certificate.id)

  if (updateError) throw updateError
  return certificateUrl
}

async function createSignedCertificateLink(
  serviceClient: ReturnType<typeof createClient>,
  certificateUrl: string,
) {
  const storagePath = extractStoragePath(certificateUrl)
  if (!storagePath) {
    throw new Error('Failed to resolve the certificate download path.')
  }

  const { data, error } = await serviceClient.storage
    .from('certificates')
    .createSignedUrl(storagePath, 60 * 60 * 24 * 7)

  if (error || !data?.signedUrl) {
    throw error ?? new Error('Failed to create certificate download link.')
  }

  return data.signedUrl
}

function extractStoragePath(value: string) {
  const normalized = value.trim()
  if (!normalized) return null

  if (!normalized.includes('/storage/v1/object/')) {
    return normalized
  }

  const publicMatch = normalized.match(/\/storage\/v1\/object\/public\/[^/]+\/(.+)$/)
  if (publicMatch?.[1]) {
    return decodeURIComponent(publicMatch[1])
  }

  const signedMatch = normalized.match(/\/storage\/v1\/object\/sign\/[^/]+\/(.+)$/)
  if (signedMatch?.[1]) {
    return decodeURIComponent(signedMatch[1])
  }

  return null
}

async function notifyRole(
  serviceClient: ReturnType<typeof createClient>,
  args: {
    role: 'investment_manager' | 'accountant' | 'general_manager' | 'super_admin'
    notificationRole: 'manager' | 'general_manager' | 'ceo'
    title: string
    detail: string
    notificationType: string
    certificateId: string
    certificateUrl: string
    emailSubject: string
    emailHtml: string
  },
) {
  const { data: roleRow, error: roleError } = await serviceClient
    .from('user_roles')
    .select('user_id')
    .eq('role', args.role)
    .limit(1)
    .maybeSingle()

  if (roleError) throw roleError
  if (!roleRow?.user_id) {
    throw new Error(`No active user found for role ${args.role}.`)
  }

  const { data: userData, error: userError } = await serviceClient.auth.admin.getUserById(roleRow.user_id)
  if (userError) throw userError
  if (!userData.user.email) {
    throw new Error(`Role ${args.role} does not have a valid email address.`)
  }

  const { error: notificationError } = await serviceClient
    .from('notifications')
    .insert({
      user_role: args.notificationRole,
      title: args.title,
      detail: args.detail,
      message: args.detail, // keep for backward compatibility
      certificate_id: args.certificateId,
      recipient_user_id: roleRow.user_id,
      action_path: '/certificates',
    })

  if (notificationError) throw notificationError

  await sendResendEmail({
    to: userData.user.email,
    subject: args.emailSubject,
    html: args.emailHtml,
  })
}

async function updateNotificationTimestamp(
  serviceClient: ReturnType<typeof createClient>,
  certificateId: string,
  field: 'manager_notified_at' | 'general_manager_notified_at' | 'ceo_notified_at',
) {
  const { error } = await serviceClient
    .from('certificates')
    .update({
      [field]: new Date().toISOString(),
    })
    .eq('id', certificateId)

  if (error) throw error
}

async function normalizeSignature(
  serviceClient: ReturnType<typeof createClient>,
  signature: string | null,
  certificateId: string,
  role: 'manager' | 'general-manager' | 'ceo',
) {
  if (!signature) return null

  if (signature.startsWith('http://') || signature.startsWith('https://')) {
    return signature
  }

  const normalized = signature.startsWith('data:image/')
    ? signature
    : `data:image/png;base64,${signature}`

  const [header, base64] = normalized.split(',', 2)
  if (!base64 || !header.startsWith('data:image/')) {
    throw new Error('Invalid signature format.')
  }

  const contentType = header.substring(5, header.indexOf(';'))
  const extension = contentType.includes('png') ? 'png' : 'jpg'
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  const path = `${role}/${certificateId}-${Date.now()}.${extension}`

  const { error } = await serviceClient.storage
    .from('certificate-signatures')
    .upload(path, bytes, {
      contentType,
      upsert: true,
    })

  if (error) throw error

  // Persist the renderable signature payload so PDF regeneration does not depend on an expiring signed URL.
  return normalized
}

function validateCreateInput(input: CreateCertificateInput) {
  if (!input.investor_name?.trim()) {
    throw new Error('Investor name is required.')
  }
  if (!input.investor_email?.trim()) {
    throw new Error('Investor email is required.')
  }
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    throw new Error('Amount must be a valid positive number.')
  }
  if (!Number.isFinite(input.interest_rate) || input.interest_rate < 0) {
    throw new Error('Interest rate must be a valid positive number.')
  }
}

function humanizeStatus(status: CertificateStatus) {
  switch (status) {
    case 'pending_manager':
      return 'Pending Manager Approval'
    case 'pending_general_manager':
      return 'Pending General Manager Approval'
    case 'pending_ceo':
      return 'Pending CEO Approval'
    case 'approved':
      return 'Approved'
    case 'sent':
      return 'Sent to Investor'
  }
}

function buildWorkflowEmailHtml(args: {
  headline: string
  recipientLabel: string
  body: string
  certificateUrl: string
}) {
  return `
    <div style="font-family: Arial, sans-serif; color: #1a1a1a; line-height: 1.6;">
      <h2>${args.headline}</h2>
      <p>Dear ${args.recipientLabel},</p>
      <p>${args.body}</p>
      <p>
        <a href="${args.certificateUrl}" target="_blank" rel="noreferrer" style="display:inline-block;padding:12px 20px;background:#0f4c81;color:#fff;text-decoration:none;border-radius:6px;">
          Open Certificate
        </a>
      </p>
      <p>If the button does not open automatically, use this link: <a href="${args.certificateUrl}">${args.certificateUrl}</a></p>
      <p>Regards,<br />Zaradera Credit Limited</p>
    </div>
  `
}
