import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Generic loader for a GET endpoint.
 *
 * Handles the four things every data-fetching component in this app needs and that the
 * original pages did not have at all (they rendered hardcoded arrays):
 *
 *  - loading / error / empty states a component can render directly;
 *  - abort on unmount and on argument change, so a slow first response cannot overwrite a
 *    newer one (the classic out-of-order render bug);
 *  - `refetch()` for a retry button;
 *  - a stable `key` so callers control exactly when a reload happens.
 *
 * @param {(signal: AbortSignal) => Promise<{data: *, meta: object}>} fetcher
 * @param {string} key Changing this re-runs the fetch. Serialise arguments into it.
 * @param {object} [options]
 * @param {boolean} [options.enabled=true] Skip fetching while false.
 * @param {*} [options.initialData=null]
 */
export function useApiResource(fetcher, key, { enabled = true, initialData = null } = {}) {
  const [data, setData] = useState(initialData);
  const [meta, setMeta] = useState({});
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [reloadToken, setReloadToken] = useState(0);

  // Held in a ref so changing the fetcher identity between renders does not restart the
  // request; `key` is the single source of truth for when to refetch.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    let active = true;

    setIsLoading(true);
    setError(null);

    fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (!active) return;
        setData(result.data);
        setMeta(result.meta || {});
      })
      .catch((caught) => {
        // An aborted request was superseded or unmounted - not a failure to report.
        if (!active || controller.signal.aborted) return;
        setError(caught);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [key, enabled, reloadToken]);

  const refetch = useCallback(() => setReloadToken((token) => token + 1), []);

  return { data, meta, error, isLoading, refetch };
}

/**
 * Delays propagation of a rapidly changing value.
 * Used so typing in a filter does not fire a request per keystroke.
 */
export function useDebouncedValue(value, delayMs = 350) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
