export type CertificateEmailPayload = {
  to: string
  subject: string
  html: string
}

export async function sendResendEmail(payload: CertificateEmailPayload) {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Zaradera Credit Limited <noreply@zaraderacredit.com>'

  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured.')
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
    }),
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Resend API error: ${response.status} ${text}`)
  }

  return text
}
