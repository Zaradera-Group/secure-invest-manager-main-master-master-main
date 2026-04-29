import { createClient } from 'npm:@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'

const DAY_IN_MS = 24 * 60 * 60 * 1000

type NotificationJob = {
  id: string
  notification_type: string
  user_id: string | null
  investor_id: string | null
  payload: Record<string, unknown>
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

    if (!job.user_id || !job.investor_id || !recipientEmail) {
      if (job.notification_type !== 'monthly_report') {
        throw new Error('Notification job payload is missing required fields')
      }
    }

    let subject = ''
    let html = ''
    let metadata: Record<string, unknown> = {}

    if (job.notification_type === 'payment_reminder') {
      subject = `Payment Reminder: ${readString(payload.investorName)} - ${readString(payload.reminderType)}`
      html = generatePaymentReminderEmail({
        investorName: readString(payload.investorName),
        investmentType: readString(payload.investmentType),
        paymentAmount: readNumber(payload.paymentAmount),
        reminderType: readString(payload.reminderType),
        nextPaymentDate: readString(payload.nextPaymentDate),
        maturityDate: readString(payload.maturityDate),
      })
      metadata = {
        investmentAmount: readNumber(payload.paymentAmount),
      }
    } else if (job.notification_type === 'maturity_reminder') {
      const daysUntilMaturity = readNumber(payload.daysUntilMaturity)
      subject = `Investment Maturity Reminder: ${readString(payload.investorName)} - ${daysUntilMaturity} days remaining`
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

    const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: recipientEmail,
        subject,
        html,
        userId: job.user_id,
        investorId: job.investor_id,
        notificationType: job.notification_type,
        recipient: recipientEmail,
        deliveryChannel: 'email',
        ...metadata,
      }),
    })

    if (!emailResponse.ok) {
      throw new Error(await emailResponse.text())
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
            <h3>Payment Details</h3>
            <p><strong>Investor:</strong> ${investorName}</p>
            <p><strong>Investment Type:</strong> ${investmentType}</p>
            <p><strong>Payment Amount:</strong></p>
            <div class="amount">N${paymentAmount.toLocaleString()}</div>
            <p><strong>Payment Due Date:</strong> ${new Date(nextPaymentDate).toLocaleDateString()}</p>
            <p><strong>Final Maturity Date:</strong> ${new Date(maturityDate).toLocaleDateString()}</p>
          </div>

          <p>This is a reminder that your ${investmentType.toLowerCase()} investment payment is due soon.</p>
          <p>Thank you for your continued partnership with Zaradera Credit Limited.</p>
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
            <strong>Days Until Maturity:</strong> ${daysUntilMaturity}<br>
            <strong>Maturity Date:</strong> ${new Date(maturityDate).toLocaleDateString()}<br>
            <strong>Investment Amount:</strong> N${investmentAmount.toLocaleString()}<br>
            <strong>Investment Type:</strong> ${investmentType}
          </div>

          <p>This is an automated reminder that an investment in your portfolio is approaching maturity.</p>
          <p>Please contact our office to discuss liquidation options and next steps for your matured investment.</p>
        </div>

        <div class="footer">
          <p>This is an automated message from Zaradera Credit Limited Investment Management System.</p>
        </div>
      </div>
    </body>
    </html>
  `
}

function formatOrdinal(value: number): string {
  const remainder10 = value % 10
  const remainder100 = value % 100

  if (remainder10 === 1 && remainder100 !== 11) return `${value}st`
  if (remainder10 === 2 && remainder100 !== 12) return `${value}nd`
  if (remainder10 === 3 && remainder100 !== 13) return `${value}rd`
  return `${value}th`
}

function generateBirthdayEmail(name: string, age: number | null): string {
  const ageText = age ? `your ${formatOrdinal(age)}` : ''

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
              ${age ? `<p>May ${ageText} be filled with success, good health, and prosperity.</p>` : ''}
              <p>Thank you for being a valued member of our investment community. We look forward to many more successful years together.</p>
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
