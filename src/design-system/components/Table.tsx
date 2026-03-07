import type { HTMLAttributes, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cx } from '../utils/cx';

export function DataTable({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="ds-table-container">
      <table className={cx('ds-table', className)} {...props} />
    </div>
  );
}

export function DataTableHead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cx('ds-table-head', className)} {...props} />;
}

export function DataTableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cx('ds-table-body', className)} {...props} />;
}

export function DataTableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cx('ds-table-row', className)} {...props} />;
}

export function DataTableHeaderCell({
  className,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cx('ds-table-header-cell', className)} {...props} />;
}

export function DataTableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cx('ds-table-cell', className)} {...props} />;
}
