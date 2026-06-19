import { createClient } from 'npm:@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'

const DAY_IN_MS = 24 * 60 * 60 * 1000
const TWILIO_API_BASE_URL = 'https://api.twilio.com/2010-04-01'

type NotificationJob = {
  id: string
  notification_type: string
  user_id: string | null
  investor_id: string | null
  payload: Record<string, unknown>
}

type ReminderRecipient = {
  userId: string
  email: string | null
  phone: string | null
  role: 'investment_manager' | 'super_admin'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabaseClient = createClient(supabaseUrl, serviceRoleKey)

    const { batchSize = 50 } = await parseRequestBody(req)
    const runRecord = await createJobRunRecord(supabaseClient, batchSize)
    const jobs = await claimPendingJobs(supabaseClient, batchSize)

    const results: Array<{
      id: string
      status: string
      notificationType: string
      recipient: string | null
      error?: string
    }> = []

    for (const job of jobs) {
      const result = await processJob(supabaseUrl, serviceRoleKey, supabaseClient, job)
      results.push({
        id: job.id,
        status: result.status,
        notificationType: job.notification_type,
        recipient: result.recipient,
        error: result.error,
      })
    }

    const completedCount = results.filter((result) => result.status === 'completed').length
    const failedCount = results.filter((result) => result.status === 'failed').length

    await finalizeJobRunRecord(supabaseClient, runRecord.id, {
      status: failedCount > 0 ? (completedCount > 0 ? 'partial' : 'failed') : 'completed',
      jobsClaimed: jobs.length,
      jobsCompleted: completedCount,
      jobsFailed: failedCount,
      metadata: {
        results,
        summary: buildRunSummary(results),
      },
    })

    return new Response(
      JSON.stringify({
        message: `Processed ${results.length} notification jobs`,
        results,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('Error processing notification jobs:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})

async function createJobRunRecord(
  supabaseClient: ReturnType<typeof createClient>,
  batchSize: number
) {
  const { data, error } = await supabaseClient
    .from('job_runs')
    .insert({
      worker_name: 'process-notification-jobs',
      status: 'running',
      batch_size: batchSize,
    })
    .select('id')
    .single()

  if (error) throw error
  return data
}

async function finalizeJobRunRecord(
  supabaseClient: ReturnType<typeof createClient>,
  runId: string,
  payload: {
    status: 'completed' | 'failed' | 'partial'
    jobsClaimed: number
    jobsCompleted: number
    jobsFailed: number
    metadata: Record<string, unknown>
  }
) {
  const { error } = await supabaseClient
    .from('job_runs')
    .update({
      status: payload.status,
      jobs_claimed: payload.jobsClaimed,
      jobs_completed: payload.jobsCompleted,
      jobs_failed: payload.jobsFailed,
      completed_at: new Date().toISOString(),
      metadata: payload.metadata,
    })
    .eq('id', runId)

  if (error) throw error
}

async function parseRequestBody(req: Request): Promise<{ batchSize?: number }> {
  if (req.method !== 'POST') {
    return {}
  }

  try {
    return await req.json()
  } catch {
    return {}
  }
}

async function claimPendingJobs(
  supabaseClient: ReturnType<typeof createClient>,
  batchSize: number
): Promise<NotificationJob[]> {
  const { error: staleError } = await supabaseClient.rpc('requeue_stale_notification_jobs', {
    stale_after_minutes: 15,
  })
  if (staleError) throw staleError

  const { data: claimedJobs, error: claimError } = await supabaseClient.rpc('claim_notification_jobs', {
    batch_size: batchSize,
  })

  if (claimError) throw claimError

  return (claimedJobs ?? []).map((job) => ({
    id: job.id,
    notification_type: job.notification_type,
    user_id: job.user_id,
    investor_id: job.investor_id,
    payload: (job.payload ?? {}) as Record<string, unknown>,
  }))
}

async function processJob(
  supabaseUrl: string,
  serviceRoleKey: string,
  supabaseClient: ReturnType<typeof createClient>,
  job: NotificationJob
) {
  try {
    const payload = job.payload ?? {}
    let recipientEmail = readString(payload.email)

    let subject = ''
    let html = ''
    let metadata: Record<string, unknown> = {}
    let recipients: ReminderRecipient[] = []

    if (job.notification_type === 'payment_reminder') {
      const investmentType = readString(payload.investmentType)
      if (!['Monthly', 'Quarterly', 'At Maturity'].includes(investmentType)) {
        throw new Error(`Unsupported investment type for payment reminder: ${investmentType || 'unknown'}`)
      }

      if (!job.investor_id) {
        throw new Error('Payment reminder job is missing investor id')
      }

      recipients = await resolveReminderRecipients(supabaseClient, job.investor_id, 'payment_reminders')
      if (recipients.length === 0) {
        throw new Error('No Investment Manager or CEO email recipients are configured for payment reminders')
      }

      subject = `Payment Reminder: ${readString(payload.investorName)} - ${readString(payload.reminderType)}`
      html = generatePaymentReminderEmail({
        investorName: readString(payload.investorName),
        investmentType,
        paymentAmount: readNumber(payload.paymentAmount),
        reminderType: readString(payload.reminderType),
        nextPaymentDate: readString(payload.nextPaymentDate),
        maturityDate: readString(payload.maturityDate),
      })
      metadata = {
        investmentAmount: readNumber(payload.paymentAmount),
      }
    } else if (job.notification_type === 'maturity_reminder') {
      if (!job.investor_id) {
        throw new Error('Maturity reminder job is missing investor id')
      }

      recipients = await resolveMaturityReminderRecipients(supabaseClient, job.investor_id)
      if (recipients.length === 0) {
        throw new Error('No Investment Manager recipient is configured for maturity reminders')
      }

      const daysUntilMaturity = readNumber(payload.daysUntilMaturity)
      subject = buildMaturityReminderSubject(readString(payload.investorName), daysUntilMaturity)
      html = generateMaturityReminderEmail({
        investorName: readString(payload.investorName),
        daysUntilMaturity,
        maturityDate: readString(payload.maturityDate),
        investmentAmount: readNumber(payload.investmentAmount),
        investmentType: readString(payload.investmentType),
      })
      metadata = {
        daysUntilMaturity,
        investmentAmount: readNumber(payload.investmentAmount),
        maturityDate: readString(payload.maturityDate),
      }
    } else if (job.notification_type === 'birthday_greeting') {
      if (!job.user_id || !recipientEmail) {
        throw new Error('Birthday greeting job payload is missing required fields')
      }

      subject = `Happy Birthday ${readString(payload.investorName)}!`
      html = generateBirthdayEmail(
        readString(payload.investorName),
        nullableNumber(payload.age)
      )
    } else if (job.notification_type === 'monthly_report') {
      const monthlyStats = await buildMonthlyReportStats(supabaseClient, job.user_id)

      if (!job.user_id || !recipientEmail) {
        throw new Error('Monthly report job payload is missing required fields')
      }

      subject = `Monthly Investment Report - ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
      html = generateMonthlyReportEmail(monthlyStats)
      metadata = {}
    } else {
      throw new Error(`Unsupported notification job type: ${job.notification_type}`)
    }

    if (recipients.length > 0) {
      const deliveredRecipients: string[] = []

      for (const recipient of recipients) {
        if (job.notification_type === 'maturity_reminder' && job.investor_id) {
          await upsertDashboardNotification(supabaseClient, {
            userId: recipient.userId,
            userRole: mapRecipientRoleToNotificationRole(recipient.role),
            recipientEmail: recipient.email,
            investorId: job.investor_id,
            investorName: readString(payload.investorName),
            maturityDate: readString(payload.maturityDate),
            daysUntilMaturity: readNumber(payload.daysUntilMaturity),
          })
        }

        if (recipient.email) {
          await sendEmailNotification({
            supabaseUrl,
            serviceRoleKey,
            to: recipient.email,
            subject,
            html,
            userId: recipient.userId,
            investorId: job.investor_id,
            notificationType: job.notification_type,
            recipient: recipient.email,
            metadata,
          })
          deliveredRecipients.push(recipient.email)
        }

        if (job.notification_type === 'maturity_reminder' && recipient.phone) {
          const smsMessage = buildMaturityReminderSms({
            investorName: readString(payload.investorName),
            daysUntilMaturity: readNumber(payload.daysUntilMaturity),
            maturityDate: readString(payload.maturityDate),
            investmentAmount: readNumber(payload.investmentAmount),
          })

          await sendSmsNotification({
            supabaseClient,
            to: recipient.phone,
            body: smsMessage,
            userId: recipient.userId,
            investorId: job.investor_id,
            notificationType: job.notification_type,
            recipient: recipient.phone,
            metadata,
          })
          deliveredRecipients.push(recipient.phone)
        }
      }
      recipientEmail = deliveredRecipients.join(', ')
    } else {
      if (!job.user_id || !recipientEmail) {
        throw new Error('Notification job payload is missing required fields')
      }

      await sendEmailNotification({
        supabaseUrl,
        serviceRoleKey,
        to: recipientEmail,
        subject,
        html,
        userId: job.user_id,
        investorId: job.investor_id,
        notificationType: job.notification_type,
        recipient: recipientEmail,
        metadata,
      })
    }

    const { error: completeError } = await supabaseClient
      .from('notification_jobs')
      .update({
        status: 'completed',
        processed_at: new Date().toISOString(),
        locked_at: null,
        last_error: null,
      })
      .eq('id', job.id)

    if (completeError) throw completeError

    return {
      status: 'completed',
      recipient: recipientEmail || null,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`Failed to process job ${job.id}:`, errorMessage)
    const recipientEmail = readString(job.payload?.email)

    const { data: currentJob } = await supabaseClient
      .from('notification_jobs')
      .select('attempt_count, max_attempts')
      .eq('id', job.id)
      .single()

    const attemptCount = (currentJob?.attempt_count ?? 0) + 1
    const maxAttempts = currentJob?.max_attempts ?? 3
    const shouldRetry = attemptCount < maxAttempts

    await supabaseClient
      .from('notification_jobs')
      .update({
        status: shouldRetry ? 'pending' : 'failed',
        attempt_count: attemptCount,
        last_error: errorMessage,
        locked_at: null,
        scheduled_for: shouldRetry
          ? new Date(Date.now() + attemptCount * 5 * 60 * 1000).toISOString()
          : new Date().toISOString(),
      })
      .eq('id', job.id)

    return {
      status: 'failed',
      recipient: recipientEmail || null,
      error: errorMessage,
    }
  }
}

async function sendEmailNotification(args: {
  supabaseUrl: string
  serviceRoleKey: string
  to: string
  subject: string
  html: string
  userId: string
  investorId: string | null
  notificationType: string
  recipient: string
  metadata: Record<string, unknown>
}) {
  const emailResponse = await fetch(`${args.supabaseUrl}/functions/v1/send-email`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: args.to,
      subject: args.subject,
      html: args.html,
      userId: args.userId,
      investorId: args.investorId,
      notificationType: args.notificationType,
      recipient: args.recipient,
      deliveryChannel: 'email',
      ...args.metadata,
    }),
  })

  if (!emailResponse.ok) {
    throw new Error(await emailResponse.text())
  }
}

async function resolveReminderRecipients(
  supabaseClient: ReturnType<typeof createClient>,
  investorId: string,
  preferenceColumn: 'payment_reminders' | 'maturity_reminders'
): Promise<ReminderRecipient[]> {
  const { data: roleRows, error: roleError } = await supabaseClient
    .from('user_roles')
    .select('user_id, role')
    .in('role', ['investment_manager', 'super_admin'])

  if (roleError) throw roleError

  const typedRoleRows = (roleRows ?? []) as Array<{
    user_id: string
    role: 'investment_manager' | 'super_admin'
  }>

  if (typedRoleRows.length === 0) {
    return []
  }

  const { data: preferences, error: preferencesError } = await supabaseClient
    .from('notification_preferences')
    .select(`user_id, email_enabled, ${preferenceColumn}`)
    .in('user_id', typedRoleRows.map((row) => row.user_id))

  if (preferencesError) throw preferencesError

  const enabledPreferenceUserIds = new Set(
    (preferences ?? [])
      .filter((row) => row.email_enabled === true && row[preferenceColumn] === true)
      .map((row) => row.user_id as string)
  )

  const eligibleRoleRows = typedRoleRows.filter((row) => enabledPreferenceUserIds.has(row.user_id))

  if (eligibleRoleRows.length === 0) {
    return []
  }

  const { data: investor, error: investorError } = await supabaseClient
    .from('investors')
    .select('created_by')
    .eq('id', investorId)
    .maybeSingle()

  if (investorError) throw investorError

  const preferredInvestmentManagerId = investor?.created_by ?? null
  const filteredRoleRows = eligibleRoleRows.filter((row) => {
    if (row.role === 'super_admin') {
      return true
    }

    return preferredInvestmentManagerId ? row.user_id === preferredInvestmentManagerId : true
  })

  const { data: authUsers, error: usersError } = await supabaseClient.auth.admin.listUsers()
  if (usersError) throw usersError

  return filteredRoleRows
    .map((row) => {
      const user = authUsers.users.find((authUser) => authUser.id === row.user_id)
      const email = user?.email?.trim() ?? null
      const phone = readAuthUserPhone(user)

      if (!email) {
        return null
      }

      return {
        userId: row.user_id,
        email,
        phone,
        role: row.role,
      } satisfies ReminderRecipient
    })
    .filter((recipient): recipient is ReminderRecipient => recipient !== null)
}

async function resolveMaturityReminderRecipients(
  supabaseClient: ReturnType<typeof createClient>,
  investorId: string,
): Promise<ReminderRecipient[]> {
  const { data: roleRows, error: roleError } = await supabaseClient
    .from('user_roles')
    .select('user_id, role')
    .eq('role', 'investment_manager')

  if (roleError) throw roleError

  const typedRoleRows = (roleRows ?? []) as Array<{
    user_id: string
    role: 'investment_manager'
  }>

  if (typedRoleRows.length === 0) {
    return []
  }

  const { data: preferences, error: preferencesError } = await supabaseClient
    .from('notification_preferences')
    .select('user_id, maturity_reminders')
    .in('user_id', typedRoleRows.map((row) => row.user_id))

  if (preferencesError) throw preferencesError

  const enabledUserIds = new Set(
    (preferences ?? [])
      .filter((row) => row.maturity_reminders === true)
      .map((row) => row.user_id as string)
  )

  const { data: investor, error: investorError } = await supabaseClient
    .from('investors')
    .select('created_by')
    .eq('id', investorId)
    .maybeSingle()

  if (investorError) throw investorError

  const preferredInvestmentManagerId = investor?.created_by ?? null
  const filteredRoleRows = typedRoleRows.filter((row) => {
    if (!enabledUserIds.has(row.user_id)) {
      return false
    }

    return preferredInvestmentManagerId ? row.user_id === preferredInvestmentManagerId : true
  })

  if (filteredRoleRows.length === 0) {
    return []
  }

  const { data: authUsers, error: usersError } = await supabaseClient.auth.admin.listUsers()
  if (usersError) throw usersError

  return filteredRoleRows
    .map((row) => {
      const user = authUsers.users.find((authUser) => authUser.id === row.user_id)
      const email = user?.email?.trim() ?? null
      const phone = readAuthUserPhone(user)

      if (!email && !phone) {
        return null
      }

      return {
        userId: row.user_id,
        email,
        phone,
        role: row.role,
      } satisfies ReminderRecipient
    })
    .filter((recipient): recipient is ReminderRecipient => recipient !== null)
}

function readAuthUserPhone(user: { phone?: string | null; user_metadata?: Record<string, unknown> } | undefined) {
  const metadataPhone = user?.user_metadata?.phone

  if (typeof user?.phone === 'string' && user.phone.trim()) {
    return user.phone.trim()
  }

  if (typeof metadataPhone === 'string' && metadataPhone.trim()) {
    return metadataPhone.trim()
  }

  return null
}

function buildMaturityReminderSubject(investorName: string, daysUntilMaturity: number) {
  if (daysUntilMaturity <= 0) {
    return `Investment Maturity Reminder: ${investorName} matures today`
  }

  return `Investment Maturity Reminder: ${investorName} - ${daysUntilMaturity} days remaining`
}

function buildMaturityReminderSms(data: {
  investorName: string
  daysUntilMaturity: number
  maturityDate: string
  investmentAmount: number
}) {
  const maturityDateLabel = new Date(data.maturityDate).toLocaleDateString()
  const timingLabel =
    data.daysUntilMaturity <= 0
      ? 'matures today'
      : `matures in ${data.daysUntilMaturity} day${data.daysUntilMaturity === 1 ? '' : 's'}`

  return `Maturity alert: ${data.investorName} ${timingLabel} on ${maturityDateLabel}. Investment amount: N${data.investmentAmount.toLocaleString()}.`
}

function mapRecipientRoleToNotificationRole(role: ReminderRecipient['role']) {
  return role === 'super_admin' ? 'ceo' : 'manager'
}

async function upsertDashboardNotification(
  supabaseClient: ReturnType<typeof createClient>,
  args: {
    userId: string
    userRole: 'manager' | 'ceo'
    recipientEmail: string | null
    investorId: string
    investorName: string
    maturityDate: string
    daysUntilMaturity: number
  }
) {
  const title =
    args.daysUntilMaturity <= 0
      ? 'Investment matured today'
      : 'Investment maturity reminder'
  const detail =
    args.daysUntilMaturity <= 0
      ? `${args.investorName}'s investment matures today (${new Date(args.maturityDate).toLocaleDateString()}).`
      : `${args.investorName}'s investment matures in ${args.daysUntilMaturity} day${args.daysUntilMaturity === 1 ? '' : 's'} on ${new Date(args.maturityDate).toLocaleDateString()}.`
  const actionPath = `/investors/${args.investorId}`
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const { data: existing, error: existingError } = await supabaseClient
    .from('notifications')
    .select('id')
    .eq('recipient_user_id', args.userId)
    .eq('user_role', args.userRole)
    .eq('title', title)
    .eq('detail', detail)
    .eq('action_path', actionPath)
    .gte('created_at', startOfDay.toISOString())
    .limit(1)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing) return

  const { error } = await supabaseClient
    .from('notifications')
    .insert({
      certificate_id: null,
      user_role: args.userRole,
      message: detail,
      title,
      detail,
      recipient_user_id: args.userId,
      recipient_email: args.recipientEmail,
      action_path: actionPath,
      is_read: false,
    })

  if (error) throw error
}

async function sendSmsNotification(args: {
  supabaseClient: ReturnType<typeof createClient>
  to: string
  body: string
  userId: string
  investorId: string | null
  notificationType: string
  recipient: string
  metadata: Record<string, unknown>
}) {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')?.trim()
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')?.trim()
  const messagingServiceSid = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID')?.trim()
  const fromNumber = Deno.env.get('TWILIO_FROM_NUMBER')?.trim()

  if (!accountSid || !authToken) {
    throw new Error('Twilio SMS is not configured: missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN')
  }

  if (!messagingServiceSid && !fromNumber) {
    throw new Error('Twilio SMS is not configured: provide TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER')
  }

  const requestBody = new URLSearchParams({
    To: args.to,
    Body: args.body,
  })

  if (messagingServiceSid) {
    requestBody.set('MessagingServiceSid', messagingServiceSid)
  } else if (fromNumber) {
    requestBody.set('From', fromNumber)
  }

  const authHeader = `Basic ${btoa(`${accountSid}:${authToken}`)}`
  const response = await fetch(`${TWILIO_API_BASE_URL}/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: requestBody,
  })

  const rawResponse = await response.text()
  const payload = parseJsonSafely(rawResponse)

  await logNotificationDelivery(
    args.supabaseClient,
    {
      userId: args.userId,
      investorId: args.investorId,
      notificationType: args.notificationType,
      subject: 'Maturity reminder SMS',
      body: args.body,
      recipient: args.recipient,
      deliveryChannel: 'sms',
      metadata: args.metadata,
    },
    response.ok ? 'sent' : 'failed',
    {
      providerName: 'twilio',
      providerMessageId: typeof payload?.sid === 'string' ? payload.sid : null,
      providerStatus: typeof payload?.status === 'string' ? payload.status : response.statusText,
      providerResponse: payload,
      providerErrorCode: response.ok ? null : `${response.status}`,
      providerErrorMessage: response.ok ? null : readProviderMessage(payload) ?? rawResponse,
    }
  )

  if (!response.ok) {
    throw new Error(`Twilio SMS error: ${response.status} ${response.statusText}`)
  }
}

async function logNotificationDelivery(
  supabaseClient: ReturnType<typeof createClient>,
  args: {
    userId: string
    investorId: string | null
    notificationType: string
    subject: string
    body: string
    recipient: string
    deliveryChannel: 'email' | 'sms'
    metadata: Record<string, unknown>
  },
  deliveryStatus: 'sent' | 'failed',
  telemetry: {
    providerName: string
    providerMessageId?: string | null
    providerStatus?: string | null
    providerResponse?: Record<string, unknown> | null
    providerErrorCode?: string | null
    providerErrorMessage?: string | null
  },
) {
  const { error } = await supabaseClient
    .from('email_notifications')
    .insert({
      user_id: args.userId,
      investor_id: args.investorId,
      notification_type: args.notificationType,
      email_subject: args.subject,
      email_body: args.body,
      delivery_status: deliveryStatus,
      delivery_channel: args.deliveryChannel,
      recipient: args.recipient,
      days_until_maturity: readNullableNumber(args.metadata.daysUntilMaturity),
      investment_amount: readNullableNumber(args.metadata.investmentAmount),
      maturity_date: readNullableString(args.metadata.maturityDate),
      error_message: telemetry.providerErrorMessage ?? null,
      provider_name: telemetry.providerName,
      provider_message_id: telemetry.providerMessageId ?? null,
      provider_status: telemetry.providerStatus ?? null,
      provider_response: telemetry.providerResponse ?? null,
      provider_error_code: telemetry.providerErrorCode ?? null,
      provider_error_message: telemetry.providerErrorMessage ?? null,
    })

  if (error) throw error
}

function buildRunSummary(
  results: Array<{ notificationType: string; status: string }>
) {
  const byType: Record<string, { completed: number; failed: number }> = {}

  for (const result of results) {
    if (!byType[result.notificationType]) {
      byType[result.notificationType] = { completed: 0, failed: 0 }
    }

    if (result.status === 'completed') {
      byType[result.notificationType].completed += 1
    } else {
      byType[result.notificationType].failed += 1
    }
  }

  return byType
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0)
}

function readNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function generatePaymentReminderEmail(data: {
  investorName: string
  investmentType: string
  paymentAmount: number
  reminderType: string
  nextPaymentDate: string
  maturityDate: string
}) {
  const { investorName, investmentType, paymentAmount, reminderType, nextPaymentDate, maturityDate } = data

  const daysUntilPayment = Math.ceil((new Date(nextPaymentDate).getTime() - Date.now()) / DAY_IN_MS)
  const isUrgent = daysUntilPayment <= 3

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Payment Reminder</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #F24C21; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .payment-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .amount { font-size: 24px; font-weight: bold; color: #F24C21; text-align: center; }
        .urgent { background: #fff3cd; border-left: 4px solid #F24C21; padding: 15px; margin: 20px 0; }
        .warning { background: #f8d7da; border-left: 4px solid #dc3545; padding: 15px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Zaradera Credit Limited</h1>
          <p>Payment Reminder</p>
        </div>

        <div class="content">
          <h2>${reminderType}</h2>

          ${isUrgent ? `
          <div class="warning">
            <strong>URGENT: Payment Due in ${daysUntilPayment} Days</strong>
          </div>
          ` : `
          <div class="urgent">
            <strong>Payment Due in ${daysUntilPayment} Days</strong>
          </div>
          `}

          <div class="payment-details">
            <h3>ROI Payment Details</h3>
            <p><strong>Investor:</strong> ${investorName}</p>
            <p><strong>Investment Type:</strong> ${investmentType}</p>
            <p><strong>Return Due:</strong></p>
            <div class="amount">N${paymentAmount.toLocaleString()}</div>
            <p><strong>Payment Due Date:</strong> ${new Date(nextPaymentDate).toLocaleDateString()}</p>
            <p><strong>Final Maturity Date:</strong> ${new Date(maturityDate).toLocaleDateString()}</p>
          </div>

          <p>This is an internal reminder that the return on investment for this ${investmentType.toLowerCase()} placement is due soon.</p>
          <p>Please review the investor record and prepare the necessary payout follow-up.</p>
        </div>

        <div class="footer">
          <p>This is an automated notification from Zaradera Credit Limited.</p>
        </div>
      </div>
    </body>
    </html>
  `
}

function generateMaturityReminderEmail(data: {
  investorName: string
  daysUntilMaturity: number
  maturityDate: string
  investmentAmount: number
  investmentType: string
}) {
  const { investorName, daysUntilMaturity, maturityDate, investmentAmount, investmentType } = data
  const timingText =
    daysUntilMaturity <= 0
      ? 'This investment matures today.'
      : `This investment matures in ${daysUntilMaturity} day${daysUntilMaturity === 1 ? '' : 's'}.`

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Investment Maturity Reminder</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #F24C21; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
        .highlight { background: #fff3cd; padding: 15px; border-left: 4px solid #F24C21; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Zaradera Credit Limited</h1>
          <p>Investment Maturity Reminder</p>
        </div>

        <div class="content">
          <h2>Investment Maturity Alert</h2>

          <div class="highlight">
            <strong>Investor:</strong> ${investorName}<br>
            <strong>Status:</strong> ${timingText}<br>
            <strong>Maturity Date:</strong> ${new Date(maturityDate).toLocaleDateString()}<br>
            <strong>Investment Amount:</strong> N${investmentAmount.toLocaleString()}<br>
            <strong>Investment Type:</strong> ${investmentType}
          </div>

          <p>This is an internal reminder that an investment is approaching maturity.</p>
          <p>Please review the upcoming payout and liquidation steps for this investor.</p>
        </div>

        <div class="footer">
          <p>This is an automated message from Zaradera Credit Limited Investment Management System.</p>
        </div>
      </div>
    </body>
    </html>
  `
}

function parseJsonSafely(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function readProviderMessage(payload: Record<string, unknown> | null) {
  if (!payload) return null
  if (typeof payload.message === 'string') return payload.message
  if (typeof payload.error_message === 'string') return payload.error_message
  return null
}

function generateBirthdayEmail(name: string, _age: number | null): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Happy Birthday!</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #f24c21 0%, #f5a623 100%); color: white; padding: 40px 20px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { padding: 30px 20px; background: #f8f9fa; }
        .birthday-message { background: white; padding: 30px; border-radius: 10px; margin: 20px 0; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .celebration { font-size: 32px; margin: 20px 0; }
        .name { font-size: 28px; font-weight: bold; color: #f24c21; margin: 20px 0; }
        .message { font-size: 18px; line-height: 1.8; color: #555; }
        .footer { text-align: center; padding: 20px; font-size: 14px; color: #777; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Happy Birthday!</h1>
        </div>

        <div class="content">
          <div class="birthday-message">
            <div class="celebration">Celebrate today</div>
            <div class="name">Dear ${name},</div>
            <div class="message">
              <p>Wishing you a fantastic birthday filled with joy, laughter, and the moments that matter most.</p>
              <p>Thank you for your continued trust and confidence in Zaraderavest. We remain committed to helping you achieve your financial goals through secure and rewarding investment opportunities.</p>
              <p><strong>Best wishes from all of us at Zaradera Credit Limited.</strong></p>
            </div>
          </div>
        </div>

        <div class="footer">
          <p>This birthday greeting was sent automatically from the Zaradera Credit Limited Investment Management System.</p>
        </div>
      </div>
    </body>
    </html>
  `
}

async function buildMonthlyReportStats(
  supabaseClient: ReturnType<typeof createClient>,
  userId: string | null
) {
  if (!userId) {
    throw new Error('Monthly report job is missing user id')
  }

  const { data: investments, error } = await supabaseClient
    .from('investors')
    .select('name, investment_amount, maturity_date, investment_type, liquidation_status, created_at')
    .eq('created_by', userId)

  if (error) throw error

  const now = new Date()
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  return {
    total_investments: investments.length,
    active_investments: investments.filter((i) => i.liquidation_status === 'Active').length,
    matured_this_month: investments.filter((i) => {
      const maturityDate = new Date(i.maturity_date)
      return i.liquidation_status === 'Liquidated' &&
        maturityDate >= thisMonth &&
        maturityDate < nextMonth
    }).length,
    total_investment_value: investments.reduce((sum, i) => sum + Number(i.investment_amount), 0),
    maturing_next_month: investments.filter((i) => {
      const maturityDate = new Date(i.maturity_date)
      return i.liquidation_status === 'Active' &&
        maturityDate >= nextMonth &&
        maturityDate < new Date(now.getFullYear(), now.getMonth() + 2, 1)
    }).length,
    recent_investments: investments
      .filter((i) => new Date(i.created_at) >= new Date(now.getTime() - 30 * DAY_IN_MS))
      .slice(0, 5)
      .map((i) => ({
        name: i.name,
        amount: Number(i.investment_amount),
        maturity_date: i.maturity_date,
        investment_type: i.investment_type,
      })),
  }
}

function generateMonthlyReportEmail(stats: {
  total_investments: number
  active_investments: number
  matured_this_month: number
  total_investment_value: number
  maturing_next_month: number
  recent_investments: Array<{
    name: string
    amount: number
    maturity_date: string
    investment_type: string
  }>
}) {
  const monthName = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Monthly Investment Report - ${monthName}</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #F24C21; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin: 20px 0; }
        .stat-card { background: white; padding: 15px; border-radius: 8px; text-align: center; }
        .stat-value { font-size: 24px; font-weight: bold; color: #F24C21; }
        .stat-label { font-size: 12px; color: #666; text-transform: uppercase; }
        .recent-investments { margin: 20px 0; }
        .investment-item { background: white; padding: 10px; margin: 5px 0; border-radius: 4px; }
        .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Zaradera Credit Limited</h1>
          <p>Monthly Investment Report - ${monthName}</p>
        </div>

        <div class="content">
          <h2>Portfolio Summary</h2>

          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-value">${stats.total_investments}</div>
              <div class="stat-label">Total Investments</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">${stats.active_investments}</div>
              <div class="stat-label">Active Investments</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">N${stats.total_investment_value.toLocaleString()}</div>
              <div class="stat-label">Total Value</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">${stats.maturing_next_month}</div>
              <div class="stat-label">Maturing Next Month</div>
            </div>
          </div>

          ${stats.matured_this_month > 0 ? `
            <div style="background: #d4edda; color: #155724; padding: 15px; border-radius: 4px; margin: 20px 0;">
              <strong>${stats.matured_this_month} investment(s) matured this month</strong>
            </div>
          ` : ''}

          ${stats.recent_investments.length > 0 ? `
            <div class="recent-investments">
              <h3>Recent Investments (Last 30 Days)</h3>
              ${stats.recent_investments.map((investment) => `
                <div class="investment-item">
                  <strong>${investment.name}</strong> - N${investment.amount.toLocaleString()}
                  (${investment.investment_type}) - Matures: ${new Date(investment.maturity_date).toLocaleDateString()}
                </div>
              `).join('')}
            </div>
          ` : ''}

          <p>Thank you for choosing Zaradera Credit Limited for your investment management needs.</p>
        </div>

        <div class="footer">
          <p>This is an automated monthly report from Zaradera Credit Limited Investment Management System.</p>
        </div>
      </div>
    </body>
    </html>
  `
}
