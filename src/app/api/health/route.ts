import { NextResponse } from 'next/server';
import { isDbConnected } from '@/server/db/connect';

/**
 * Health check endpoint for load balancers / container orchestration.
 * Returns 200 if the app and database are reachable.
 */
export async function GET(): Promise<NextResponse> {
  const dbOk = isDbConnected();

  return NextResponse.json(
    {
      status: dbOk ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        database: dbOk ? 'up' : 'down',
      },
    },
    {
      status: dbOk ? 200 : 503,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    },
  );
}
