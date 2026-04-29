import { corsHeaders } from '../_shared/cors.ts'
import {
  requireAuthenticatedUser,
  sendFinalCertificate,
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
    const { user, serviceClient } = await requireAuthenticatedUser(authorization, ['investment_manager', 'super_admin'])
    const payload = await req.json() as { certificateId?: string }

    if (!payload.certificateId) {
      throw new Error('certificateId is required.')
    }

    const certificate = await sendFinalCertificate(serviceClient, user.id, payload.certificateId)
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
