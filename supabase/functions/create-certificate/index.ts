import { corsHeaders } from '../_shared/cors.ts'
import {
  createCertificateRecord,
  requireAuthenticatedUser,
  type CreateCertificateInput,
} from '../_shared/certificateSystem.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405)
    }

    const authorization = req.headers.get('Authorization') ?? ''
    const { user, serviceClient } = await requireAuthenticatedUser(authorization, ['investment_manager', 'investor'])
    const payload = await req.json() as CreateCertificateInput
    const certificate = await createCertificateRecord(serviceClient, user.id, payload)

    return jsonResponse({ data: certificate }, 200)
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 400)
  }
})

function jsonResponse(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error'
}
