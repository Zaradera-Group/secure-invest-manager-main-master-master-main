import { createClient } from 'npm:@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'
import { type CertificateAction } from '../_shared/certificateAction.ts'
import { processCertificateWorkflow } from '../_shared/certificateWorkflow.ts'

interface CertificateRequest {
  investorId: string
  action: CertificateAction
  signatureDataUrl?: string
  notes?: string
  issueDate?: string
  requestedByUserId?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const requestOrigin = req.headers.get('Origin') ?? Deno.env.get('PUBLIC_APP_URL') ?? ''
    const internalRequest = req.headers.get('x-internal-certificate-request') === 'true'
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      serviceRoleKey,
      { global: { headers: { Authorization: authHeader } } },
    )

    const { investorId, action, signatureDataUrl, notes, issueDate, requestedByUserId }: CertificateRequest = await req.json()
    if (!investorId || !action) {
      return jsonResponse({ error: 'Investor and action are required.' }, 400)
    }

    let actingUserId = requestedByUserId ?? null
    let actingUserEmail: string | null = null

    if (internalRequest && authHeader === `Bearer ${serviceRoleKey}` && requestedByUserId) {
      actingUserEmail = await getAuthUserEmail(supabaseClient, requestedByUserId)
    } else {
      const {
        data: { user },
        error: userError,
      } = await supabaseClient.auth.getUser()

      if (userError || !user) {
        return jsonResponse({ error: 'Unauthorized' }, 401)
      }

      actingUserId = user.id
      actingUserEmail = user.email ?? null
    }

    if (!actingUserId) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    const result = await processCertificateWorkflow({
      supabaseClient,
      investorId,
      action,
      requestedByUserId: actingUserId,
      issueDate,
      notes,
      signatureDataUrl,
      requestOrigin,
    })
    return jsonResponse(result)
  } catch (error) {
    console.error('manage-investor-certificates error', error)
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})

async function getAuthUserEmail(supabaseClient: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await supabaseClient.auth.admin.getUserById(userId)
  if (error) throw error
  return data.user.email ?? null
}
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
