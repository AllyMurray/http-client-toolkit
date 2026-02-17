import type { ReactNode } from 'react';

interface Column<T> {
  key: string;
  header: string;
  render: (item: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Array<Column<T>>;
  data: Array<T>;
  keyExtractor: (item: T) => string;
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
}: DataTableProps<T>) {
  if (data.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">No data</div>
        <div className="empty-state-desc">Nothing to display yet.</div>
      </div>
    );
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key}>{col.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((item) => (
          <tr key={keyExtractor(item)}>
            {columns.map((col) => (
              <td key={col.key}>{col.render(item)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
