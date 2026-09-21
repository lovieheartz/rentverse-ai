import { useState } from 'react';
import { FiChevronLeft, FiChevronRight, FiFilter, FiSearch, FiX } from 'react-icons/fi';

import PropertyCard from '../components/property/PropertyCard';
import { EmptyState, ErrorState, SkeletonGrid } from '../components/common/StateViews';
import { useProperties } from '../hooks/useProperties';

/**
 * Investment listings.
 *
 * Filtering, sorting and pagination now run on the server. The page holds filter state,
 * sends it, and renders the response - so results are consistent with every other surface
 * and the browser is never asked to filter a page of data it cannot see past.
 */

const PROPERTY_TYPES = [
  { value: 'all', label: 'All types' },
  { value: 'house', label: 'House' },
  { value: 'apartment', label: 'Apartment' },
  { value: 'villa', label: 'Villa' },
  { value: 'commercial', label: 'Commercial' },
];

const FUNDING_STAGES = [
  { value: 'all', label: 'All stages' },
  { value: 'new', label: 'New listings' },
  { value: 'active', label: 'Active funding' },
  { value: 'almost_funded', label: 'Almost funded' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'priceAsc', label: 'Price: low to high' },
  { value: 'priceDesc', label: 'Price: high to low' },
  { value: 'roiDesc', label: 'Highest total return' },
  { value: 'fundingDesc', label: 'Most funded' },
];

function Pagination({ pagination, onChange }) {
  if (!pagination || pagination.pageCount <= 1) return null;

  const { page, pageCount, hasPreviousPage, hasNextPage, totalItems } = pagination;

  return (
    <nav className="flex items-center justify-between mt-8 flex-wrap gap-4" aria-label="Pagination">
      <p className="text-sm text-secondary-600">
        Page {page} of {pageCount} &middot; {totalItems} listing{totalItems === 1 ? '' : 's'}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-secondary disabled:opacity-50"
          onClick={() => onChange(page - 1)}
          disabled={!hasPreviousPage}
        >
          <FiChevronLeft className="mr-1" aria-hidden="true" />
          Previous
        </button>
        <button
          type="button"
          className="btn-secondary disabled:opacity-50"
          onClick={() => onChange(page + 1)}
          disabled={!hasNextPage}
        >
          Next
          <FiChevronRight className="ml-1" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

function Properties() {
  const [showFilters, setShowFilters] = useState(false);
  const {
    properties,
    pagination,
    isLoading,
    error,
    refetch,
    filters,
    updateFilter,
    resetFilters,
    activeFilterCount,
  } = useProperties();

  const hasResults = properties.length > 0;

  return (
    <div className="min-h-screen bg-secondary-50">
      <div className="bg-white shadow">
        <div className="container py-6">
          <div className="flex justify-between items-center gap-4 flex-wrap">
            <div>
              <h1 className="text-3xl font-bold">Investment properties</h1>
              <p className="text-secondary-600 mt-1">
                {pagination
                  ? `${pagination.totalItems} of ${pagination.catalogueSize} listings match your filters`
                  : 'Browse tokenised property investments'}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <FiSearch
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  className="input pl-9 w-56"
                  placeholder="Search listings"
                  aria-label="Search listings"
                  value={filters.search}
                  onChange={(event) => updateFilter('search', event.target.value)}
                />
              </div>

              <button
                type="button"
                className={`relative p-2 rounded-md ${
                  showFilters ? 'bg-primary-100 text-primary-600' : 'hover:bg-secondary-100'
                }`}
                onClick={() => setShowFilters((open) => !open)}
                aria-expanded={showFilters}
                aria-controls="property-filters"
                aria-label="Toggle filters"
              >
                <FiFilter size={20} aria-hidden="true" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-primary-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {showFilters && (
        <div id="property-filters" className="bg-white shadow-md border-t">
          <div className="container py-6">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
              <div>
                <label htmlFor="filter-type" className="block text-sm font-medium text-secondary-700 mb-1">
                  Property type
                </label>
                <select
                  id="filter-type"
                  className="input"
                  value={filters.type}
                  onChange={(event) => updateFilter('type', event.target.value)}
                >
                  {PROPERTY_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="filter-stage" className="block text-sm font-medium text-secondary-700 mb-1">
                  Funding stage
                </label>
                <select
                  id="filter-stage"
                  className="input"
                  value={filters.fundingStage}
                  onChange={(event) => updateFilter('fundingStage', event.target.value)}
                >
                  {FUNDING_STAGES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="filter-min-price" className="block text-sm font-medium text-secondary-700 mb-1">
                  Minimum price (USD)
                </label>
                <input
                  id="filter-min-price"
                  type="number"
                  min="0"
                  className="input"
                  placeholder="No minimum"
                  value={filters.minPriceUsd}
                  onChange={(event) => updateFilter('minPriceUsd', event.target.value)}
                />
              </div>

              <div>
                <label htmlFor="filter-max-price" className="block text-sm font-medium text-secondary-700 mb-1">
                  Maximum price (USD)
                </label>
                <input
                  id="filter-max-price"
                  type="number"
                  min="0"
                  className="input"
                  placeholder="No maximum"
                  value={filters.maxPriceUsd}
                  onChange={(event) => updateFilter('maxPriceUsd', event.target.value)}
                />
              </div>

              <div>
                <label htmlFor="filter-min-roi" className="block text-sm font-medium text-secondary-700 mb-1">
                  Minimum total return (%)
                </label>
                <input
                  id="filter-min-roi"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  className="input"
                  placeholder="e.g. 8"
                  value={filters.minRoiPct}
                  onChange={(event) => updateFilter('minRoiPct', event.target.value)}
                />
              </div>

              <div>
                <label htmlFor="filter-max-roi" className="block text-sm font-medium text-secondary-700 mb-1">
                  Maximum total return (%)
                </label>
                <input
                  id="filter-max-roi"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  className="input"
                  placeholder="No maximum"
                  value={filters.maxRoiPct}
                  onChange={(event) => updateFilter('maxRoiPct', event.target.value)}
                />
              </div>

              <div>
                <label htmlFor="filter-sort" className="block text-sm font-medium text-secondary-700 mb-1">
                  Sort by
                </label>
                <select
                  id="filter-sort"
                  className="input"
                  value={filters.sortBy}
                  onChange={(event) => updateFilter('sortBy', event.target.value)}
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="button"
                  className="btn-secondary w-full justify-center"
                  onClick={resetFilters}
                  disabled={activeFilterCount === 0 && filters.sortBy === 'newest'}
                >
                  <FiX className="mr-2" aria-hidden="true" />
                  Clear filters
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="container py-8">
        {error && <ErrorState error={error} onRetry={refetch} title="Could not load listings" />}

        {!error && isLoading && <SkeletonGrid count={filters.limit} />}

        {!error && !isLoading && !hasResults && (
          <EmptyState
            title="No listings match these filters"
            message="Try widening the price or return range, or clearing the filters entirely."
            action={
              <button type="button" className="btn" onClick={resetFilters}>
                Clear filters
              </button>
            }
          />
        )}

        {!error && !isLoading && hasResults && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {properties.map((property, index) => (
                <PropertyCard key={property.id} property={property} index={index} />
              ))}
            </div>
            <Pagination pagination={pagination} onChange={(page) => updateFilter('page', page)} />
          </>
        )}
      </div>
    </div>
  );
}

export default Properties;
