'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Alert, Button } from '@/components/ui/primitives';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] caught error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex min-h-[300px] items-center justify-center px-4">
          <Alert tone="error" className="max-w-md">
            <div className="text-center">
              <p className="font-display text-sm mb-2">Something went wrong</p>
              <p className="text-xs text-ink-dim mb-4">
                {this.state.error?.message ??
                  'An unexpected error occurred. The development team has been notified.'}
              </p>
              <Button
                variant="primary"
                onClick={() => this.setState({ hasError: false, error: null })}
              >
                Try again
              </Button>
            </div>
          </Alert>
        </div>
      );
    }

    return this.props.children;
  }
}

export function PageErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <div className="flex min-h-[400px] items-center justify-center px-4">
          <Alert tone="error" className="max-w-lg">
            <div className="text-center">
              <p className="font-display text-lg mb-2">Page unavailable</p>
              <p className="text-xs text-ink-dim mb-4">
                This page failed to load. Please try refreshing or navigate elsewhere.
              </p>
            </div>
          </Alert>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

export function SectionErrorBoundary({ title, children }: { title: string; children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <div className="panel p-4">
          <Alert tone="error" className="mb-2">
            <p className="font-semibold">{title} unavailable</p>
            <p className="text-xs text-ink-dim">This section failed to load.</p>
          </Alert>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}
