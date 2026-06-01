import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Filter, Plus, Download, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { exportInvestors, useDeleteInvestor, useInvestorList } from '@/hooks/useInvestors';
import { formatDate, formatInvestorCurrency, getStatusColor } from '@/lib/format';
import { getInvestorCategoryBadgeClass, getInvestorCategoryShortLabel, INVESTOR_CATEGORY_OPTIONS } from '@/lib/investorCategories';
import { daysUntilMaturity } from '@/types/investment';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { getDefaultDashboardPath } from '@/lib/authRoutes';
import { ConfirmInvestorDeleteDialog } from '@/components/investors/ConfirmInvestorDeleteDialog';

export default function InvestorsList() {
  const [page, setPage] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [isExporting, setIsExporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { role } = useAuth();
  const canCreateInvestors = !!role;
  const deleteInvestor = useDeleteInvestor();
  const { data, isLoading } = useInvestorList({
    page,
    pageSize: 25,
    search,
    statusFilter,
    typeFilter,
    categoryFilter,
  });
  const investors = data?.data ?? [];
  const totalCount = data?.count ?? 0;
  const canDeleteInvestors = role === 'investment_manager' || role === 'general_manager' || role === 'admin' || role === 'super_admin';
  const isExecutiveViewer = role === 'admin' || role === 'super_admin';
  const emptyStateColSpan = (isExecutiveViewer ? 12 : 11) + (canDeleteInvestors ? 1 : 0);

  useEffect(() => {
    const urlSearch = searchParams.get('search') || '';
    setSearch(urlSearch);
    setSearchInput(urlSearch);
    setPage(0);
  }, [searchParams]);

  useEffect(() => {
    setPage(0);
  }, [statusFilter, typeFilter, categoryFilter]);

  const applySearch = () => {
    const normalizedSearch = searchInput.trim();
    const nextParams = new URLSearchParams(searchParams);

    if (normalizedSearch) {
      nextParams.set('search', normalizedSearch);
    } else {
      nextParams.delete('search');
    }

    setSearchParams(nextParams);
  };

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    applySearch();
  };

  const handleExport = async () => {
    try {
      setIsExporting(true);
      const allInvestors = await exportInvestors({
        search,
        statusFilter,
        typeFilter,
        categoryFilter,
      });

      if (allInvestors.length === 0) {
        toast({
          title: 'Nothing to export',
          description: 'There are no investors matching the current filters.',
        });
        return;
      }

      const escapeCsvValue = (value: string | number | null | undefined) => {
        const normalized = value == null ? '' : String(value);
        const escaped = normalized.replace(/"/g, '""');
        return `"${escaped}"`;
      };

      const headers = [
        'Reference',
        'Name',
        'Email',
        'Phone',
        'Created By',
        'Creator Role',
        'Investment Amount',
        'Expected Maturity Amount',
        'Investment Type',
        'Investor Category',
        'Interest Rate',
        'Maturity Date',
        'Client Bank',
        'Brought By',
        'Status',
        'Created At',
      ];

      const rows = allInvestors.map((investor) => [
        investor.reference_number,
        investor.name,
        investor.email,
        investor.phone,
        investor.creator?.displayName ?? '',
        investor.creator?.roleLabel ?? '',
        investor.investment_amount,
        investor.expected_maturity_amount,
        investor.investment_type,
        investor.investor_category,
        investor.percentage,
        investor.maturity_date,
        investor.client_bank,
        investor.brought_by,
        investor.liquidation_status,
        investor.created_at,
      ]);

      const csvContent = [
        headers.map(escapeCsvValue).join(','),
        ...rows.map((row) => row.map(escapeCsvValue).join(',')),
      ].join('\r\n');

      const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const exportDate = new Date().toISOString().split('T')[0];

      link.href = url;
      link.download = `investors-${exportDate}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: 'Export complete',
        description: `${allInvestors.length} investor records downloaded successfully.`,
      });
    } catch (error) {
      console.error('Failed to export investors:', error);
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : 'Could not export investor records.',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleDeleteInvestor = async (investorId: string, investorName: string) => {
    try {
      await deleteInvestor.mutateAsync(investorId);
      toast({
        title: 'Investor deleted',
        description: `${investorName} was removed successfully.`,
      });
      setDeleteTarget(null);
      navigate(getDefaultDashboardPath(role), { replace: true });
    } catch (error) {
      toast({
        title: 'Delete failed',
        description: error instanceof Error ? error.message : 'Could not delete the investor record.',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-16" /><Skeleton className="h-64" /></div>;
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold">Investors</h1>
          <p className="text-muted-foreground text-sm mt-1">{totalCount} investor records</p>
          <p className="text-xs text-muted-foreground mt-1">
            {role === 'admin' || role === 'super_admin'
              ? 'Executive dashboards can view every investor record and staff activity.'
              : 'Your dashboard only shows investors created by your signed-in account.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={handleExport} disabled={isExporting}>
            <Download className="w-4 h-4 mr-2" />
            {isExporting ? 'Exporting...' : 'Export'}
          </Button>
          {canCreateInvestors && (
            <Button size="sm" asChild><Link to="/investments/new"><Plus className="w-4 h-4 mr-2" />New Investment</Link></Button>
          )}
        </div>
      </div>

      <Card className="glass-card">
        <CardContent className="p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <form onSubmit={handleSearchSubmit} className="flex items-center gap-3 flex-1 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, bank, referrer..."
                  className="pl-9"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
              <Button type="submit" variant="outline" size="sm">
                Search
              </Button>
            </form>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]"><Filter className="w-4 h-4 mr-2" /><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Matured">Matured</SelectItem>
                <SelectItem value="Liquidated">Liquidated</SelectItem>
                <SelectItem value="Pending">Pending</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="Upfront">Upfront</SelectItem>
                <SelectItem value="Monthly">Monthly</SelectItem>
                <SelectItem value="Quarterly">Quarterly</SelectItem>
                <SelectItem value="At Maturity">At Maturity</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[170px]"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {INVESTOR_CATEGORY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.shortLabel} - {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Investor</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Reference</th>
                {isExecutiveViewer && <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Created By</th>}
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Amount</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Currency</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Category</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Type</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Rate</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Maturity</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Days Left</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Bank</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Status</th>
                {canDeleteInvestors && <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {investors.map((investor) => {
                const days = daysUntilMaturity(investor.maturity_date);
                return (
                  <tr key={investor.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                    <td className="px-4 py-3">
                      <Link to={`/investors/${investor.id}`} className="hover:text-accent transition-colors">
                        <p className="text-sm font-medium">{investor.name}</p>
                        <p className="text-xs text-muted-foreground">{investor.email}</p>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-muted-foreground">#{investor.reference_number}</td>
                    {isExecutiveViewer && (
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium">{investor.creator?.displayName ?? 'Unknown staff'}</p>
                        <p className="text-xs text-muted-foreground">{investor.creator?.roleLabel ?? 'Staff'}</p>
                      </td>
                    )}
                    <td className="px-4 py-3 text-sm font-medium">{formatInvestorCurrency(Number(investor.investment_amount), investor)}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{investor.currency_code ?? 'NGN'}</td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary" className={getInvestorCategoryBadgeClass(investor.investor_category)}>
                        {getInvestorCategoryShortLabel(investor.investor_category)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{investor.investment_type}</td>
                    <td className="px-4 py-3 text-sm">{investor.percentage}%</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{formatDate(investor.maturity_date)}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={days <= 5 && days >= 0 ? 'text-accent font-semibold' : ''}>
                        {days > 0 ? `${days}d` : days === 0 ? 'Today' : 'Passed'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{investor.client_bank}</td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary" className={getStatusColor(investor.liquidation_status)}>{investor.liquidation_status}</Badge>
                    </td>
                    {canDeleteInvestors && (
                      <td className="px-4 py-3 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={deleteInvestor.isPending}
                          onClick={() => setDeleteTarget({ id: investor.id, name: investor.name })}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {investors.length === 0 && (
                <tr>
                  <td colSpan={emptyStateColSpan} className="text-center text-muted-foreground py-12 text-sm">
                    {totalCount === 0 ? 'No investors yet. Add your first investment to get started.' : 'No investors found matching your criteria.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-4 border-t border-border/50">
          <p className="text-sm text-muted-foreground">
            Showing {investors.length} of {totalCount} investors
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0}>
              Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage((current) => current + 1)} disabled={investors.length < 25}>
              Next
            </Button>
          </div>
        </div>
      </Card>

      <ConfirmInvestorDeleteDialog
        open={!!deleteTarget}
        investorName={deleteTarget?.name ?? 'this investor'}
        isDeleting={deleteInvestor.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        onConfirm={() => {
          if (!deleteTarget) return;
          void handleDeleteInvestor(deleteTarget.id, deleteTarget.name);
        }}
      />
    </motion.div>
  );
}
