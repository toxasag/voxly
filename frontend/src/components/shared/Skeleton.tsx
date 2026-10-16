import { cn } from "@/lib/utils";

/**
 * Loading placeholder.
 *
 * shadcn/ui is not installed in this project, so this is a standalone
 * implementation using the same API (`<Skeleton className="h-12 w-full" />`)
 * as the shadcn primitive the PRD references. Swapping to the real one later
 * needs no call-site changes.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-slate-800", className)}
    />
  );
}

/** Table-shaped skeleton, sized to match the row height of a loaded table. */
/** Сколько колонок скелетона видно на мобильном: столько же влезает в таблицу. */
const MOBILE_SKELETON_COLUMNS = 2;

export function SkeletonTable({
  rows = 6,
  columns = 6,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div
      className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden"
      role="status"
      aria-label="Загрузка данных"
    >
      <div className="border-b border-slate-800 px-4 py-3">
        <div className="flex gap-4">
          {Array.from({ length: columns }, (_, i) => (
            <Skeleton key={i} className={cn("h-3 flex-1", columnVisibility(i))} />
          ))}
        </div>
      </div>
      <div className="divide-y divide-slate-800">
        {Array.from({ length: rows }, (_, rowIndex) => (
          <div key={rowIndex} className="flex items-center gap-4 px-4 py-4">
            {Array.from({ length: columns }, (_, colIndex) => (
              <Skeleton
                key={colIndex}
                className={cn(
                  "h-4 flex-1",
                  colIndex === 0 && "max-w-[180px]",
                  columnVisibility(colIndex),
                )}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Лишние колонки скелетона скрываются на мобильном.
 *
 * `AGENTS.md` требует, чтобы скелетон повторял форму страницы, а
 * `SkeletonTable rows={5} columns={6}` рисовал шесть колонок там, где в таблицу
 * влезает две: шесть полос по 50px не похожи ни на что и обещают раскладку,
 * которой после загрузки не будет.
 *
 * Классами, а не хуком: это структура, и при SSR хук дал бы вспышку шести
 * колонок на телефоне — ровно то, от чего избавляемся.
 */
function columnVisibility(index: number): string | false {
  return index >= MOBILE_SKELETON_COLUMNS && "hidden md:block";
}
