'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/primitives';
import { Alert } from '@/components/ui/primitives';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Global Error]', error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center bg-void px-4">
        <Alert tone="error" className="max-w-md">
          <div className="text-center">
            <p className="font-display text-lg mb-2">Application error</p>
            <p className="text-xs text-ink-dim mb-4">
              A critical error occurred. Please refresh the page.
            </p>
            <Button variant="primary" onClick={reset}>
              Refresh
            </Button>
          </div>
        </Alert>
      </body>
    </html>
  );
}
