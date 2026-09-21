import { FiAlertCircle, FiInbox, FiRefreshCw, FiLoader } from 'react-icons/fi';

/**
 * Shared loading, error and empty states.
 *
 * Every screen that fetches data needs all three. Keeping them in one place means a failed
 * request looks and behaves the same everywhere, and always offers the two things a user
 * actually needs: what went wrong, and a way to try again.
 */

export function Spinner({ label = 'Loading', className = '' }) {
  return (
    <span className={`inline-flex items-center text-secondary-600 ${className}`} role="status">
      <FiLoader className="animate-spin mr-2" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

/**
 * @param {object} props
 * @param {Error} props.error An `ApiRequestError` from the API client.
 * @param {function} [props.onRetry]
 * @param {string} [props.title]
 */
export function ErrorState({ error, onRetry, title = 'Something went wrong' }) {
  const fieldErrors = typeof error?.fieldErrors === 'object' ? error.fieldErrors : {};
  const fieldEntries = Object.entries(fieldErrors);
  const canRetry = onRetry && (error?.isRetryable ?? true);

  return (
    <div className="bg-white border border-red-200 rounded-lg p-6" role="alert">
      <div className="flex items-start">
        <FiAlertCircle className="text-red-500 mt-0.5 mr-3 flex-shrink-0" size={20} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-secondary-900">{title}</h3>
          <p className="text-secondary-600 mt-1">
            {error?.message || 'The request could not be completed.'}
          </p>

          {fieldEntries.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-secondary-600 list-disc list-inside">
              {fieldEntries.map(([field, message]) => (
                <li key={field}>
                  <span className="font-medium">{field}</span>: {message}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex items-center gap-4 flex-wrap">
            {canRetry && (
              <button type="button" className="btn-secondary" onClick={onRetry}>
                <FiRefreshCw className="mr-2" aria-hidden="true" />
                Try again
              </button>
            )}
            {/* Shown so a user can quote it in a bug report and it can be found in the logs. */}
            {error?.requestId && (
              <code className="text-xs text-secondary-500 font-mono break-all">
                Reference: {error.requestId}
              </code>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ title = 'Nothing to show', message, action }) {
  return (
    <div className="bg-white rounded-lg border border-secondary-200 p-10 text-center">
      <FiInbox className="mx-auto text-secondary-400 mb-3" size={32} aria-hidden="true" />
      <h3 className="font-semibold text-secondary-900">{title}</h3>
      {message && <p className="text-secondary-600 mt-1 max-w-md mx-auto">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Placeholder card matching the real card's height, so the grid does not jump on load. */
export function SkeletonCard() {
  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden animate-pulse" aria-hidden="true">
      <div className="h-48 bg-secondary-200" />
      <div className="p-6 space-y-3">
        <div className="h-5 bg-secondary-200 rounded w-3/4" />
        <div className="h-4 bg-secondary-100 rounded w-1/2" />
        <div className="h-px bg-secondary-100 my-4" />
        <div className="h-4 bg-secondary-100 rounded" />
        <div className="h-4 bg-secondary-100 rounded w-5/6" />
        <div className="h-2 bg-secondary-100 rounded-full mt-4" />
        <div className="h-9 bg-secondary-200 rounded mt-4" />
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 6 }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} />
      ))}
    </div>
  );
}
