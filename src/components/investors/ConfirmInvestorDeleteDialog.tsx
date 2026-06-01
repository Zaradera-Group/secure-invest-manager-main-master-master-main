import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ConfirmInvestorDeleteDialogProps {
  open: boolean;
  investorName: string;
  isDeleting?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function ConfirmInvestorDeleteDialog({
  open,
  investorName,
  isDeleting = false,
  onOpenChange,
  onConfirm,
}: Readonly<ConfirmInvestorDeleteDialogProps>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="backdrop-blur-sm border border-red-200/80 bg-white/95 shadow-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-red-700">Delete investor permanently?</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            This will completely delete <span className="font-semibold text-foreground">{investorName}</span> from the system, including the backend records and related certificate data. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          Are you sure you want to continue? The investor will be removed from the dashboard, database, and workflow history.
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? 'Deleting...' : 'Continue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
