export type CertificateAction =
  | 'generate'
  | 'approve_investment_manager'
  | 'approve_general_manager'
  | 'approve_ceo'
  | 'send_to_investor'

export type AppRole =
  | 'super_admin'
  | 'admin'
  | 'staff'
  | 'investment_manager'
  | 'general_manager'
  | 'software_engineer'

export function getCertificateActionUpdates(args: {
  action: CertificateAction
  certificate: Record<string, unknown>
  role: AppRole
  now: string
  userId: string
  uploadedSignatureUrl?: string | null
  issueDate?: string
}) {
  const { action, certificate, now, userId, uploadedSignatureUrl, issueDate } = args
  const updates: Record<string, unknown> = {}

  if (issueDate) {
    updates.issue_date = issueDate
  }

  switch (action) {
    case 'generate':
      updates.status = 'draft'
      break

    case 'approve_investment_manager':
      if (certificate.status !== 'approved') {
        throw new Error('Investment Manager final signature can only happen after CEO approval.')
      }
      if (!uploadedSignatureUrl) throw new Error('Investment Manager signature is required.')
      updates.investment_manager_signature_url = uploadedSignatureUrl
      updates.investment_manager_signed_at = now
      updates.sent_at = now
      updates.sent_by = userId
      updates.status = 'sent'
      break

    case 'approve_general_manager':
      if (certificate.status !== 'draft' && certificate.status !== 'rejected') {
        throw new Error('General Manager approval can only happen after Investment Manager submits investor details.')
      }
      if (!uploadedSignatureUrl) throw new Error('General Manager signature is required.')
      updates.general_manager_signature_url = uploadedSignatureUrl
      updates.general_manager_signed_at = now
      updates.status = 'pending_ceo'
      break

    case 'approve_ceo':
      if (certificate.status !== 'pending_ceo') {
        throw new Error('CEO approval can only happen after General Manager approval.')
      }
      updates.ceo_approved_at = now
      updates.ceo_approved_by = userId
      updates.status = 'approved'
      break

    case 'send_to_investor':
      if (certificate.status !== 'sent') {
        throw new Error('Certificate is only emailed automatically after the Investment Manager final signature.')
      }
      updates.status = 'sent'
      break

    default:
      throw new Error('Unknown certificate action.')
  }

  return updates
}
