import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';
import type { HealthResponse } from '../api/types.js';

export function useStores() {
  const [health, setHealth] = useState<HealthResponse | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  const fetchHealth = useCallback(async () => {
    try {
      const result = await api.health();
      setHealth(result);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  return { health, error, loading, refresh: fetchHealth };
}
