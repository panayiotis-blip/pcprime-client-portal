import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

export type Query<T> = {
  data: T | null;
  error: string | null;
  /** True only on the first load; a refetch keeps the old data on screen. */
  loading: boolean;
  refreshing: boolean;
  reload: () => void;
};

/**
 * Fetch on mount, and again whenever the screen comes back into focus.
 *
 * Refocus matters here: an accountant ticks a task, walks to another tab and
 * comes back expecting the count to be right. Keeping the previous data
 * visible during a refetch avoids a spinner flashing over content that is
 * about to be identical.
 */
export function useQuery<T>(fetcher: () => Promise<T>, deps: unknown[] = []): Query<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Kept in a ref so the effect below does not re-run on every render when the
  // caller passes an inline arrow function.
  const run = useRef(fetcher);
  run.current = fetcher;

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (first: boolean) => {
    if (first) setLoading(true);
    else setRefreshing(true);

    try {
      const next = await run.current();
      if (!mounted.current) return;
      setData(next);
      setError(null);
    } catch (caught) {
      if (!mounted.current) return;
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const loaded = useRef(false);

  useFocusEffect(
    useCallback(() => {
      load(!loaded.current);
      loaded.current = true;
    }, [load]),
  );

  // A dependency change (a different client, say) is a fresh load, not a
  // refresh of the same thing.
  useEffect(() => {
    loaded.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, refreshing, reload: () => load(false) };
}
