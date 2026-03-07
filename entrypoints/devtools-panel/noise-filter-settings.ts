import {
  createDefaultNoiseFilterSettings,
  type NoiseFilterCategoryKey,
  type NoiseFilterCategorySettings,
  type NoiseFilterSettings,
} from '@/core';

const NOISE_FILTER_SETTINGS_STORAGE_KEY = 'prism.noise-filter.settings.v1';

const CATEGORY_KEYS: readonly NoiseFilterCategoryKey[] = Object.freeze([
  'media',
  'staticAssets',
  'analyticsTracking',
  'prefetchPreload',
  'healthChecksPings',
  'browserInternals',
]);

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    const deduped = new Set<string>();
    for (const item of value) {
      if (typeof item !== 'string') {
        continue;
      }
      const normalized = item.trim();
      if (normalized.length > 0) {
        deduped.add(normalized);
      }
    }
    return [...deduped];
  }

  if (typeof value === 'string') {
    return parseCommaSeparatedValues(value);
  }

  return [];
}

function normalizeCustomDomains(value: unknown): string[] {
  const deduped = new Set<string>();
  for (const domain of normalizeStringList(value)) {
    const normalized = domain.toLowerCase().replace(/^[a-z]+:\/\//, '').split('/')[0].split(':')[0];
    const clean = normalized.replace(/^\*\./, '').replace(/^\./, '').trim();
    if (clean) {
      deduped.add(clean);
    }
  }
  return [...deduped];
}

function normalizeCategorySettings(value: unknown): NoiseFilterCategorySettings {
  const defaults = createDefaultNoiseFilterSettings().categories;
  if (!value || typeof value !== 'object') {
    return defaults;
  }

  const rawRecord = value as Partial<Record<NoiseFilterCategoryKey, unknown>>;
  const normalized = { ...defaults };
  for (const key of CATEGORY_KEYS) {
    if (typeof rawRecord[key] === 'boolean') {
      normalized[key] = rawRecord[key] as boolean;
    }
  }

  return normalized;
}

export function parseCommaSeparatedValues(value: string): string[] {
  const deduped = new Set<string>();
  const parts = value.split(',');
  for (const part of parts) {
    const normalized = part.trim();
    if (normalized.length > 0) {
      deduped.add(normalized);
    }
  }
  return [...deduped];
}

export function normalizeNoiseFilterSettings(value: unknown): NoiseFilterSettings {
  const defaults = createDefaultNoiseFilterSettings();
  if (!value || typeof value !== 'object') {
    return defaults;
  }

  const rawRecord = value as Record<string, unknown>;
  return {
    enabled: typeof rawRecord.enabled === 'boolean' ? rawRecord.enabled : defaults.enabled,
    categories: normalizeCategorySettings(rawRecord.categories),
    customUrlPatterns: normalizeStringList(rawRecord.customUrlPatterns),
    customDomains: normalizeCustomDomains(rawRecord.customDomains),
  };
}

export function loadNoiseFilterSettings(): NoiseFilterSettings {
  if (typeof window === 'undefined' || !window.localStorage) {
    return createDefaultNoiseFilterSettings();
  }

  try {
    const raw = window.localStorage.getItem(NOISE_FILTER_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return createDefaultNoiseFilterSettings();
    }
    return normalizeNoiseFilterSettings(JSON.parse(raw));
  } catch {
    return createDefaultNoiseFilterSettings();
  }
}

export function saveNoiseFilterSettings(settings: NoiseFilterSettings): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  const normalized = normalizeNoiseFilterSettings(settings);

  try {
    window.localStorage.setItem(NOISE_FILTER_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Keep runtime behavior non-blocking; persistence failures should not stop recording.
  }
}
