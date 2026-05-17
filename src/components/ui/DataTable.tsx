import type { ReactNode } from 'react';
import RecordCounter from './RecordCounter';
import EmptyState from './EmptyState';
import { cx } from './cx';

export interface Column<T> {
  /** Unique key for the column. */
  key: string;
  /** Header cell content. */
  header: ReactNode;
  /** Cell renderer. Receives the row. */
  render: (row: T) => ReactNode;
  /** Optional fixed width (number = px). */
  width?: number | string;
  /** Cell text alignment. */
  align?: 'left' | 'center' | 'right';
}

export interface DataTablePagination {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  /** Stable id for each row (used as React key + selection match). */
  getRowId: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  /** Row id to highlight as selected. */
  selectedId?: string | number | null;
  /** Sticky header on vertical scroll. Defaults to true. */
  stickyHeader?: boolean;
  /** Zebra striping. Defaults to false. */
  striped?: boolean;
  /** Caps the scroll area height (number = px); enables internal scroll. */
  maxHeight?: number | string;
  /** Shown when `rows` is empty. */
  empty?: ReactNode;
  /** Pagination footer. Omit for no footer. */
  pagination?: DataTablePagination;
  className?: string;
}

/** Generic table: sticky header, optional pagination footer + empty state. */
export default function DataTable<T>({
  columns,
  rows,
  getRowId,
  onRowClick,
  selectedId,
  stickyHeader = true,
  striped = false,
  maxHeight,
  empty,
  pagination,
  className,
}: DataTableProps<T>) {
  return (
    <div className={cx('pc-table-wrap', className)}>
      <div
        className="pc-table-scroll"
        style={maxHeight != null ? { maxHeight } : undefined}
      >
        <table className={cx('pc-table', stickyHeader && 'pc-table--sticky', striped && 'pc-table--striped')}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={{
                    width: c.width,
                    textAlign: c.align ?? 'left',
                  }}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="pc-table__empty-cell" colSpan={columns.length}>
                  {empty ?? <EmptyState title="Nothing to show" />}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const id = getRowId(row);
                return (
                  <tr
                    key={id}
                    className={cx(
                      onRowClick && 'pc-table__row--clickable',
                      selectedId != null && selectedId === id && 'pc-table__row--selected',
                    )}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {columns.map((c) => (
                      <td key={c.key} style={{ textAlign: c.align ?? 'left' }}>
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {pagination && (
        <RecordCounter
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          onPageChange={pagination.onPageChange}
          onPageSizeChange={pagination.onPageSizeChange}
          pageSizeOptions={pagination.pageSizeOptions}
        />
      )}
    </div>
  );
}
