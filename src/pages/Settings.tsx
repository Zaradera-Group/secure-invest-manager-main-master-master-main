import { motion } from 'framer-motion';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Lock, Shield, Database, Bell, Plus, Trash2, Mail } from 'lucide-react';
import { useAnnouncements, useCreateAnnouncement, useDeleteAnnouncement } from '@/hooks/useAnnouncements';
import { useNotificationPreferences, useUpdateNotificationPreferences } from '@/hooks/useNotifications';
import { useUpdateAvailability } from '@/hooks/useCertificates';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export default function Settings() {
  const [announcementPage, setAnnouncementPage] = useState(0);
  const [newAnnouncement, setNewAnnouncement] = useState({
    title: '',
    detail: '',
    status: 'info' as 'info' | 'urgent' | 'matured',
  });

  const { data: announcementsResult, isLoading } = useAnnouncements(announcementPage, 8);
  const announcements = announcementsResult?.data ?? [];
  const announcementCount = announcementsResult?.count ?? 0;
  const createAnnouncement = useCreateAnnouncement();
  const deleteAnnouncement = useDeleteAnnouncement();
  const { toast } = useToast();

  // Notification preferences
  const { data: notificationPrefs, isLoading: prefsLoading } = useNotificationPreferences();
  const updatePreferences = useUpdateNotificationPreferences();
  const { role, user } = useAuth();
  const updateAvailability = useUpdateAvailability();

  const { data: isAvailable } = useQuery({
    queryKey: ['user-availability', user?.id, role],
    enabled: !!user?.id && !!role && (role === 'investment_manager' || role === 'general_manager'),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_roles' as never)
        .select('is_available_for_approvals')
        .eq('user_id', user!.id)
        .eq('role', role)
        .single();

      if (error) throw error;
      return ((data as { is_available_for_approvals?: boolean } | null)?.is_available_for_approvals) ?? true;
    },
  });

  const getAnnouncementBadgeVariant = (status: string) => {
    if (status === 'urgent') return 'destructive' as const;
    if (status === 'matured') return 'secondary' as const;
    return 'default' as const;
  };

  const renderAnnouncementsContent = () => {
    if (isLoading) {
      return <p className="text-sm text-muted-foreground">Loading announcements...</p>;
    }
    if (announcements.length === 0) {
      return <p className="text-sm text-muted-foreground">No announcements yet.</p>;
    }
    return (
      <div className="space-y-3">
        {announcements.map((announcement) => (
          <div key={announcement.id} className="flex items-start gap-3 p-4 rounded-lg border border-border/50">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-medium">{announcement.title}</h3>
                <Badge variant={getAnnouncementBadgeVariant(announcement.status)}>
                  {announcement.status}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{announcement.detail}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {new Date(announcement.created_at).toLocaleDateString()}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleDeleteAnnouncement(announcement.id)}
              disabled={deleteAnnouncement.isPending}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
        <div className="flex items-center justify-between pt-2">
          <p className="text-sm text-muted-foreground">Showing {announcements.length} of {announcementCount} announcements</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setAnnouncementPage((current) => Math.max(0, current - 1))} disabled={announcementPage === 0}>
              Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAnnouncementPage((current) => current + 1)} disabled={announcements.length < 8}>
              Next
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const handleCreateAnnouncement = async () => {
    if (!newAnnouncement.title.trim() || !newAnnouncement.detail.trim()) {
      toast({
        title: 'Error',
        description: 'Please fill in all fields.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await createAnnouncement.mutateAsync(newAnnouncement);
      setNewAnnouncement({ title: '', detail: '', status: 'info' });
      setAnnouncementPage(0);
      toast({
        title: 'Success',
        description: 'Announcement created successfully.',
      });
    } catch (error) {
      console.error('Failed to create announcement:', error);
      toast({
        title: 'Error',
        description: 'Failed to create announcement.',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteAnnouncement = async (id: string) => {
    try {
      await deleteAnnouncement.mutateAsync(id);
      toast({
        title: 'Success',
        description: 'Announcement deleted successfully.',
      });
    } catch (error) {
      console.error('Failed to delete announcement:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete announcement.',
        variant: 'destructive',
      });
    }
  };

  const handleUpdateAvailability = async (isAvailable: boolean) => {
    try {
      await updateAvailability.mutateAsync(isAvailable);
      toast({
        title: 'Success',
        description: `You are now ${isAvailable ? 'available' : 'unavailable'} for approvals.`,
      });
    } catch (error) {
      console.error('Failed to update availability:', error);
      toast({
        title: 'Error',
        description: 'Failed to update availability.',
        variant: 'destructive',
      });
    }
  };

  const handleUpdateNotificationPref = async (
    preferenceKey: 'investment_confirmation' | 'maturity_reminder' | 'payment_reminder' | 'monthly_report' | 'birthday_greeting',
    enabled: boolean,
  ) => {
    const preferenceUpdates =
      preferenceKey === 'investment_confirmation'
        ? { email_enabled: enabled }
        : preferenceKey === 'maturity_reminder'
          ? { maturity_reminders: enabled }
          : preferenceKey === 'payment_reminder'
            ? { payment_reminders: enabled }
            : preferenceKey === 'monthly_report'
              ? { monthly_reports: enabled }
              : { birthday_notifications: enabled };

    try {
      await updatePreferences.mutateAsync(preferenceUpdates);
      toast({
        title: 'Success',
        description: 'Notification preference updated successfully.',
      });
    } catch (error) {
      console.error('Failed to update notification preference:', error);
      toast({
        title: 'Error',
        description: 'Failed to update notification preference.',
        variant: 'destructive',
      });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-6 max-w-4xl"
    >
      <div>
        <h1 className="text-2xl font-heading font-bold">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">System configuration, security settings, and announcements.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-heading flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              Security
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30">
              <Lock className="w-4 h-4" />
              <span>Multi-factor authentication will be configured when backend is connected.</span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30">
              <Database className="w-4 h-4" />
              <span>Encrypted data storage and audit logs are managed through your Supabase backend.</span>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-heading flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" />
              Create Announcement
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Input
                placeholder="Announcement title"
                value={newAnnouncement.title}
                onChange={(e) => setNewAnnouncement(prev => ({ ...prev, title: e.target.value }))}
              />
            </div>
            <div>
              <Textarea
                placeholder="Announcement details"
                value={newAnnouncement.detail}
                onChange={(e) => setNewAnnouncement(prev => ({ ...prev, detail: e.target.value }))}
                rows={3}
              />
            </div>
            <div>
              <Select
                value={newAnnouncement.status}
                onValueChange={(value: 'info' | 'urgent' | 'matured') =>
                  setNewAnnouncement(prev => ({ ...prev, status: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="matured">Matured</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleCreateAnnouncement}
              disabled={createAnnouncement.isPending}
              className="w-full"
            >
              <Plus className="w-4 h-4 mr-2" />
              {createAnnouncement.isPending ? 'Creating...' : 'Create Announcement'}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-heading flex items-center gap-2">
            <Mail className="w-4 h-4 text-primary" />
            Notification Preferences
          </CardTitle>
        </CardHeader>
        <CardContent>
          {prefsLoading ? (
            <p className="text-sm text-muted-foreground">Loading preferences...</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg border border-border/50">
                <div>
                  <h3 className="font-medium">Email Notifications</h3>
                  <p className="text-sm text-muted-foreground">Receive notifications via email</p>
                </div>
                <Switch
                  checked={notificationPrefs?.email_enabled ?? true}
                  onCheckedChange={(enabled) => handleUpdateNotificationPref('investment_confirmation', enabled)}
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg border border-border/50">
                <div>
                  <h3 className="font-medium">Maturity Reminders</h3>
                  <p className="text-sm text-muted-foreground">Get notified 7, 3, and 1 day before investments mature</p>
                </div>
                <Switch
                  checked={notificationPrefs?.maturity_reminders ?? true}
                  onCheckedChange={(enabled) => handleUpdateNotificationPref('maturity_reminder', enabled)}
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg border border-border/50">
                <div>
                  <h3 className="font-medium">Payment Reminders</h3>
                  <p className="text-sm text-muted-foreground">Receive reminders for upcoming payments on installment investments</p>
                </div>
                <Switch
                  checked={notificationPrefs?.payment_reminders ?? true}
                  onCheckedChange={(enabled) => handleUpdateNotificationPref('payment_reminder', enabled)}
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg border border-border/50">
                <div>
                  <h3 className="font-medium">Monthly Reports</h3>
                  <p className="text-sm text-muted-foreground">Get monthly summaries of your investment portfolio</p>
                </div>
                <Switch
                  checked={notificationPrefs?.monthly_reports ?? true}
                  onCheckedChange={(enabled) => handleUpdateNotificationPref('monthly_report', enabled)}
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg border border-border/50">
                <div>
                  <h3 className="font-medium">Birthday Greetings</h3>
                  <p className="text-sm text-muted-foreground">Send automated birthday wishes to investors via email</p>
                </div>
                <Switch
                  checked={notificationPrefs?.birthday_notifications ?? true}
                  onCheckedChange={(enabled) => handleUpdateNotificationPref('birthday_greeting', enabled)}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {(role === 'investment_manager' || role === 'general_manager') && (
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-heading flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              Approval Availability
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between p-4 rounded-lg border border-border/50">
              <div>
                <h3 className="font-medium">Available for Approvals</h3>
                <p className="text-sm text-muted-foreground">Toggle to indicate if you are available to receive and process certificate approvals</p>
              </div>
              <Switch
                checked={isAvailable ?? true}
                onCheckedChange={handleUpdateAvailability}
                disabled={updateAvailability.isPending}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-heading flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" />
            Manage Announcements
          </CardTitle>
        </CardHeader>
        <CardContent>
          {renderAnnouncementsContent()}
        </CardContent>
      </Card>
    </motion.div>
  );
}
