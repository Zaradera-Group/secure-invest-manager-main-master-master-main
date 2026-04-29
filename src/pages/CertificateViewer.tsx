import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCertificatePreviewUrl, getCertificateSignedDownloadUrl } from '@/hooks/useCertificates';

export default function CertificateViewer() {
  const { id } = useParams<{ id: string }>();

  const {
    data: previewUrl,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['certificate-preview-viewer', id],
    enabled: !!id,
    queryFn: async () => {
      if (!id) {
        throw new Error('Certificate id is required.');
      }

      return getCertificatePreviewUrl(id);
    },
  });

  const {
    data: downloadUrl,
    isLoading: isLoadingDownloadUrl,
  } = useQuery({
    queryKey: ['certificate-download-viewer', id],
    enabled: !!id,
    queryFn: async () => {
      if (!id) {
        throw new Error('Certificate id is required.');
      }

      return getCertificateSignedDownloadUrl(id);
    },
  });

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-heading font-bold">Certificate Viewer</h1>
          <p className="text-sm text-muted-foreground mt-1">
            View the generated certificate directly in the app.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button asChild variant="outline">
            <Link to="/certificates">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Certificates
            </Link>
          </Button>
          {downloadUrl && (
            <Button asChild>
              <a href={downloadUrl} target="_blank" rel="noreferrer">
                <Download className="w-4 h-4 mr-2" />
                Download
              </a>
            </Button>
          )}
        </div>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Certificate Preview</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground py-10">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading certificate preview...
            </div>
          )}

          {error && (
            <div className="space-y-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4">
              <p className="text-sm text-destructive">
                {error instanceof Error ? error.message : 'Failed to load certificate preview.'}
              </p>
              {downloadUrl && (
                <Button asChild variant="outline" size="sm">
                  <a href={downloadUrl} target="_blank" rel="noreferrer">
                    <Download className="w-4 h-4 mr-2" />
                    Open Download Link
                  </a>
                </Button>
              )}
            </div>
          )}

          {!isLoading && !error && previewUrl && (
            <iframe
              src={previewUrl}
              title="Certificate Preview"
              className="w-full min-h-[75vh] rounded-lg border bg-white"
            />
          )}

          {!isLoading && !error && !previewUrl && (
            <p className="text-sm text-muted-foreground">Certificate preview is not available yet.</p>
          )}

          {!downloadUrl && isLoadingDownloadUrl && (
            <p className="text-xs text-muted-foreground mt-3">Preparing download link...</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
