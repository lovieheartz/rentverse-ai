import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  FiAlertTriangle,
  FiCheckCircle,
  FiCpu,
  FiHelpCircle,
  FiRefreshCw,
  FiTrendingUp,
} from 'react-icons/fi';

import { ErrorState, Spinner } from '../common/StateViews';
import { useAiProviders, useInvestmentAnalysis, useModelComparison } from '../../hooks/useInvestmentAnalysis';
import { formatDuration } from '../../utils/format';
import AnalysisScorecard from './AnalysisScorecard';
import ModelComparison from './ModelComparison';

/**
 * AI investment analysis, placed at the decision point of the existing flow: the property
 * detail page, immediately above "Connect wallet to invest".
 *
 * It answers the question a prospective investor actually has at that moment - "is this
 * listing a sensible fit for me, and what should I be worried about?" - grounded strictly
 * in the listing data already on the page.
 *
 * Three product decisions worth noting:
 *  - Nothing is generated until the user asks. An analysis is a paid model call.
 *  - The investor profile is optional. Without it the analysis declines to judge fit
 *    rather than inventing one.
 *  - The result is labelled with the model that produced it and the checks it passed.
 *    Presenting generated financial commentary as if it were editorial would be dishonest.
 */

const RISK_STYLES = {
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  high: 'bg-red-50 text-red-700 border-red-200',
};

const VERDICT_PRESENTATION = {
  aligned: { label: 'Aligned with your profile', className: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  partially_aligned: {
    label: 'Partially aligned',
    className: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  not_aligned: { label: 'Not aligned', className: 'bg-red-50 text-red-800 border-red-200' },
  not_assessed: {
    label: 'Not assessed - add your profile',
    className: 'bg-secondary-100 text-secondary-700 border-secondary-200',
  },
};

const EMPTY_PROFILE = { budgetUsd: '', horizonYears: '', riskTolerance: '', goal: '' };

/** Mirrors the server's rules so a bad value is caught before a request is spent on it. */
function validateProfile(profile) {
  const errors = {};

  if (profile.budgetUsd !== '') {
    const budget = Number(profile.budgetUsd);
    if (!Number.isFinite(budget) || budget < 10) errors.budgetUsd = 'Minimum investment is $10.';
    else if (budget > 10000000) errors.budgetUsd = 'Enter a budget up to $10,000,000.';
  }

  if (profile.horizonYears !== '') {
    const horizon = Number(profile.horizonYears);
    if (!Number.isInteger(horizon) || horizon < 1 || horizon > 40) {
      errors.horizonYears = 'Enter a whole number of years between 1 and 40.';
    }
  }

  return errors;
}

function toRequestProfile(profile) {
  return {
    budgetUsd: profile.budgetUsd === '' ? undefined : Number(profile.budgetUsd),
    horizonYears: profile.horizonYears === '' ? undefined : Number(profile.horizonYears),
    riskTolerance: profile.riskTolerance || undefined,
    goal: profile.goal || undefined,
  };
}

function InvestmentAnalysisPanel({ propertyId, propertyTitle }) {
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [formErrors, setFormErrors] = useState({});
  const [selectedProvider, setSelectedProvider] = useState('');

  const analysis = useInvestmentAnalysis(propertyId);
  const comparison = useModelComparison(propertyId);
  const { usableProviders, configuredCount, integratedCount } = useAiProviders();

  const requestProfile = useMemo(() => toRequestProfile(profile), [profile]);

  const updateField = (field, value) => {
    setProfile((previous) => ({ ...previous, [field]: value }));
    setFormErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  const handleSubmit = (event, { refresh = false } = {}) => {
    if (event) event.preventDefault();

    const errors = validateProfile(profile);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    analysis.generate({
      investorProfile: requestProfile,
      provider: selectedProvider || undefined,
      refresh,
    });
  };

  const result = analysis.result;
  const meta = analysis.meta;
  const verdict = result?.analysis?.suitability?.verdict;
  const verdictPresentation = VERDICT_PRESENTATION[verdict] || VERDICT_PRESENTATION.not_assessed;

  return (
    <section
      className="bg-white rounded-lg shadow-md p-6"
      aria-labelledby="ai-analysis-heading"
      data-testid="investment-analysis-panel"
    >
      <header className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h2 id="ai-analysis-heading" className="text-2xl font-bold flex items-center">
            <FiCpu className="mr-2 text-primary-600" aria-hidden="true" />
            AI investment analysis
          </h2>
          <p className="text-secondary-600 mt-1 max-w-2xl">
            An evidence-led read on {propertyTitle}, generated from this listing&apos;s own figures
            and checked before it is shown. Add your profile for a suitability assessment.
          </p>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5" noValidate>
        <div>
          <label htmlFor="ai-budget" className="block text-sm font-medium text-secondary-700 mb-1">
            Investment budget (USD)
          </label>
          <input
            id="ai-budget"
            type="number"
            inputMode="numeric"
            min="10"
            step="10"
            className="input"
            placeholder="e.g. 2500"
            value={profile.budgetUsd}
            onChange={(event) => updateField('budgetUsd', event.target.value)}
            aria-invalid={Boolean(formErrors.budgetUsd)}
            aria-describedby={formErrors.budgetUsd ? 'ai-budget-error' : undefined}
          />
          {formErrors.budgetUsd && (
            <p id="ai-budget-error" className="text-sm text-red-600 mt-1">
              {formErrors.budgetUsd}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="ai-horizon" className="block text-sm font-medium text-secondary-700 mb-1">
            Holding horizon (years)
          </label>
          <input
            id="ai-horizon"
            type="number"
            inputMode="numeric"
            min="1"
            max="40"
            step="1"
            className="input"
            placeholder="e.g. 5"
            value={profile.horizonYears}
            onChange={(event) => updateField('horizonYears', event.target.value)}
            aria-invalid={Boolean(formErrors.horizonYears)}
            aria-describedby={formErrors.horizonYears ? 'ai-horizon-error' : undefined}
          />
          {formErrors.horizonYears && (
            <p id="ai-horizon-error" className="text-sm text-red-600 mt-1">
              {formErrors.horizonYears}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="ai-risk" className="block text-sm font-medium text-secondary-700 mb-1">
            Risk tolerance
          </label>
          <select
            id="ai-risk"
            className="input"
            value={profile.riskTolerance}
            onChange={(event) => updateField('riskTolerance', event.target.value)}
          >
            <option value="">No preference</option>
            <option value="conservative">Conservative</option>
            <option value="moderate">Moderate</option>
            <option value="aggressive">Aggressive</option>
          </select>
        </div>

        <div>
          <label htmlFor="ai-goal" className="block text-sm font-medium text-secondary-700 mb-1">
            Primary goal
          </label>
          <select
            id="ai-goal"
            className="input"
            value={profile.goal}
            onChange={(event) => updateField('goal', event.target.value)}
          >
            <option value="">No preference</option>
            <option value="income">Rental income</option>
            <option value="appreciation">Capital appreciation</option>
            <option value="balanced">Balanced</option>
          </select>
        </div>

        {usableProviders.length > 1 && (
          <div className="md:col-span-2">
            <label htmlFor="ai-provider" className="block text-sm font-medium text-secondary-700 mb-1">
              Model
            </label>
            <select
              id="ai-provider"
              className="input"
              value={selectedProvider}
              onChange={(event) => setSelectedProvider(event.target.value)}
            >
              <option value="">Server default</option>
              {usableProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label} ({provider.model})
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="md:col-span-2 flex items-center gap-3 flex-wrap">
          <button type="submit" className="btn disabled:opacity-60" disabled={analysis.isLoading}>
            {analysis.isLoading ? (
              <Spinner label="Analysing" className="text-white" />
            ) : result ? (
              'Update analysis'
            ) : (
              'Generate analysis'
            )}
          </button>

          {result && !analysis.isLoading && (
            <button
              type="button"
              className="btn-secondary"
              onClick={(event) => handleSubmit(event, { refresh: true })}
              title="Ignore the cached result and generate a fresh analysis"
            >
              <FiRefreshCw className="mr-2" aria-hidden="true" />
              Regenerate
            </button>
          )}

          {analysis.isLoading && (
            <button type="button" className="btn-secondary" onClick={analysis.cancel}>
              Cancel
            </button>
          )}

          <span className="text-sm text-secondary-500">
            {configuredCount > 0
              ? `${configuredCount} of ${integratedCount} providers configured`
              : 'No provider configured - showing a deterministic sample'}
          </span>
        </div>
      </form>

      {analysis.error && (
        <ErrorState
          error={analysis.error}
          onRetry={() => handleSubmit(null)}
          title={
            analysis.error.code === 'AI_OUTPUT_REJECTED'
              ? 'The generated analysis failed its quality checks'
              : 'Could not generate the analysis'
          }
        />
      )}

      {analysis.isLoading && !result && (
        <div className="border border-secondary-200 rounded-lg p-6 animate-pulse" aria-hidden="true">
          <div className="h-5 bg-secondary-200 rounded w-2/3 mb-4" />
          <div className="h-4 bg-secondary-100 rounded mb-2" />
          <div className="h-4 bg-secondary-100 rounded w-5/6 mb-6" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="h-24 bg-secondary-100 rounded" />
            <div className="h-24 bg-secondary-100 rounded" />
          </div>
        </div>
      )}

      {result && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="space-y-5"
        >
          {/* Provenance. Anyone reading a number here can see what produced it. */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="inline-flex items-center bg-primary-50 text-primary-700 px-2 py-1 rounded font-medium">
              <FiCpu className="mr-1" aria-hidden="true" />
              {result.providerLabel || result.provider}
            </span>
            <span className="font-mono bg-secondary-100 text-secondary-700 px-2 py-1 rounded">
              {result.model}
            </span>
            {result.provider === 'sample' && (
              <span className="bg-amber-50 text-amber-800 px-2 py-1 rounded">
                Sample output - no model configured
              </span>
            )}
            {meta?.cached && (
              <span className="bg-secondary-100 text-secondary-600 px-2 py-1 rounded">Cached</span>
            )}
            {meta?.regenerated && (
              <span className="bg-amber-50 text-amber-800 px-2 py-1 rounded">
                Regenerated after a failed check
              </span>
            )}
            {meta?.failedOver && (
              <span className="bg-amber-50 text-amber-800 px-2 py-1 rounded">
                Failed over from {meta.requestedProvider}
              </span>
            )}
            {typeof meta?.providerLatencyMs === 'number' && (
              <span className="text-secondary-500">{formatDuration(meta.providerLatencyMs)}</span>
            )}
          </div>

          <div>
            <h3 className="text-xl font-semibold text-secondary-900">{result.analysis.headline}</h3>
            <p className="text-secondary-700 mt-2 leading-relaxed">{result.analysis.summary}</p>
          </div>

          <div className={`border rounded-lg p-4 ${verdictPresentation.className}`}>
            <p className="font-semibold">{verdictPresentation.label}</p>
            <p className="text-sm mt-1 leading-relaxed">{result.analysis.suitability?.rationale}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {result.analysis.keyMetrics?.map((metric) => (
              <div key={metric.label} className="bg-secondary-50 rounded-lg p-4">
                <p className="text-sm text-secondary-600">{metric.label}</p>
                <p className="text-lg font-semibold text-secondary-900">{metric.value}</p>
                <p className="text-xs text-secondary-600 mt-1 leading-relaxed">{metric.interpretation}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div>
              <h4 className="font-semibold mb-2 flex items-center text-secondary-900">
                <FiTrendingUp className="mr-2 text-emerald-600" aria-hidden="true" />
                Strengths
              </h4>
              <ul className="space-y-2">
                {result.analysis.strengths?.map((strength) => (
                  <li key={strength.point} className="border border-secondary-200 rounded-lg p-3">
                    <p className="text-sm font-medium text-secondary-900 flex items-start">
                      <FiCheckCircle
                        className="text-emerald-600 mr-2 mt-0.5 flex-shrink-0"
                        aria-hidden="true"
                      />
                      {strength.point}
                    </p>
                    <p className="text-sm text-secondary-600 mt-1 ml-6">{strength.evidence}</p>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-2 flex items-center text-secondary-900">
                <FiAlertTriangle className="mr-2 text-amber-600" aria-hidden="true" />
                Risks
              </h4>
              <ul className="space-y-2">
                {result.analysis.risks?.map((risk) => (
                  <li
                    key={risk.risk}
                    className={`border rounded-lg p-3 ${RISK_STYLES[risk.severity] || RISK_STYLES.medium}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">{risk.risk}</p>
                      <span className="text-xs uppercase tracking-wide font-semibold flex-shrink-0">
                        {risk.severity}
                      </span>
                    </div>
                    <p className="text-sm mt-1 opacity-90">
                      <span className="font-medium">Mitigation: </span>
                      {risk.mitigation}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {result.analysis.questionsToAsk?.length > 0 && (
            <div>
              <h4 className="font-semibold mb-2 flex items-center text-secondary-900">
                <FiHelpCircle className="mr-2 text-primary-600" aria-hidden="true" />
                Questions to ask before investing
              </h4>
              <ul className="list-disc list-inside space-y-1 text-secondary-700">
                {result.analysis.questionsToAsk.map((question) => (
                  <li key={question} className="leading-relaxed">
                    {question}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <AnalysisScorecard evaluation={meta?.evaluation} />

          <p className="text-xs text-secondary-500 leading-relaxed border-t border-secondary-200 pt-4">
            {result.analysis.disclaimer}
          </p>
        </motion.div>
      )}

      <ModelComparison comparison={comparison} usableProviders={usableProviders} />
    </section>
  );
}

export default InvestmentAnalysisPanel;
