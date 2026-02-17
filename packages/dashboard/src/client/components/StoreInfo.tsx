interface StoreInfoProps {
  type: string;
  capabilities: Record<string, boolean>;
}

export function StoreInfo({ type, capabilities }: StoreInfoProps) {
  const enabledCaps = Object.entries(capabilities)
    .filter(([, v]) => v)
    .map(([k]) => k.replace(/^can/, ''));

  return (
    <div className="store-info">
      <span className="store-badge">{type}</span>
      {enabledCaps.map((cap) => (
        <span key={cap} className="badge badge-info">
          {cap}
        </span>
      ))}
    </div>
  );
}
