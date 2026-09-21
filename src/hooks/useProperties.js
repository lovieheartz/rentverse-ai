import { useCallback, useMemo, useRef, useState } from 'react';

import { fetchProperties, fetchFeaturedProperties, fetchProperty } from '../services/propertyApi';
import { useApiResource, useDebouncedValue } from './useApiResource';

/** Filter state shared by the listings page. Mirrors the server's query contract. */
export const DEFAULT_FILTERS = {
  search: '',
  type: 'all',
  fundingStage: 'all',
  minPriceUsd: '',
  maxPriceUsd: '',
  minRoiPct: '',
  maxRoiPct: '',
  sortBy: 'newest',
  page: 1,
  limit: 6,
};

/** Drops defaults and empty values so the request carries only real filters. */
function toQueryFilters(filters) {
  const query = {};

  if (filters.search.trim()) query.search = filters.search.trim();
  if (filters.type !== 'all') query.type = filters.type;
  if (filters.fundingStage !== 'all') query.fundingStage = filters.fundingStage;
  if (filters.minPriceUsd !== '') query.minPriceUsd = filters.minPriceUsd;
  if (filters.maxPriceUsd !== '') query.maxPriceUsd = filters.maxPriceUsd;
  if (filters.minRoiPct !== '') query.minRoiPct = filters.minRoiPct;
  if (filters.maxRoiPct !== '') query.maxRoiPct = filters.maxRoiPct;

  query.sortBy = filters.sortBy;
  query.page = filters.page;
  query.limit = filters.limit;

  return query;
}

/**
 * Filterable, paginated property list.
 *
 * Text and numeric inputs are debounced so typing does not fire a request per keystroke,
 * while selects and page changes apply immediately.
 */
export function useProperties(initialFilters = {}) {
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS, ...initialFilters });

  // Captured once so `resetFilters` stays referentially stable across renders.
  const initialFiltersRef = useRef(initialFilters);

  const debouncedSearch = useDebouncedValue(filters.search, 350);
  const debouncedMinPrice = useDebouncedValue(filters.minPriceUsd, 500);
  const debouncedMaxPrice = useDebouncedValue(filters.maxPriceUsd, 500);
  const debouncedMinRoi = useDebouncedValue(filters.minRoiPct, 500);
  const debouncedMaxRoi = useDebouncedValue(filters.maxRoiPct, 500);

  const effectiveFilters = useMemo(
    () => ({
      ...filters,
      search: debouncedSearch,
      minPriceUsd: debouncedMinPrice,
      maxPriceUsd: debouncedMaxPrice,
      minRoiPct: debouncedMinRoi,
      maxRoiPct: debouncedMaxRoi,
    }),
    [filters, debouncedSearch, debouncedMinPrice, debouncedMaxPrice, debouncedMinRoi, debouncedMaxRoi]
  );

  const queryFilters = useMemo(() => toQueryFilters(effectiveFilters), [effectiveFilters]);
  const queryKey = useMemo(() => JSON.stringify(queryFilters), [queryFilters]);

  const fetcher = useCallback((signal) => fetchProperties(queryFilters, signal), [queryFilters]);
  const resource = useApiResource(fetcher, queryKey, { initialData: [] });

  /** Any filter change resets to page 1; paging is the one change that does not. */
  const updateFilter = useCallback((field, value) => {
    setFilters((previous) => ({
      ...previous,
      [field]: value,
      ...(field === 'page' ? {} : { page: 1 }),
    }));
  }, []);

  const resetFilters = useCallback(
    () => setFilters({ ...DEFAULT_FILTERS, ...initialFiltersRef.current }),
    []
  );

  const activeFilterCount = useMemo(
    () =>
      Object.entries(toQueryFilters(filters)).filter(
        ([key]) => !['sortBy', 'page', 'limit'].includes(key)
      ).length,
    [filters]
  );

  return {
    properties: resource.data || [],
    pagination: resource.meta.pagination,
    appliedFilters: resource.meta.appliedFilters,
    isLoading: resource.isLoading,
    error: resource.error,
    refetch: resource.refetch,
    filters,
    updateFilter,
    resetFilters,
    activeFilterCount,
  };
}

/** Featured listings for the home page. */
export function useFeaturedProperties(limit = 3) {
  const fetcher = useCallback((signal) => fetchFeaturedProperties(limit, signal), [limit]);
  return useApiResource(fetcher, `featured:${limit}`, { initialData: [] });
}

/**
 * One property by id.
 *
 * The id genuinely drives the request - the detail page previously ignored the route
 * parameter and always rendered the same hardcoded listing.
 */
export function useProperty(id) {
  const fetcher = useCallback((signal) => fetchProperty(id, signal), [id]);
  return useApiResource(fetcher, `property:${id}`, { enabled: Boolean(id) });
}
