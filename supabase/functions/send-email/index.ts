import { createClient } from 'npm:@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'

interface EmailRequest {
  to: string
  subject: string
  html: string
  userId: string
  investorId?: string
  notificationType: string
  daysUntilMaturity?: number
  investmentAmount?: number
  maturityDate?: string
  deliveryChannel?: 'email' | 'sms'
  recipient?: string
}

type ProviderTelemetry = {
  providerName: string
  providerMessageId?: string | null
  providerStatus?: string | null
  providerResponse?: Record<string, unknown> | null
  providerErrorCode?: string | null
  providerErrorMessage?: string | null
}

type CallerContext = {
  isServiceRoleRequest: boolean
  callerUserId: string | null
  canSendForUserId: string
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const authorization = req.headers.get('Authorization') ?? ''
    const bearerToken = authorization.replace(/^Bearer\s+/i, '')
    const isServiceRoleRequest = bearerToken === serviceRoleKey

    const supabaseClient = createClient(
      supabaseUrl,
      isServiceRoleRequest ? serviceRoleKey : anonKey,
      authorization
        ? {
            global: {
              headers: { Authorization: authorization },
            },
          }
        : undefined
    )

    const emailData: EmailRequest = await req.json()

    const callerContext = await resolveCallerContext(
      supabaseUrl,
      anonKey,
      serviceRoleKey,
      supabaseClient,
      authorization,
      isServiceRoleRequest,
      emailData.userId
    )

    // Check if user has email notifications enabled
    const { data: preferences } = await supabaseClient
      .from('notification_preferences')
      .select('email_enabled')
      .eq('user_id', callerContext.canSendForUserId)
      .single()

    if (!preferences?.email_enabled) {
      return new Response(
        JSON.stringify({ message: 'Email notifications disabled for this user' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    // Send email via Resend
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) {
      throw new Error('RESEND_API_KEY not configured')
    }

    const from = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Zaradera Credit Limited <noreply@zaraderacredit.com>'
    const emailPayload = {
      from,
      to: [emailData.to],
      subject: emailData.subject,
      html: emailData.html,
    }

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    })

    const resendBodyText = await resendResponse.text()
    const resendPayload = parseJsonSafely(resendBodyText)

    if (!resendResponse.ok) {
      await logEmailNotification(supabaseClient, {
        ...emailData,
        userId: callerContext.canSendForUserId,
      }, 'failed', {
        providerName: 'resend',
        providerStatus: resendResponse.statusText,
        providerResponse: resendPayload,
        providerErrorCode: `${resendResponse.status}`,
        providerErrorMessage: extractProviderError(resendPayload) ?? resendBodyText,
      })

      throw new Error(`Resend API error: ${resendResponse.status} ${resendResponse.statusText}`)
    }

    const resendData = (resendPayload ?? {}) as Record<string, unknown>

    await logEmailNotification(supabaseClient, {
      ...emailData,
      userId: callerContext.canSendForUserId,
    }, 'sent', {
      providerName: 'resend',
      providerMessageId: typeof resendData.id === 'string' ? resendData.id : null,
      providerStatus: 'accepted',
      providerResponse: resendData,
    })

    return new Response(
      JSON.stringify({
        message: 'Email sent successfully',
        emailId: resendData.id
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('Error sending email:', error)

    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})

async function resolveCallerContext(
  supabaseUrl: string,
  anonKey: string,
  serviceRoleKey: string,
  supabaseClient: ReturnType<typeof createClient>,
  authorization: string,
  isServiceRoleRequest: boolean,
  requestedUserId: string
): Promise<CallerContext> {
  if (isServiceRoleRequest) {
    return {
      isServiceRoleRequest: true,
      callerUserId: null,
      canSendForUserId: requestedUserId,
    }
  }

  const { data: { user } } = await supabaseClient.auth.getUser()
  if (!user) {
    throw new Error('Unauthorized')
  }

  if (user.id === requestedUserId) {
    return {
      isServiceRoleRequest: false,
      callerUserId: user.id,
      canSendForUserId: requestedUserId,
    }
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey)
  const { data: adminRole, error } = await serviceClient
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'admin')
    .maybeSingle()

  if (error) throw error
  if (!adminRole) {
    throw new Error('Forbidden')
  }

  const scopedAuthClient = createClient(supabaseUrl, anonKey, {
    global: {
      headers: { Authorization: authorization },
    },
  })
  const { data: targetPreferences, error: targetPreferencesError } = await scopedAuthClient
    .from('notification_preferences')
    .select('user_id')
    .eq('user_id', requestedUserId)
    .maybeSingle()

  if (targetPreferencesError && targetPreferencesError.code !== 'PGRST116') {
    throw targetPreferencesError
  }

  return {
    isServiceRoleRequest: false,
    callerUserId: user.id,
    canSendForUserId: targetPreferences?.user_id ?? requestedUserId,
  }
}

async function logEmailNotification(
  supabaseClient: ReturnType<typeof createClient>,
  emailData: EmailRequest,
  deliveryStatus: 'sent' | 'failed',
  telemetry: ProviderTelemetry
) {
  const { error } = await supabaseClient
    .from('email_notifications')
    .insert({
      user_id: emailData.userId,
      investor_id: emailData.investorId,
      notification_type: emailData.notificationType,
      email_subject: emailData.subject,
      email_body: emailData.html,
      delivery_status: deliveryStatus,
      days_until_maturity: emailData.daysUntilMaturity,
      investment_amount: emailData.investmentAmount,
      maturity_date: emailData.maturityDate,
      delivery_channel: emailData.deliveryChannel ?? 'email',
      recipient: emailData.recipient ?? emailData.to,
      error_message: telemetry.providerErrorMessage ?? null,
      provider_name: telemetry.providerName,
      provider_message_id: telemetry.providerMessageId ?? null,
      provider_status: telemetry.providerStatus ?? null,
      provider_response: telemetry.providerResponse ?? null,
      provider_error_code: telemetry.providerErrorCode ?? null,
      provider_error_message: telemetry.providerErrorMessage ?? null,
    })

  if (error) {
    throw error
  }
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

function extractProviderError(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null

  if (typeof payload.message === 'string') return payload.message
  if (typeof payload.error === 'string') return payload.error

  return null
}
