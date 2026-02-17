interface StatsCardProps {
  label: string;
  value: string | number;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}

export function StatsCard({
  label,
  value,
  variant = 'default',
}: StatsCardProps) {
  return (
    <div className="stat-card">
      <div className="stat-card-label">{label}</div>
      <div
        className={`stat-card-value ${variant !== 'default' ? variant : ''}`}
      >
        {value}
      </div>
    </div>
  );
}
