import { createClient } from 'npm:@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'

interface InvestmentData {
  id: string
  name: string
  email: string
  investment_amount: number
  investment_type: string
  maturity_date: string
  start_date: string
  percentage: number
  tenure: number
  expected_maturity_amount: number
  created_by: string
  profiles: {
    email: string
  }
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const investmentData: InvestmentData = await req.json()

    // Check if user has email notifications enabled
    const { data: preferences } = await supabaseClient
      .from('notification_preferences')
      .select('email_enabled')
      .eq('user_id', investmentData.created_by)
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

    // Generate email content
    const subject = `Investment Confirmation: ${investmentData.name} - ₦${investmentData.investment_amount.toLocaleString()}`
    const html = generateInvestmentConfirmationEmail(investmentData)

    // Send email
    const emailResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: investmentData.profiles.email,
        subject,
        html,
        userId: investmentData.created_by,
        investorId: investmentData.id,
        notificationType: 'investment_confirmation',
        investmentAmount: investmentData.investment_amount,
      }),
    })

    if (!emailResponse.ok) {
      throw new Error('Failed to send confirmation email')
    }

    return new Response(
      JSON.stringify({ message: 'Investment confirmation email sent successfully' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Error sending investment confirmation:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})

function generateInvestmentConfirmationEmail(investment: InvestmentData) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Investment Confirmation</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #F24C21; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .investment-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
        .detail-row:last-child { border-bottom: none; }
        .amount { font-size: 24px; font-weight: bold; color: #F24C21; text-align: center; margin: 20px 0; }
        .success { background: #d4edda; color: #155724; padding: 15px; border-radius: 4px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Zaradera Credit Limited</h1>
          <p>Investment Confirmation</p>
        </div>

        <div class="content">
          <div class="success">
            <strong>✅ Investment Successfully Created</strong>
          </div>

          <h2>Investment Details</h2>

          <div class="investment-details">
            <div class="detail-row">
              <strong>Investor Name:</strong>
              <span>${investment.name}</span>
            </div>
            <div class="detail-row">
              <strong>Email:</strong>
              <span>${investment.email}</span>
            </div>
            <div class="detail-row">
              <strong>Investment Type:</strong>
              <span>${investment.investment_type}</span>
            </div>
            <div class="detail-row">
              <strong>Investment Amount:</strong>
              <span>₦${investment.investment_amount.toLocaleString()}</span>
            </div>
            <div class="detail-row">
              <strong>Interest Rate:</strong>
              <span>${investment.percentage}%</span>
            </div>
            <div class="detail-row">
              <strong>Tenure:</strong>
              <span>${investment.tenure} months</span>
            </div>
            <div class="detail-row">
              <strong>Start Date:</strong>
              <span>${new Date(investment.start_date).toLocaleDateString()}</span>
            </div>
            <div class="detail-row">
              <strong>Maturity Date:</strong>
              <span>${new Date(investment.maturity_date).toLocaleDateString()}</span>
            </div>
            <div class="detail-row">
              <strong>Expected Maturity Amount:</strong>
              <span>₦${investment.expected_maturity_amount.toLocaleString()}</span>
            </div>
          </div>

          <div class="amount">
            Total Investment Value: ₦${investment.investment_amount.toLocaleString()}
          </div>

          <p>Dear ${investment.name},</p>

          <p>Thank you for choosing Zaradera Credit Limited for your investment needs. Your investment has been successfully created and is now active in our system.</p>

          <h3>What happens next?</h3>
          <ul>
            <li>You will receive regular updates on your investment performance</li>
            <li>Maturity reminders will be sent as your investment approaches the due date</li>
            <li>You can track your investment progress through your online dashboard</li>
            <li>For any questions, our team is here to assist you</li>
          </ul>

          <p><strong>Important:</strong> Please keep this email for your records. It contains important details about your investment.</p>

          <p>For support or questions, please contact us:</p>
          <ul>
            <li>Email: support@zaraderacredit.com</li>
            <li>Phone: [Your Phone Number]</li>
            <li>Office: [Your Office Address]</li>
          </ul>

          <p>We appreciate your trust in Zaradera Credit Limited and look forward to helping you achieve your financial goals.</p>
        </div>

        <div class="footer">
          <p>This is an automated confirmation from Zaradera Credit Limited Investment Management System.</p>
          <p>Investment ID: ${investment.id}</p>
        </div>
      </div>
    </body>
    </html>
  `
}
