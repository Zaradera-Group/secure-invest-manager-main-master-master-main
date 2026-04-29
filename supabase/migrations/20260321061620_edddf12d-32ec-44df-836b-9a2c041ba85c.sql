
-- Enums
CREATE TYPE public.investment_type AS ENUM ('Upfront', 'Monthly', 'Quarterly', 'At Maturity');
CREATE TYPE public.liquidation_status AS ENUM ('Active', 'Matured', 'Liquidated', 'Pending');
CREATE TYPE public.gender_type AS ENUM ('Male', 'Female', 'Other');
CREATE TYPE public.app_role AS ENUM ('admin', 'staff');

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- User roles table (separate from profiles per security requirements)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Investors table
CREATE TABLE public.investors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  date_of_birth DATE,
  gender gender_type,
  investment_amount NUMERIC(15,2) NOT NULL,
  start_date DATE NOT NULL,
  maturity_date DATE NOT NULL,
  tenure INTEGER NOT NULL,
  percentage NUMERIC(5,2) NOT NULL,
  investment_type investment_type NOT NULL,
  expected_maturity_amount NUMERIC(15,2) NOT NULL,
  client_account_number TEXT NOT NULL,
  client_bank TEXT NOT NULL,
  brought_by TEXT DEFAULT 'Self',
  investment_certificate_url TEXT,
  liquidation_status liquidation_status NOT NULL DEFAULT 'Active',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.investors ENABLE ROW LEVEL SECURITY;

-- Audit logs table
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  table_name TEXT NOT NULL,
  action TEXT NOT NULL,
  record_id UUID,
  old_data JSONB,
  new_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_investors_updated_at
  BEFORE UPDATE ON public.investors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Audit log trigger function
CREATE OR REPLACE FUNCTION public.log_investor_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (user_id, table_name, action, record_id, new_data)
    VALUES (auth.uid(), 'investors', 'INSERT', NEW.id, to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_logs (user_id, table_name, action, record_id, old_data, new_data)
    VALUES (auth.uid(), 'investors', 'UPDATE', NEW.id, to_jsonb(OLD), to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs (user_id, table_name, action, record_id, old_data)
    VALUES (auth.uid(), 'investors', 'DELETE', OLD.id, to_jsonb(OLD));
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER investors_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.investors
  FOR EACH ROW EXECUTE FUNCTION public.log_investor_changes();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RLS Policies

-- Profiles: users can read/update own profile
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Auto-create profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- User roles: only admins can manage, all authenticated can read own
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all roles" ON public.user_roles FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Investors: admin full access, staff read + create
CREATE POLICY "Admins have full access to investors" ON public.investors FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Staff can read investors" ON public.investors FOR SELECT USING (public.has_role(auth.uid(), 'staff'));
CREATE POLICY "Staff can create investors" ON public.investors FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'staff'));

-- Audit logs: admin and staff can read
CREATE POLICY "Admin and staff can read audit logs" ON public.audit_logs FOR SELECT USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "System can insert audit logs" ON public.audit_logs FOR INSERT WITH CHECK (true);

-- Indexes
CREATE INDEX idx_investors_liquidation_status ON public.investors(liquidation_status);
CREATE INDEX idx_investors_maturity_date ON public.investors(maturity_date);
CREATE INDEX idx_investors_created_by ON public.investors(created_by);
CREATE INDEX idx_audit_logs_table_action ON public.audit_logs(table_name, action);
CREATE INDEX idx_audit_logs_record ON public.audit_logs(record_id);
CREATE INDEX idx_user_roles_user ON public.user_roles(user_id);
