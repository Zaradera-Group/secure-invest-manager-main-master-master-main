import { motion } from 'framer-motion';
import { AlertTriangle, ArrowLeft, Clock3 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function SettlementDiscrepancies() {
  const navigate = useNavigate();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-heading font-bold">Reconciliation</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Exception handling and settlement tools for reconciliation issues.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
      </div>

      <Card className="glass-card border-amber-300/50 bg-gradient-to-br from-amber-50 to-orange-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-amber-900">
            <AlertTriangle className="w-5 h-5" />
            Feature Preview
          </CardTitle>
        </CardHeader>
        <CardContent className="py-14">
          <div className="mx-auto max-w-2xl text-center space-y-5">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <Clock3 className="w-8 h-8" />
            </div>
            <div className="space-y-3">
              <p className="text-4xl md:text-5xl font-heading font-bold tracking-tight text-amber-950">
                COMING SOON
              </p>
              <p className="text-sm md:text-base text-amber-900/80">
                The settlement of discrepancies workspace is being prepared and will be available in a future release.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
