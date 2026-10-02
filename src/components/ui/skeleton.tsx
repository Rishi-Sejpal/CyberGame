'use client';

import { cn } from '@/lib/utils';

/**
 * Loading skeleton that mimics the shape of content.
 * Reduces perceived latency and prevents layout shift.
 */

export function Skeleton({
  className,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { width?: string | number; height?: string | number }) {
  return (
    <div
      className={cn('animate-pulse bg-line/50 rounded', className)}
      style={{ ...style, width: props.width, height: props.height }}
      aria-hidden="true"
      {...props}
    />
  );
}

export function SkeletonText({
  lines = 3,
  className,
  ...props
}: { lines?: number; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('space-y-2', className)} {...props}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={12} width={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </div>
  );
}

export function SkeletonCard({
  className,
  ...props
}: { className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('panel p-5 space-y-4', className)} {...props}>
      <div className="flex items-center gap-3">
        <Skeleton width={40} height={40} className="rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton height={16} width="40%" />
          <Skeleton height={12} width="60%" />
        </div>
      </div>
      <SkeletonText lines={2} />
    </div>
  );
}

export function SkeletonStat({
  className,
  ...props
}: { className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('panel-inset px-4 py-3', className)} {...props}>
      <Skeleton height={10} width="80%" />
      <Skeleton height={28} width="60%" className="mt-2" />
    </div>
  );
}

export function SkeletonTable({
  rows = 5,
  columns = 4,
  className,
  ...props
}: { rows?: number; columns?: number; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('panel p-5', className)} {...props}>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {/* Header row */}
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={`h-${i}`} height={12} width="80%" />
        ))}
        {/* Data rows */}
        {Array.from({ length: rows }).map((_, r) =>
          Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={`r${r}-c${c}`} height={16} width="90%" />
          )),
        )}
      </div>
    </div>
  );
}

export function SkeletonList({
  items = 5,
  className,
  ...props
}: { items?: number; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('space-y-3', className)} {...props}>
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton width={40} height={40} className="rounded-full" />
          <div className="flex-1 space-y-1">
            <Skeleton height={14} width="50%" />
            <Skeleton height={10} width="30%" />
          </div>
        </div>
      ))}
    </div>
  );
}
