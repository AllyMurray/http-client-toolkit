import { useState, useEffect, useCallback, useRef } from 'react';

export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  enabled: boolean = true,
): {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  refresh: () => void;
} {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const result = await fetcher();
      if (mountedRef.current) {
        setData(result);
        setError(undefined);
        setLoading(false);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setLoading(false);
      }
    }
  }, [fetcher]);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return;

    fetchData();
    const id = setInterval(fetchData, intervalMs);

    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [fetchData, intervalMs, enabled]);

  return { data, error, loading, refresh: fetchData };
}
