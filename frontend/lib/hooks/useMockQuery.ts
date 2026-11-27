"use client";

import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";

export interface QueryState<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  refetch: () => Promise<void>;
  setData: (updater: T | ((prev: T | undefined) => T)) => void;
}

/**
 * Minimal async loader for the mock API (loading / error / data).
 * Swap for TanStack Query / SWR later without changing call sites much.
 */
export function useMockQuery<T>(fn: () => Promise<T>, deps: DependencyList = []): QueryState<T> {
  const [data, setDataState] = useState<T>();
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  const reqId = useRef(0);

  useEffect(() => {
    fnRef.current = fn;
  });

  /** Fetch and settle state from async callbacks only. */
  const load = useCallback((call: () => Promise<T>) => {
    const id = ++reqId.current;
    return call().then(
      (res) => {
        if (id !== reqId.current) return;
        setDataState(res);
        setError(null);
        setLoading(false);
      },
      (e: unknown) => {
        if (id !== reqId.current) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    void load(fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const refetch = useCallback(async () => {
    setLoading(true);
    await load(fnRef.current);
  }, [load]);

  const setData = useCallback((u: T | ((prev: T | undefined) => T)) => {
    setDataState((prev) => (typeof u === "function" ? (u as (p: T | undefined) => T)(prev) : u));
  }, []);

  return { data, error, loading, refetch, setData };
}

/** Wrap a mutation with pending + error state. */
export function useMockMutation<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mutate = useCallback(
    async (...args: A): Promise<R> => {
      setPending(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setPending(false);
      }
    },
    [fn],
  );
  return { mutate, pending, error };
}
