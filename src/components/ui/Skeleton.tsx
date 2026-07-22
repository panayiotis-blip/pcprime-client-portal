import { cx } from './cx';

export interface SkeletonProps {
  /** CSS width, e.g. '100%', 240. Defaults to '100%'. */
  width?: string | number;
  /** CSS height, e.g. 14, '2rem'. Defaults to 14px (one text line). */
  height?: string | number;
  /** Fully rounded — for avatars and pills. */
  circle?: boolean;
  className?: string;
}

/**
 * A single shimmering placeholder block. Prefer the composed helpers below —
 * they keep loading states consistent across the portal.
 */
export function Skeleton({ width = '100%', height = 14, circle = false, className }: SkeletonProps) {
  return (
    <span
      className={cx('pc-skel', circle && 'pc-skel--circle', className)}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

/** A paragraph of placeholder lines; the last line is short, as real text is. */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <span className="pc-skel-stack">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </span>
  );
}

/** Placeholder rows for a table-shaped panel. */
export function SkeletonTable({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="pc-skel-table" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div
          className="pc-skel-row"
          key={r}
          style={{ ['--pc-skel-cols' as string]: Math.max(1, cols - 1) }}
        >
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} height={12} width={c === 0 ? '22%' : undefined} />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Whole-panel placeholder. Used as the Suspense fallback for lazily-loaded
 * routes (the sidebar and header stay put — only this panel swaps) and as the
 * loading state for tabs that previously rendered blank.
 */
export default function PanelSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="pc-skel-panel" role="status" aria-label="Loading">
      <Skeleton width="34%" height={20} />
      <SkeletonTable rows={rows} />
    </div>
  );
}
