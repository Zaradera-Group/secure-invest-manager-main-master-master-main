import { supabase } from '@/integrations/supabase/client'

export function subscribeToCertificateWorkflow({
  role,
  investorEmail,
  onCertificatesChanged,
  onNotificationsChanged,
  onToast,
}) {
  const certificatesChannel = supabase
    .channel(`certificates-${role}-${investorEmail ?? 'all'}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'certificates' },
      (payload) => {
        const record = payload.new ?? payload.old
        if (!record) return

        const matchesRole =
          (role === 'manager' && record.status === 'pending_manager') ||
          (role === 'general_manager' && record.status === 'pending_general_manager') ||
          (role === 'ceo' && record.status === 'pending_ceo') ||
          (role === 'investor' && record.investor_email?.toLowerCase() === investorEmail?.toLowerCase())

        if (!matchesRole) return

        onCertificatesChanged?.(payload)
        onToast?.(`Certificate update: ${record.investor_name}`)
      },
    )
    .subscribe()

  const notificationsChannel = supabase
    .channel(`notifications-${role}-${investorEmail ?? 'all'}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications' },
      (payload) => {
        const record = payload.new ?? payload.old
        if (!record) return

        const matchesRole =
          record.user_role === role ||
          (role === 'investor' && record.recipient_email?.toLowerCase() === investorEmail?.toLowerCase())

        if (!matchesRole) return

        onNotificationsChanged?.(payload)
        onToast?.(record.message)
      },
    )
    .subscribe()

  return () => {
    supabase.removeChannel(certificatesChannel)
    supabase.removeChannel(notificationsChannel)
  }
}
