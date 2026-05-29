import { Copy, Inbox, Link as LinkIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

type PublicIntakeLinkCardProps = {
  title?: string;
  description?: string;
  showInboxLink?: boolean;
  className?: string;
};

export function PublicIntakeLinkCard({
  title = 'Public Intake',
  description = 'Copy the external intake link and share it with an investor without exposing the internal workflow.',
  showInboxLink = true,
  className,
}: Readonly<PublicIntakeLinkCardProps>) {
  const { toast } = useToast();
  const publicIntakeLink = `${globalThis.location.origin}/investor-intake`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(publicIntakeLink);
      toast({
        title: 'Copied',
        description: 'Public intake link copied to clipboard.',
      });
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Your browser blocked clipboard access.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card className={`glass-card ${className ?? ''}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base md:text-lg font-heading">
          <Inbox className="w-5 h-5 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="rounded-lg border bg-secondary/20 px-3 py-2 text-xs md:text-sm font-mono break-all text-foreground/80">
          {publicIntakeLink}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy}>
            <Copy className="w-4 h-4 mr-2" />
            Copy link
          </Button>
          <Button asChild size="sm">
            <a href={publicIntakeLink} target="_blank" rel="noreferrer">
              <LinkIcon className="w-4 h-4 mr-2" />
              Open form
            </a>
          </Button>
          {showInboxLink && (
            <Button asChild variant="ghost" size="sm">
              <Link to="/public-intake-inbox">Open inbox</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
