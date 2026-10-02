'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/primitives';
import { Alert } from '@/components/ui/primitives';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Auth Error]', error);
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Alert tone="error">
          <div className="text-center">
            <p className="font-display text-lg mb-2">Something went wrong</p>
            <p className="text-xs text-ink-dim mb-4">
              We couldn&apos;t load this page. Please try again.
            </p>
            <Button variant="primary" onClick={reset} fullWidth>
              Try again
            </Button>
          </div>
        </Alert>
      </div>
    </div>
  );
}
