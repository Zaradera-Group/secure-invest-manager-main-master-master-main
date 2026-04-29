-- Fix user registration by automatically assigning default 'staff' role to new users
-- This ensures all new users can access the application

-- Update the handle_new_user function to also create a user role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Create profile
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  -- Assign default 'staff' role to new users
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'staff'::app_role);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Add a policy to allow the trigger function to insert roles
-- This policy allows the security definer function to insert roles during signup
CREATE POLICY "System can assign default roles" ON public.user_roles
  FOR INSERT WITH CHECK (true);