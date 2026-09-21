import { useCallback, useRef, useState } from 'react';

import { requestPropertyAnalysis, compareProviderAnalyses, fetchAiProviders } from '../services/aiApi';
import { useApiResource } from './useApiResource';

/**
 * On-demand AI analysis for one listing.
 *
 * Deliberately not a `useEffect` fetch: an analysis costs a model call, so it runs only
 * when the user asks for it. An in-flight request is aborted if a new one starts or the
 * component unmounts, so a stale response can never replace a newer one.
 */
export function useInvestmentAnalysis(propertyId) {
  const [result, setResult] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const controllerRef = useRef(null);

  const cancel = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
    setIsLoading(false);
  }, []);

  const generate = useCallback(
    async ({ investorProfile, provider, refresh } = {}) => {
      if (!propertyId) return null;

      // Supersede any request already running.
      if (controllerRef.current) controllerRef.current.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      setIsLoading(true);
      setError(null);

      try {
        const response = await requestPropertyAnalysis(
          { propertyId, investorProfile, provider, refresh },
          controller.signal
        );

        if (controller.signal.aborted) return null;
        setResult(response.data);
        setMeta(response.meta);
        return response.data;
      } catch (caught) {
        if (controller.signal.aborted) return null;
        setError(caught);
        return null;
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          setIsLoading(false);
        }
      }
    },
    [propertyId]
  );

  const reset = useCallback(() => {
    cancel();
    setResult(null);
    setMeta(null);
    setError(null);
  }, [cancel]);

  return { result, meta, error, isLoading, generate, reset, cancel };
}

/**
 * Side-by-side comparison of several providers on the same listing.
 *
 * Same facts, same prompt, same checks - so the differences in the results are
 * attributable to the models rather than to the harness.
 */
export function useModelComparison(propertyId) {
  const [results, setResults] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const controllerRef = useRef(null);

  const compare = useCallback(
    async ({ investorProfile, providers, refresh } = {}) => {
      if (!propertyId) return null;

      if (controllerRef.current) controllerRef.current.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      setIsLoading(true);
      setError(null);

      try {
        const response = await compareProviderAnalyses(
          { propertyId, investorProfile, providers, refresh },
          controller.signal
        );

        if (controller.signal.aborted) return null;
        setResults(response.data.results);
        setMeta(response.meta);
        return response.data.results;
      } catch (caught) {
        if (controller.signal.aborted) return null;
        setError(caught);
        return null;
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          setIsLoading(false);
        }
      }
    },
    [propertyId]
  );

  const reset = useCallback(() => {
    if (controllerRef.current) controllerRef.current.abort();
    setResults(null);
    setMeta(null);
    setError(null);
    setIsLoading(false);
  }, []);

  return { results, meta, error, isLoading, compare, reset };
}

/**
 * Which providers the server has integrated and which are actually usable.
 *
 * Drives the model picker. A provider the server has no credentials for is shown as
 * unavailable rather than hidden, so it is obvious what could be enabled.
 */
export function useAiProviders() {
  const fetcher = useCallback((signal) => fetchAiProviders(signal), []);
  const resource = useApiResource(fetcher, 'ai-providers', { initialData: [] });

  const providers = resource.data || [];

  return {
    providers,
    usableProviders: providers.filter((provider) => provider.configured),
    primary: resource.meta.primary,
    configuredCount: resource.meta.configuredCount ?? 0,
    integratedCount: resource.meta.integratedCount ?? providers.length,
    isLoading: resource.isLoading,
    error: resource.error,
  };
}
