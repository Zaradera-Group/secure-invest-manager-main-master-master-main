import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AppSidebar } from './AppSidebar';
import { Bell, Search, Menu, Settings } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useUnreadDashboardNotificationCount } from '@/hooks/useDashboardNotifications';
import { rememberRoute } from '@/lib/authRoutes';

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const { user, role } = useAuth();
  const { data: unreadNotificationCount = 0 } = useUnreadDashboardNotificationCount();

  useEffect(() => {
    const currentPath = `${location.pathname}${location.search}${location.hash}`;
    const shouldRemember =
      currentPath !== '/'
      && currentPath !== '/login'
      && currentPath !== '/landing'
      && currentPath !== '/splash';

    if (shouldRemember) {
      rememberRoute(role, currentPath);
    }
  }, [location.hash, location.pathname, location.search, role]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      // Navigate to investors page with query parameter
      navigate(`/investors?search=${encodeURIComponent(searchQuery)}`);
      setSearchQuery('');
    }
  };

  const handleNotifications = () => {
    navigate('/notifications');
  };

  const handleSettings = () => {
    navigate('/settings');
  };

  const handleProfile = () => {
    navigate('/profile');
  };

  const getInitials = () => {
    if (user?.user_metadata?.full_name) {
      return user.user_metadata.full_name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    return user?.email?.charAt(0).toUpperCase() || 'U';
  };

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="lg:pl-[250px] transition-all duration-300">
        {/* Top bar */}
        <header className="sticky top-0 z-30 h-16 bg-background/80 backdrop-blur-md border-b border-border flex items-center justify-between px-3 sm:px-4 lg:px-6">
          <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              className="lg:hidden h-9 w-9 p-0 shrink-0"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-4 h-4 sm:w-5 sm:h-5" />
            </Button>
            <form onSubmit={handleSearch} className="relative hidden sm:block w-48 md:w-64 lg:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground cursor-pointer hover:text-foreground transition-colors" />
              <Input
                placeholder="Search investors, investments..."
                className="pl-9 bg-secondary/50 border-0 focus-visible:ring-1 text-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </form>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 lg:gap-4 shrink-0">
            <button
              onClick={handleNotifications}
              className="relative p-2 rounded-lg hover:bg-secondary transition-colors h-9 w-9 flex items-center justify-center"
              aria-label="Notifications"
            >
              <Bell className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground hover:text-foreground" />
              {unreadNotificationCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-[10px] font-semibold text-accent-foreground flex items-center justify-center">
                  {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                </span>
              )}
            </button>
            <button
              onClick={handleSettings}
              className="relative p-2 rounded-lg hover:bg-secondary transition-colors h-9 w-9 flex items-center justify-center"
              aria-label="Settings"
            >
              <Settings className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground hover:text-foreground" />
            </button>
            <button
              onClick={handleProfile}
              className="flex items-center gap-2 sm:gap-3 rounded-lg hover:bg-secondary p-1.5 sm:p-2 transition-colors cursor-pointer"
              aria-label="Profile"
            >
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-semibold shrink-0">
                {getInitials()}
              </div>
              <div className="hidden md:block min-w-0">
                <p className="text-xs sm:text-sm font-medium leading-tight truncate">{user?.user_metadata?.full_name || 'User'}</p>
                <p className="text-xs text-muted-foreground leading-tight truncate">{user?.email}</p>
              </div>
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
