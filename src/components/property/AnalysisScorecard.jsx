import { useState } from 'react';
import { FiCheck, FiChevronDown, FiChevronUp, FiShield, FiX } from 'react-icons/fi';

/**
 * The quality scorecard that accompanies every generated analysis.
 *
 * This is surfaced in the UI rather than kept in a log on purpose. The analysis is
 * generated text about money; showing that it was checked - and exactly what was checked -
 * is what makes it reasonable to show at all. Critical checks must all pass before the
 * server will release an analysis, so a visible failure here can only ever be a warning.
 */

const SEVERITY_LABEL = { critical: 'Blocking', warning: 'Advisory' };

function AnalysisScorecard({ evaluation }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!evaluation || !Array.isArray(evaluation.checks)) return null;

  const { summary, score, passed, checks } = evaluation;
  const scorePercent = Math.round((score || 0) * 100);
  const warnings = checks.filter((check) => !check.passed);

  return (
    <section className="border border-secondary-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-secondary-50 hover:bg-secondary-100 text-left"
      >
        <span className="flex items-center min-w-0">
          <FiShield
            className={passed ? 'text-emerald-600 mr-2 flex-shrink-0' : 'text-amber-600 mr-2 flex-shrink-0'}
            aria-hidden="true"
          />
          <span className="font-medium text-secondary-900">Quality checks</span>
          <span className="ml-3 text-sm text-secondary-600 truncate">
            {summary.passed}/{summary.total} passed &middot; score {scorePercent}%
            {warnings.length > 0 && ` · ${warnings.length} advisory`}
          </span>
        </span>
        {isOpen ? (
          <FiChevronUp className="flex-shrink-0" aria-hidden="true" />
        ) : (
          <FiChevronDown className="flex-shrink-0" aria-hidden="true" />
        )}
      </button>

      {isOpen && (
        <div className="px-4 py-3 bg-white">
          <p className="text-sm text-secondary-600 mb-3">
            Every analysis is verified before it is shown. Blocking checks - figures traced back to
            this listing&apos;s data, no guaranteed-return language, risks present, disclaimer
            present - must all pass or the analysis is withheld and regenerated.
          </p>
          <ul className="divide-y divide-secondary-100">
            {checks.map((check) => (
              <li key={check.id} className="py-2 flex items-start gap-3">
                {check.passed ? (
                  <FiCheck className="text-emerald-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
                ) : (
                  <FiX className="text-amber-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-medium text-secondary-900">{check.label}</span>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${
                        check.severity === 'critical'
                          ? 'bg-secondary-100 text-secondary-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {SEVERITY_LABEL[check.severity] || check.severity}
                    </span>
                  </div>
                  {check.detail && <p className="text-xs text-secondary-600 mt-0.5">{check.detail}</p>}
                </div>
                <span className="sr-only">{check.passed ? 'Passed' : 'Failed'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default AnalysisScorecard;
