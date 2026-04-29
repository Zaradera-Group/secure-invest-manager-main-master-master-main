-- Add birthday notifications to notification preferences
ALTER TABLE notification_preferences
ADD COLUMN birthday_notifications BOOLEAN DEFAULT true;

-- Update existing records to have birthday notifications enabled by default
UPDATE notification_preferences
SET birthday_notifications = true
WHERE birthday_notifications IS NULL;

-- Add comment to document the new column
COMMENT ON COLUMN notification_preferences.birthday_notifications IS 'Enable/disable automated birthday notifications for investors';