import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

const email = `test-pdf-${Date.now()}@example.com`
const password = 'Test1234!'
console.log('email', email)

const createResult = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
})
console.log('createResult full', JSON.stringify(createResult, null, 2))
console.log('createResult error', createResult.error?.message, 'id', createResult.data?.user?.id)

const userId = createResult.data?.user?.id
if (!userId) throw new Error('User creation failed')

const { error: roleError } = await admin.from('user_roles').insert({
  user_id: userId,
  role: 'investment_manager',
})
console.log('roleError', roleError?.message)

const { error: allowError } = await admin.from('allowed_auth_users').insert({
  email: email.toLowerCase(),
  is_active: true,
})
console.log('allowError', allowError?.message)

const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

const signIn = await anon.auth.signInWithPassword({ email, password })
console.log('signIn error', signIn.error?.message)
console.log('access_token', signIn.data.session?.access_token)
