import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import Button from './Button';
import { cx } from './cx';

export interface RecordCounterProps {
  /** Current 1-based page. */
  page: number;
  /** Rows per page. */
  pageSize: number;
  /** Total record count across all pages. */
  total: number;
  /** Called with the new page number. */
  onPageChange: (page: number) => void;
  /** Called with the new page size. Omit to hide the size selector. */
  onPageSizeChange?: (size: number) => void;
  /** Choices for the size selector. */
  pageSizeOptions?: number[];
  className?: string;
}

const DEFAULT_SIZES = [25, 50, 100, 200];

/** "Showing 1–50 of 238" + pagination controls + page-size selector. */
export default function RecordCounter({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_SIZES,
  className,
}: RecordCounterProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);

  return (
    <div className={cx('pc-record-counter', className)}>
      <span className="pc-record-counter__count">
        {total === 0 ? (
          'No records'
        ) : (
          <>
            Showing <strong>{from}–{to}</strong> of <strong>{total}</strong>
          </>
        )}
      </span>

      <div className="pc-pagination">
        {onPageSizeChange && (
          <span className="pc-pagination__size">
            <select
              className="pc-select"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              aria-label="Rows per page"
            >
              {pageSizeOptions.map((s) => (
                <option key={s} value={s}>
                  {s} / page
                </option>
              ))}
            </select>
          </span>
        )}
        <Button
          variant="secondary"
          size="sm"
          iconOnly
          aria-label="First page"
          disabled={safePage <= 1}
          onClick={() => onPageChange(1)}
        >
          <ChevronsLeft size={16} />
        </Button>
        <Button
          variant="secondary"
          size="sm"
          iconOnly
          aria-label="Previous page"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
        >
          <ChevronLeft size={16} />
        </Button>
        <span className="pc-pagination__label">
          Page {safePage} of {totalPages}
        </span>
        <Button
          variant="secondary"
          size="sm"
          iconOnly
          aria-label="Next page"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
        >
          <ChevronRight size={16} />
        </Button>
        <Button
          variant="secondary"
          size="sm"
          iconOnly
          aria-label="Last page"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(totalPages)}
        >
          <ChevronsRight size={16} />
        </Button>
      </div>
    </div>
  );
}
