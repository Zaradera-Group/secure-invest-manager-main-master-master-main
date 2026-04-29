-- Create notification preferences table
CREATE TABLE notification_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email_enabled BOOLEAN DEFAULT true,
  maturity_reminders BOOLEAN DEFAULT true,
  payment_reminders BOOLEAN DEFAULT true,
  monthly_reports BOOLEAN DEFAULT false,
  reminder_days_before INTEGER[] DEFAULT '{7,3,1}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Create email notifications audit table
CREATE TABLE email_notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  investor_id UUID REFERENCES investors(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL, -- 'maturity_reminder', 'payment_due', 'monthly_report', etc.
  email_subject TEXT NOT NULL,
  email_body TEXT NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  delivery_status TEXT DEFAULT 'sent', -- 'sent', 'delivered', 'failed'
  error_message TEXT,
  days_until_maturity INTEGER,
  investment_amount DECIMAL(15,2),
  maturity_date DATE
);

-- Enable RLS
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own notification preferences" ON notification_preferences
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own notification preferences" ON notification_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own notification preferences" ON notification_preferences
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own email notifications" ON email_notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert email notifications" ON email_notifications
  FOR INSERT WITH CHECK (true);

-- Create function to auto-create notification preferences for new users
CREATE OR REPLACE FUNCTION create_default_notification_preferences()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO notification_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for new user signup
CREATE TRIGGER on_auth_user_created_notification_preferences
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_default_notification_preferences();

-- Create indexes for performance
CREATE INDEX idx_notification_preferences_user_id ON notification_preferences(user_id);
CREATE INDEX idx_email_notifications_user_id ON email_notifications(user_id);
CREATE INDEX idx_email_notifications_investor_id ON email_notifications(investor_id);
CREATE INDEX idx_email_notifications_type ON email_notifications(notification_type);
CREATE INDEX idx_email_notifications_sent_at ON email_notifications(sent_at);

-- Create function to send investment confirmation emails
CREATE OR REPLACE FUNCTION send_investment_confirmation()
RETURNS TRIGGER AS $$
DECLARE
  user_email TEXT;
BEGIN
  -- Get the user's email
  SELECT email INTO user_email
  FROM profiles
  WHERE id = NEW.created_by;

  -- Send confirmation email via edge function
  PERFORM
    net.http_post(
      url := (SELECT supabase_url FROM supabase_settings) || '/functions/v1/send-investment-confirmation',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT service_role_key FROM supabase_settings)
      ),
      body := jsonb_build_object(
        'id', NEW.id,
        'name', NEW.name,
        'email', NEW.email,
        'investment_amount', NEW.investment_amount,
        'investment_type', NEW.investment_type,
        'maturity_date', NEW.maturity_date,
        'start_date', NEW.start_date,
        'percentage', NEW.percentage,
        'tenure', NEW.tenure,
        'expected_maturity_amount', NEW.expected_maturity_amount,
        'created_by', NEW.created_by,
        'profiles', jsonb_build_object('email', user_email)
      )
    );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for new investments
CREATE TRIGGER send_investment_confirmation_trigger
  AFTER INSERT ON investors
  FOR EACH ROW EXECUTE FUNCTION send_investment_confirmation();

-- Create a simple settings table for Supabase configuration
-- This is needed for the trigger to work
CREATE TABLE IF NOT EXISTS supabase_settings (
  supabase_url TEXT,
  service_role_key TEXT,
  anon_key TEXT
);

-- Insert settings (these will be set via environment variables in production)
INSERT INTO supabase_settings (supabase_url, service_role_key, anon_key)
VALUES ('', '', '')
ON CONFLICT DO NOTHING;
