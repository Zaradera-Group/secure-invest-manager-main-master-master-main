import { createClient } from 'npm:@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'
import { processCertificateWorkflow } from '../_shared/certificateWorkflow.ts'

type CertificateRequestRow = {
  id: string
  investor_id: string
  action: 'generate' | 'approve_investment_manager' | 'approve_general_manager' | 'approve_ceo' | 'send_to_investor'
  issue_date: string | null
  signature_data_url: string | null
  notes: string | null
  requested_by: string
  requested_role: string
  attempts: number
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabaseClient = createClient(supabaseUrl, serviceRoleKey)
    const { batchSize = 10 } = await parseRequestBody(req)

    const { data: pendingRows, error: fetchError } = await supabaseClient
      .from('certificate_workflow_requests')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(batchSize)

    if (fetchError) throw fetchError

    const requests = (pendingRows ?? []) as CertificateRequestRow[]
    const results: Array<{ id: string; status: string; error?: string }> = []

    for (const requestRow of requests) {
      const claimed = await markAsProcessing(supabaseClient, requestRow.id, requestRow.attempts + 1)
      if (!claimed) continue

      try {
        const responseData = await processCertificateWorkflow({
          supabaseClient,
          investorId: requestRow.investor_id,
          action: requestRow.action,
          issueDate: requestRow.issue_date ?? undefined,
          signatureDataUrl: requestRow.signature_data_url ?? undefined,
          notes: requestRow.notes ?? undefined,
          requestedByUserId: requestRow.requested_by,
        })

        const { error: completeError } = await supabaseClient
          .from('certificate_workflow_requests')
          .update({
            status: 'completed',
            processed_at: new Date().toISOString(),
            locked_at: null,
            last_error: null,
            result: responseData,
          })
          .eq('id', requestRow.id)

        if (completeError) throw completeError
        results.push({ id: requestRow.id, status: 'completed' })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('Failed to process certificate workflow request', requestRow.id, errorMessage)

        await supabaseClient
          .from('certificate_workflow_requests')
          .update({
            status: 'failed',
            processed_at: new Date().toISOString(),
            locked_at: null,
            last_error: errorMessage,
          })
          .eq('id', requestRow.id)

        results.push({ id: requestRow.id, status: 'failed', error: errorMessage })
      }
    }

    return new Response(JSON.stringify({ message: `Processed ${results.length} certificate requests`, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    console.error('process-certificate-requests error', error)
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})

async function parseRequestBody(req: Request): Promise<{ batchSize?: number }> {
  if (req.method !== 'POST') return {}

  try {
    return await req.json()
  } catch {
    return {}
  }
}

async function markAsProcessing(
  supabaseClient: ReturnType<typeof createClient>,
  requestId: string,
  attempts: number,
) {
  const { data, error } = await supabaseClient
    .from('certificate_workflow_requests')
    .update({
      status: 'processing',
      locked_at: new Date().toISOString(),
      attempts,
      last_error: null,
    })
    .eq('id', requestId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (error) throw error
  return !!data
}
