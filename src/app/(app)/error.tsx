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
    console.error('[App Error]', error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4">
      <Alert tone="error" className="max-w-md">
        <div className="text-center">
          <p className="font-display text-lg mb-2">Something went wrong</p>
          <p className="text-xs text-ink-dim mb-4">
            We couldn&apos;t load this page. The team has been notified.
          </p>
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
        </div>
      </Alert>
    </div>
  );
}
