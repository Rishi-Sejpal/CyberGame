'use client';

import Link from 'next/link';
import { useAuth } from '@/components/auth/auth-provider';

interface LandingCTAProps {
  variant?: 'header' | 'hero';
}

export function LandingCTA({ variant = 'header' }: LandingCTAProps) {
  let isAuthenticated = false;
  try {
    const auth = useAuth();
    isAuthenticated = auth.isAuthenticated;
  } catch {
    // During static generation, AuthProvider context is not available
    // Default to unauthenticated state
  }

  if (variant === 'hero') {
    return (
      <Link
        href={isAuthenticated ? '/dashboard' : '/register'}
        className="btn btn-primary px-6 py-3"
      >
        {isAuthenticated ? 'Continue training' : 'Create a free callsign'}
      </Link>
    );
  }

  return isAuthenticated ? (
    <Link href="/dashboard" className="btn btn-primary px-4 py-2 text-xs">
      Enter the grid
    </Link>
  ) : (
    <>
      <Link href="/login" className="btn btn-ghost px-4 py-2 text-xs">
        Sign in
      </Link>
      <Link href="/register" className="btn btn-primary px-4 py-2 text-xs">
        Start free
      </Link>
    </>
  );
}
