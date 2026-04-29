import { corsHeaders } from '../_shared/cors.ts'

interface VerificationRequest {
  documentType: 'nin' | 'bvn'
  value: string
  firstName?: string
  lastName?: string
  dob?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { documentType, value, firstName, lastName, dob }: VerificationRequest = await req.json()

    if (!documentType || !value?.trim()) {
      return new Response(
        JSON.stringify({ error: 'Document type and value are required.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const baseUrl = Deno.env.get('IDENTITY_VERIFICATION_URL')
    const providerApiKey = Deno.env.get('IDENTITY_VERIFICATION_API_KEY')
    const providerName = Deno.env.get('IDENTITY_VERIFICATION_PROVIDER') ?? 'Dojah'
    const appId = Deno.env.get('DOJAH_APP_ID')

    if (!baseUrl || !providerApiKey || !appId) {
      return new Response(
        JSON.stringify({
          verified: false,
          provider: providerName,
          message: `Verification provider is not configured yet. Add IDENTITY_VERIFICATION_URL, IDENTITY_VERIFICATION_API_KEY, and DOJAH_APP_ID to enable live ${documentType.toUpperCase()} checks.`,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const endpoint = documentType === 'nin' ? '/api/v1/kyc/nin' : '/api/v1/kyc/bvn/full'
    const query = new URLSearchParams()
    query.set(documentType, value.trim())

    if (documentType === 'bvn') {
      if (firstName?.trim()) query.set('first_name', firstName.trim())
      if (lastName?.trim()) query.set('last_name', lastName.trim())
      if (dob?.trim()) query.set('dob', dob.trim())
    }

    const providerResponse = await fetch(`${baseUrl}${endpoint}?${query.toString()}`, {
      method: 'GET',
      headers: {
        'AppId': appId,
        'Authorization': providerApiKey,
      },
    })

    const payload = await providerResponse.json().catch(() => ({}))
    const entity = payload?.entity
    const verified = providerResponse.ok && Boolean(entity)

    return new Response(
      JSON.stringify({
        verified,
        provider: providerName,
        message: providerResponse.ok
          ? `${documentType.toUpperCase()} verification completed successfully.`
          : payload?.error ?? payload?.message ?? `${documentType.toUpperCase()} verification failed.`,
        entity,
        raw: payload,
      }),
      { status: providerResponse.ok ? 200 : 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
