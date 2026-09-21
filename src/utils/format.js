/**
 * Display formatting.
 *
 * The API returns numbers; the UI decides how they read. Keeping these here means a price
 * is formatted identically on the home page, the listings grid and the detail page - the
 * three places that previously each had their own inline `toLocaleString` call.
 */

const CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const CURRENCY_WITH_CENTS = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US');

export function formatUsd(value, { cents = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return cents ? CURRENCY_WITH_CENTS.format(value) : CURRENCY_FORMATTER.format(value);
}

export function formatNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return NUMBER_FORMATTER.format(value);
}

export function formatPercent(value, { decimals = 2 } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  // Trim a trailing ".00" so 4.5% does not read as 4.50%.
  const fixed = value.toFixed(decimals).replace(/\.?0+$/, '');
  return `${fixed}%`;
}

export function formatEth(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${NUMBER_FORMATTER.format(Number(value.toFixed(2)))} ETH`;
}

/** Percentage as a CSS width, clamped so bad data cannot overflow a progress bar. */
export function toBarWidth(percentage) {
  const value = typeof percentage === 'number' && Number.isFinite(percentage) ? percentage : 0;
  return `${Math.min(100, Math.max(0, value))}%`;
}

export function formatDate(isoString) {
  if (!isoString) return '-';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDuration(milliseconds) {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds)) return '-';
  return milliseconds < 1000 ? `${Math.round(milliseconds)}ms` : `${(milliseconds / 1000).toFixed(1)}s`;
}

/** Turns `property_tax` / `managementPct` into `Property tax` / `Management`. */
export function humaniseKey(key) {
  return String(key)
    .replace(/Pct$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase());
}
