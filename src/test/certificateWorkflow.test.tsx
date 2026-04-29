import { describe, it, expect } from 'vitest'
import { getCertificateActionUpdates, type CertificateAction, type AppRole } from '@/lib/certificateAction'

describe('getCertificateActionUpdates', () => {
  const now = '2026-03-27T12:00:00.000Z'
  const userId = 'user-1'

  it('applies generate action status correctly', () => {
    const updates = getCertificateActionUpdates({
      action: 'generate',
      certificate: { status: 'draft' },
      role: 'investment_manager',
      now,
      userId,
      issueDate: '2026-03-27',
    })
    expect(updates).toEqual({ status: 'draft', issue_date: '2026-03-27' })
  })

  it('requires investment manager signature on approval', () => {
    expect(() =>
      getCertificateActionUpdates({
        action: 'approve_investment_manager',
        certificate: { status: 'approved' },
        role: 'investment_manager',
        now,
        userId,
      }),
    ).toThrow('Investment Manager signature is required.')
  })

  it('moves through approval states correctly', () => {
    const gmUpdates = getCertificateActionUpdates({
      action: 'approve_general_manager',
      certificate: { status: 'draft' },
      role: 'general_manager',
      now,
      userId,
      uploadedSignatureUrl: 'https://example.com/sign-gm.png',
      issueDate: '2026-03-27',
    })
    expect(gmUpdates).toEqual({
      issue_date: '2026-03-27',
      general_manager_signature_url: 'https://example.com/sign-gm.png',
      general_manager_signed_at: now,
      status: 'pending_ceo',
    })

    const ceoUpdates = getCertificateActionUpdates({
      action: 'approve_ceo',
      certificate: { status: 'pending_ceo' },
      role: 'admin',
      now,
      userId,
    })
    expect(ceoUpdates).toEqual({
      ceo_approved_at: now,
      ceo_approved_by: userId,
      status: 'approved',
    })

    const imUpdates = getCertificateActionUpdates({
      action: 'approve_investment_manager',
      certificate: { status: 'approved' },
      role: 'investment_manager',
      now,
      userId,
      uploadedSignatureUrl: 'https://example.com/sign-im.png',
    })
    expect(imUpdates).toEqual({
      investment_manager_signature_url: 'https://example.com/sign-im.png',
      investment_manager_signed_at: now,
      sent_at: now,
      sent_by: userId,
      status: 'sent',
    })

    const sendUpdates = getCertificateActionUpdates({
      action: 'send_to_investor',
      certificate: { status: 'sent' },
      role: 'investment_manager',
      now,
      userId,
    })
    expect(sendUpdates).toEqual({ status: 'sent' })
  })

  it('blocks non-CEO approval on pending_ceo state', () => {
    expect(() =>
      getCertificateActionUpdates({
        action: 'approve_ceo',
        certificate: { status: 'pending_general_manager' },
        role: 'general_manager',
        now,
        userId,
      }),
    ).toThrow('CEO approval can only happen after General Manager approval.')
  })
})
