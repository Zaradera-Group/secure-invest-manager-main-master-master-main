import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, PlusCircle, Bell, Settings, LogOut, TrendingUp, ChevronLeft, ChevronRight, X, BarChart3, Inbox,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { getDefaultDashboardPath } from '@/lib/authRoutes';
import { useToast } from '@/hooks/use-toast';

type AppSidebarRole =
  | 'super_admin'
  | 'admin'
  | 'staff'
  | 'investment_manager'
  | 'accountant'
  | 'general_manager'
  | 'software_engineer';

type NavItem = {
  icon: LucideIcon;
  id: string;
  label: string;
  path: string;
  roles?: readonly AppSidebarRole[];
};

const navItems: NavItem[] = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard' },
  { id: 'admin-dashboard', icon: LayoutDashboard, label: 'Admin Dashboard', path: '/super-admin/dashboard', roles: ['admin', 'super_admin'] as const },
  { id: 'investors', icon: Users, label: 'Investors', path: '/investors' },
  { id: 'certificates', icon: BarChart3, label: 'Certificates', path: '/certificates' },
  { id: 'new-investment', icon: PlusCircle, label: 'New Investment', path: '/investments/new' },
  { id: 'public-intake-inbox', icon: Inbox, label: 'Public Intake', path: '/public-intake-inbox', roles: ['investment_manager', 'accountant', 'general_manager', 'admin', 'super_admin'] as const },
  { id: 'notifications', icon: Bell, label: 'Notifications', path: '/notifications' },
  { id: 'reconciliation', icon: BarChart3, label: 'Reconciliation', path: '/settlement-discrepancies' },
  { id: 'notification-audit', icon: BarChart3, label: 'Notification Audit', path: '/notification-audit', roles: ['admin', 'super_admin'] as const },
  { id: 'settings', icon: Settings, label: 'Settings', path: '/settings' },
];

interface AppSidebarProps {
  readonly isOpen?: boolean;
  readonly onClose?: () => void;
}

export function AppSidebar({ isOpen = false, onClose }: AppSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, user, role } = useAuth();
  const { toast } = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const wasDesktopRef = useRef<boolean>(globalThis.innerWidth >= 1024);

  // Auto-collapse on smaller screens and restore the full sidebar when resizing back to desktop.
  useEffect(() => {
    const checkScreenSize = () => {
      const isDesktop = globalThis.innerWidth >= 1024;

      if (!isDesktop) {
        setCollapsed(true);
      } else if (!wasDesktopRef.current) {
        setCollapsed(false);
      }

      wasDesktopRef.current = isDesktop;
    };

    checkScreenSize();
    globalThis.addEventListener('resize', checkScreenSize);
    return () => globalThis.removeEventListener('resize', checkScreenSize);
  }, []);

  const persistedRole = role ?? (globalThis.localStorage?.getItem('auth:last-role') as AppSidebarRole | null);

  const handleLogout = async () => {
    await signOut();
    toast({
      title: 'Logged out',
      description: 'You have been signed out successfully.',
    });
    navigate('/login', { replace: true });
    onClose?.();
  };

  const handleNavClick = () => {
    // Close sidebar on mobile after navigation
    if (globalThis.innerWidth < 1024) {
      onClose?.();
    }
  };

  const dashboardPath = getDefaultDashboardPath(persistedRole);

  const resolvedNavItems = navItems
    .filter((item) => !item.roles || item.roles.includes(persistedRole ?? 'staff'))
    .map((item) => (
      item.path === '/dashboard'
        ? { ...item, path: dashboardPath }
        : item
    ));

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <button
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={onClose}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onClose?.();
            }
          }}
          aria-label="Close sidebar"
          type="button"
        />
      )}

      <aside
        className={cn(
          'fixed top-0 left-0 z-40 h-screen bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-all duration-300 flex flex-col',
          // Desktop: always visible, collapsible
          'lg:translate-x-0',
          collapsed ? 'lg:w-[68px]' : 'lg:w-[250px]',
          // Mobile: overlay when open
          'lg:block',
          isOpen ? 'block translate-x-0' : 'hidden -translate-x-full lg:translate-x-0'
        )}
      >
        <div className="flex items-center justify-between px-4 h-16 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center flex-shrink-0">
              <TrendingUp className="w-5 h-5 text-sidebar-primary-foreground" />
            </div>
            {!collapsed && (
              <div className="overflow-hidden">
                <h1 className="font-heading font-bold text-sm text-sidebar-primary-foreground leading-tight">Zaradera</h1>
                <p className="text-[10px] text-sidebar-foreground/60 leading-tight">Credit Limited</p>
              </div>
            )}
          </div>

          {/* Mobile close button */}
          <button
            onClick={onClose}
            className="lg:hidden p-1 rounded-md hover:bg-sidebar-accent/50 transition-colors"
          >
            <X className="w-5 h-5 text-sidebar-foreground/70" />
          </button>
        </div>

        <nav className="flex-1 py-4 px-2 space-y-1">
          {resolvedNavItems.map((item) => {
            const isActive = location.pathname === item.path ||
              (item.path !== '/dashboard' && location.pathname.startsWith(item.path));
            return (
              <Link
                key={item.id}
                to={item.path}
                onClick={handleNavClick}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50'
                )}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="p-2 border-t border-sidebar-border space-y-1">
          {!collapsed && user && (
            <div className="px-3 py-2 text-xs text-sidebar-foreground/50 truncate">{user.email}</div>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all w-full"
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {!collapsed && <span>Log out</span>}
          </button>
        </div>

        {/* Desktop collapse button */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden lg:flex absolute -right-3 top-20 w-6 h-6 rounded-full bg-card border border-border shadow-sm items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        >
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>
      </aside>
    </>
  );
}
