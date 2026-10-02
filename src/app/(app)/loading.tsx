import { SkeletonCard, SkeletonStat, SkeletonText } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-5 animate-fade-up">
      <header className="space-y-2">
        <SkeletonText lines={1} className="max-w-xs" />
        <SkeletonText lines={1} className="max-w-md" />
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SkeletonStat />
        <SkeletonStat />
        <SkeletonStat />
        <SkeletonStat />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SkeletonCard />
        </div>
        <div>
          <SkeletonCard />
        </div>
      </div>

      <SkeletonCard />
    </div>
  );
}
