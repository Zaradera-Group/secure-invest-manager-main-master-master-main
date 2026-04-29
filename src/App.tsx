import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import Splash from "./pages/Splash";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import InvestorsList from "./pages/InvestorsList";
import InvestorDetail from "./pages/InvestorDetail";
import NewInvestment from "./pages/NewInvestment";
import Notifications from "./pages/Notifications";
import Settings from "./pages/Settings";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound";
import NotificationAudit from "./pages/NotificationAudit";
import SuperAdminDashboard from "./pages/SuperAdminDashboard";
import CertificatesList from "./pages/CertificatesList";
import CertificateViewer from "./pages/CertificateViewer";
import SettlementDiscrepancies from "./pages/SettlementDiscrepancies";
import { useAuth } from "@/contexts/AuthContext";
import { getDefaultDashboardPath } from "@/lib/authRoutes";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: (failureCount: number, error: { status?: number; code?: string; message?: string }) => {
        if (
          error?.status === 401
          || error?.code === 'PGRST401'
          || error?.message?.includes('401')
          || error?.message?.includes('Invalid JWT')
        ) {
          return failureCount < 1;
        }

        return false;
      },
    },
  },
});

const AnimatedRoutes = () => {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<Splash />} />
        <Route path="/landing" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route path="/dashboard" element={<RoleDashboardRedirect />} />
          <Route path="/manager-dashboard" element={<Navigate to="/dashboard" replace />} />
          <Route path="/gm-dashboard" element={<Navigate to="/dashboard" replace />} />
          <Route path="/ceo-dashboard" element={<Navigate to="/dashboard" replace />} />
          <Route path="/super-admin/dashboard" element={<ProtectedRoute allowedRoles={['admin', 'super_admin']}><SuperAdminDashboard /></ProtectedRoute>} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/investors" element={<InvestorsList />} />
          <Route path="/certificates" element={<CertificatesList />} />
          <Route path="/certificates/:id/view" element={<CertificateViewer />} />
          <Route path="/investors/:id" element={<InvestorDetail />} />
          <Route path="/investors/:id/edit" element={<ProtectedRoute allowedRoles={['investment_manager', 'admin']}><NewInvestment /></ProtectedRoute>} />
          <Route path="/investments/new" element={<ProtectedRoute allowedRoles={['admin', 'investment_manager']}><NewInvestment /></ProtectedRoute>} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/settlement-discrepancies" element={<SettlementDiscrepancies />} />
          <Route path="/notification-audit" element={<ProtectedRoute allowedRoles={['admin', 'super_admin']}><NotificationAudit /></ProtectedRoute>} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AnimatePresence>
  );
};

const RoleDashboardRedirect = () => {
  const { role } = useAuth();
  const defaultPath = getDefaultDashboardPath(role);

  if (defaultPath === "/dashboard") {
    return <Dashboard />;
  }

  return <Navigate to={defaultPath} replace />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AnimatedRoutes />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
