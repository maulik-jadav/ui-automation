export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-700/60 ${className}`}
      aria-hidden
    />
  );
}

export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={`h-4 ${i === count - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}
