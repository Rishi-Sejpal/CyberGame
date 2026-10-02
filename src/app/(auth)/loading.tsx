import { SkeletonCard } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md animate-fade-up">
        <SkeletonCard />
      </div>
    </div>
  );
}
