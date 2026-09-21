import { useState } from 'react';
import { FiAward, FiAlertTriangle, FiChevronDown, FiChevronUp, FiZap } from 'react-icons/fi';

import { ErrorState, Spinner } from '../common/StateViews';
import { formatDuration } from '../../utils/format';

/**
 * Side-by-side comparison of several LLM providers on the same listing.
 *
 * The comparison is only meaningful because every provider receives the identical fact
 * sheet and prompt, and every response is scored by the identical check suite - so the
 * differences shown here are the models, not the harness. Failover is disabled for these
 * calls; substituting one vendor for another would silently invalidate the comparison.
 */

const VERDICT_LABEL = {
  aligned: 'Aligned',
  partially_aligned: 'Partially aligned',
  not_aligned: 'Not aligned',
  not_assessed: 'Not assessed',
};

function ScoreBar({ score }) {
  const percent = Math.round((score || 0) * 100);
  const tone = percent === 100 ? 'bg-emerald-500' : percent >= 80 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="flex items-center gap-2 min-w-[7rem]">
      <div className="flex-1 bg-secondary-100 rounded-full h-2">
        <div className={`h-2 rounded-full ${tone}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="text-sm font-medium tabular-nums w-10 text-right">{percent}%</span>
    </div>
  );
}

function ComparisonRow({ entry, isBest }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <li className="border border-secondary-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="w-full px-4 py-3 flex items-center gap-4 text-left hover:bg-secondary-50"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-secondary-900">{entry.label}</span>
            {isBest && entry.ok && (
              <span className="inline-flex items-center text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded">
                <FiAward className="mr-1" aria-hidden="true" />
                Top score
              </span>
            )}
            {!entry.ok && (
              <span className="inline-flex items-center text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded">
                <FiAlertTriangle className="mr-1" aria-hidden="true" />
                Failed
              </span>
            )}
            {entry.cached && (
              <span className="text-xs bg-secondary-100 text-secondary-600 px-2 py-0.5 rounded">
                cached
              </span>
            )}
          </div>
          <p className="text-xs text-secondary-500 font-mono mt-0.5 truncate">{entry.model || '-'}</p>
        </div>

        {entry.ok ? (
          <>
            <span className="hidden sm:inline text-xs text-secondary-500 whitespace-nowrap">
              {VERDICT_LABEL[entry.verdict] || entry.verdict || '-'}
            </span>
            <span className="text-xs text-secondary-500 whitespace-nowrap">
              {formatDuration(entry.latencyMs)}
            </span>
            <ScoreBar score={entry.score} />
          </>
        ) : (
          <span className="text-sm text-red-600 truncate max-w-[16rem]">{entry.error?.code}</span>
        )}

        {isOpen ? <FiChevronUp aria-hidden="true" /> : <FiChevronDown aria-hidden="true" />}
      </button>

      {isOpen && (
        <div className="px-4 py-3 border-t border-secondary-100 bg-white">
          {entry.ok ? (
            <div className="space-y-3">
              <p className="font-medium text-secondary-900">{entry.analysis.headline}</p>
              <p className="text-sm text-secondary-700">{entry.analysis.summary}</p>
              <div className="text-sm">
                <span className="font-medium">Suitability: </span>
                <span>{VERDICT_LABEL[entry.analysis.suitability?.verdict]}</span>
                <p className="text-secondary-600 mt-1">{entry.analysis.suitability?.rationale}</p>
              </div>
              <div className="text-sm">
                <span className="font-medium">Top risk: </span>
                <span className="text-secondary-600">{entry.analysis.risks?.[0]?.risk}</span>
              </div>
              <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-secondary-500 pt-2 border-t border-secondary-100">
                <div>
                  <dt className="inline font-medium">Structured output: </dt>
                  <dd className="inline">{entry.jsonMode || 'n/a'}</dd>
                </div>
                <div>
                  <dt className="inline font-medium">Attempts: </dt>
                  <dd className="inline">{entry.attempts}</dd>
                </div>
                {entry.usage?.outputTokens !== undefined && (
                  <div>
                    <dt className="inline font-medium">Output tokens: </dt>
                    <dd className="inline">{entry.usage.outputTokens}</dd>
                  </div>
                )}
              </dl>
            </div>
          ) : (
            <div className="text-sm">
              <p className="text-secondary-700">{entry.error?.message}</p>
              {Array.isArray(entry.error?.failures) && entry.error.failures.length > 0 && (
                <ul className="mt-2 list-disc list-inside text-secondary-600 text-xs space-y-1">
                  {entry.error.failures.flatMap((failure) =>
                    (failure.failedChecks || []).map((check) => (
                      <li key={`${failure.provider}-${check.id}`}>
                        {check.label}: {check.detail}
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function ModelComparison({ comparison, usableProviders }) {
  const { results, meta, error, isLoading, compare, reset } = comparison;
  const canCompare = usableProviders.length >= 2;

  return (
    <section className="mt-6 pt-6 border-t border-secondary-200">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
        <div>
          <h4 className="font-semibold text-secondary-900 flex items-center">
            <FiZap className="mr-2 text-primary-600" aria-hidden="true" />
            Compare models
          </h4>
          <p className="text-sm text-secondary-600 mt-1 max-w-xl">
            Run this listing through every configured provider at once and score each result with
            the same checks.
          </p>
        </div>

        <div className="flex gap-2">
          {results && (
            <button type="button" className="btn-secondary" onClick={reset}>
              Clear
            </button>
          )}
          <button
            type="button"
            className="btn disabled:opacity-60"
            onClick={() => compare({})}
            disabled={isLoading || !canCompare}
          >
            {isLoading ? <Spinner label="Comparing" className="text-white" /> : 'Run comparison'}
          </button>
        </div>
      </div>

      {!canCompare && (
        <p className="text-sm text-secondary-500">
          Comparison needs at least two configured providers. Currently available:{' '}
          {usableProviders.length === 0 ? 'none' : usableProviders.map((p) => p.label).join(', ')}.
        </p>
      )}

      {error && (
        <div className="mt-3">
          <ErrorState error={error} onRetry={() => compare({})} title="Comparison failed" />
        </div>
      )}

      {isLoading && !results && (
        <p className="text-sm text-secondary-600 mt-3">
          Querying {usableProviders.length} providers in parallel. This takes as long as the slowest
          one.
        </p>
      )}

      {results && (
        <div className="mt-4">
          {meta?.summary && (
            <p className="text-sm text-secondary-600 mb-3">
              {meta.summary.succeeded} of {meta.summary.requested} providers returned a verified
              analysis
              {meta.summary.bestProvider && ` · best: ${meta.summary.bestProvider}`}
              {typeof meta.summary.meanScore === 'number' &&
                ` · mean score ${Math.round(meta.summary.meanScore * 100)}%`}
            </p>
          )}
          <ul className="space-y-2">
            {results.map((entry) => (
              <ComparisonRow
                key={entry.provider}
                entry={entry}
                isBest={meta?.summary?.bestProvider === entry.provider}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default ModelComparison;
