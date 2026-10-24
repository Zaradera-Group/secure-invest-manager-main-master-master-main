import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export function ProtectedRoute({
  children,
  allowedRoles,
}: Readonly<{
  children: React.ReactNode;
  allowedRoles?: Array<'super_admin' | 'admin' | 'staff' | 'investment_manager' | 'accountant' | 'general_manager' | 'software_engineer'>;
}>) {
  const { provider, session, loading, role, user } = useAuth();

  // Auth0 can expose the user one render before /auth/me creates the app session.
  // Keep the route pending during that handoff instead of bouncing back to /login.
  const waitingForAuth0Session = provider === 'auth0' && Boolean(user) && !session;

  if (loading || waitingForAuth0Session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !role) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading your workspace...</div>
      </div>
    );
  }

  if (allowedRoles && role && !allowedRoles.includes(role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
