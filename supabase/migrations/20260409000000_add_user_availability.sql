-- Add availability status for approval roles
ALTER TABLE public.user_roles ADD COLUMN is_available_for_approvals BOOLEAN NOT NULL DEFAULT true;

-- Update RLS policies to allow users to update their own availability
CREATE POLICY "Users can update own availability" ON public.user_roles
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);