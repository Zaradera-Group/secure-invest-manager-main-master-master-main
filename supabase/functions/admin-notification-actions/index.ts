import { createClient } from 'npm:@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'

type AdminAction =
  | 'retry_failed_jobs'
  | 'process_queue_now'
  | 'queue_reminders_now'
  | 'retry_single_job'
  | 'retry_selected_jobs'
  | 'cancel_single_job'
  | 'cancel_selected_jobs'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const authorization = req.headers.get('Authorization') ?? ''

    const authClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: { Authorization: authorization },
      },
    })

    const { data: { user } } = await authClient.auth.getUser()
    if (!user) {
      throw new Error('Unauthorized')
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey)
    const { data: adminRole, error: roleError } = await serviceClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle()

    if (roleError) throw roleError
    if (!adminRole) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 403,
        }
      )
    }

    const body = await req.json()
    const action = body.action as AdminAction

    if (action === 'retry_failed_jobs') {
      const { data, error } = await serviceClient
        .from('notification_jobs')
        .update({
          status: 'pending',
          scheduled_for: new Date().toISOString(),
          locked_at: null,
          processed_at: null,
          last_error: null,
        })
        .eq('status', 'failed')
        .select('id')

      if (error) throw error

      return jsonResponse({
        message: `Requeued ${data?.length ?? 0} failed jobs`,
        affectedJobs: data?.length ?? 0,
      })
    }

    if (action === 'retry_single_job') {
      const jobId = typeof body.jobId === 'string' ? body.jobId : ''
      if (!jobId) {
        return jsonResponse({ error: 'jobId is required' }, 400)
      }

      const { data, error } = await serviceClient
        .from('notification_jobs')
        .update({
          status: 'pending',
          scheduled_for: new Date().toISOString(),
          locked_at: null,
          processed_at: null,
          last_error: null,
        })
        .eq('id', jobId)
        .select('id')

      if (error) throw error

      return jsonResponse({
        message: `Requeued job ${jobId}`,
        affectedJobs: data?.length ?? 0,
      })
    }

    if (action === 'retry_selected_jobs') {
      const jobIds = normalizeJobIds(body.jobIds)
      if (jobIds.length === 0) {
        return jsonResponse({ error: 'jobIds is required' }, 400)
      }

      const { data, error } = await serviceClient
        .from('notification_jobs')
        .update({
          status: 'pending',
          scheduled_for: new Date().toISOString(),
          locked_at: null,
          processed_at: null,
          last_error: null,
        })
        .in('id', jobIds)
        .select('id')

      if (error) throw error

      return jsonResponse({
        message: `Requeued ${data?.length ?? 0} selected jobs`,
        affectedJobs: data?.length ?? 0,
      })
    }

    if (action === 'cancel_single_job') {
      const jobId = typeof body.jobId === 'string' ? body.jobId : ''
      if (!jobId) {
        return jsonResponse({ error: 'jobId is required' }, 400)
      }

      const { data, error } = await serviceClient
        .from('notification_jobs')
        .update({
          status: 'cancelled',
          locked_at: null,
          processed_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', jobId)
        .in('status', ['pending', 'failed', 'processing'])
        .select('id')

      if (error) throw error

      return jsonResponse({
        message: `Cancelled job ${jobId}`,
        affectedJobs: data?.length ?? 0,
      })
    }

    if (action === 'cancel_selected_jobs') {
      const jobIds = normalizeJobIds(body.jobIds)
      if (jobIds.length === 0) {
        return jsonResponse({ error: 'jobIds is required' }, 400)
      }

      const { data, error } = await serviceClient
        .from('notification_jobs')
        .update({
          status: 'cancelled',
          locked_at: null,
          processed_at: new Date().toISOString(),
          last_error: null,
        })
        .in('id', jobIds)
        .in('status', ['pending', 'failed', 'processing'])
        .select('id')

      if (error) throw error

      return jsonResponse({
        message: `Cancelled ${data?.length ?? 0} selected jobs`,
        affectedJobs: data?.length ?? 0,
      })
    }

    if (action === 'process_queue_now') {
      const batchSize = typeof body.batchSize === 'number' ? body.batchSize : 50

      const response = await fetch(`${supabaseUrl}/functions/v1/process-notification-jobs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ batchSize }),
      })

      const responseText = await response.text()
      if (!response.ok) {
        throw new Error(responseText)
      }

      return new Response(responseText, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    if (action === 'queue_reminders_now') {
      const queueSummary = {
        payment: await invokeRpc(serviceClient, 'enqueue_payment_reminder_jobs'),
        maturity: await invokeRpc(serviceClient, 'enqueue_maturity_reminder_jobs'),
        birthday: await invokeRpc(serviceClient, 'enqueue_birthday_notification_jobs'),
        monthly: await invokeRpc(serviceClient, 'enqueue_monthly_report_jobs'),
      }

      return jsonResponse({
        message: 'Queued notification jobs successfully',
        queueSummary,
      })
    }

    return jsonResponse({ error: 'Unsupported action' }, 400)
  } catch (error) {
    console.error('Error running admin notification action:', error)
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})

async function invokeRpc(
  supabaseClient: ReturnType<typeof createClient>,
  functionName: string
) {
  const { data, error } = await supabaseClient.rpc(functionName)
  if (error) throw error
  return data ?? 0
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

function normalizeJobIds(jobIds: unknown): string[] {
  if (!Array.isArray(jobIds)) return []
  return jobIds.filter((jobId): jobId is string => typeof jobId === 'string' && jobId.length > 0)
}
