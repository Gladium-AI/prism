export type AIProvider = 'openai' | 'gemini' | 'anthropic';

interface ProviderOption {
  id: AIProvider;
  label: string;
  recommendedModel: string;
  modelId: string;
}

export interface AIEnrichmentSettings {
  enabled: boolean;
  provider: AIProvider;
  apiKeys: Record<AIProvider, string>;
}

const AI_SETTINGS_STORAGE_KEY = 'prism.ai-enrichment.settings.v1';

const DEFAULT_API_KEYS: Record<AIProvider, string> = {
  openai: '',
  gemini: '',
  anthropic: '',
};

export const AI_PROVIDER_OPTIONS: readonly ProviderOption[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    recommendedModel: 'gpt-4o-mini',
    modelId: 'gpt-4o-mini',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    recommendedModel: 'gemini-2.0-flash',
    modelId: 'gemini-2.0-flash',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    recommendedModel: 'claude-haiku',
    modelId: 'claude-3-5-haiku-latest',
  },
] as const;

export const DEFAULT_AI_ENRICHMENT_SETTINGS: AIEnrichmentSettings = {
  enabled: false,
  provider: 'openai',
  apiKeys: { ...DEFAULT_API_KEYS },
};

function isAIProvider(value: unknown): value is AIProvider {
  return value === 'openai' || value === 'gemini' || value === 'anthropic';
}

function getProviderOption(provider: AIProvider): ProviderOption {
  const option = AI_PROVIDER_OPTIONS.find((entry) => entry.id === provider);
  return option ?? AI_PROVIDER_OPTIONS[0];
}

function normalizeApiKeys(value: unknown): Record<AIProvider, string> {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_API_KEYS };
  }

  const rawRecord = value as Record<string, unknown>;
  return {
    openai: typeof rawRecord.openai === 'string' ? rawRecord.openai : '',
    gemini: typeof rawRecord.gemini === 'string' ? rawRecord.gemini : '',
    anthropic: typeof rawRecord.anthropic === 'string' ? rawRecord.anthropic : '',
  };
}

function sanitizeAISettings(value: unknown): AIEnrichmentSettings {
  if (!value || typeof value !== 'object') {
    return {
      ...DEFAULT_AI_ENRICHMENT_SETTINGS,
      apiKeys: { ...DEFAULT_API_KEYS },
    };
  }

  const rawRecord = value as Record<string, unknown>;
  const provider = isAIProvider(rawRecord.provider) ? rawRecord.provider : DEFAULT_AI_ENRICHMENT_SETTINGS.provider;

  return {
    enabled: Boolean(rawRecord.enabled),
    provider,
    apiKeys: normalizeApiKeys(rawRecord.apiKeys),
  };
}

export async function loadAIEnrichmentSettings(): Promise<AIEnrichmentSettings> {
  if (!browser.storage?.local?.get) {
    return {
      ...DEFAULT_AI_ENRICHMENT_SETTINGS,
      apiKeys: { ...DEFAULT_API_KEYS },
    };
  }

  try {
    const stored = await browser.storage.local.get(AI_SETTINGS_STORAGE_KEY);
    return sanitizeAISettings(stored?.[AI_SETTINGS_STORAGE_KEY]);
  } catch {
    return {
      ...DEFAULT_AI_ENRICHMENT_SETTINGS,
      apiKeys: { ...DEFAULT_API_KEYS },
    };
  }
}

export async function saveAIEnrichmentSettings(settings: AIEnrichmentSettings): Promise<void> {
  if (!browser.storage?.local?.set) {
    return;
  }

  const sanitized = sanitizeAISettings(settings);
  await browser.storage.local.set({
    [AI_SETTINGS_STORAGE_KEY]: sanitized,
  });
}

export function getProviderLabel(provider: AIProvider): string {
  return getProviderOption(provider).label;
}

export function getProviderModelId(provider: AIProvider): string {
  return getProviderOption(provider).modelId;
}

export function getRecommendedModel(provider: AIProvider): string {
  return getProviderOption(provider).recommendedModel;
}

export function getAPIKeyForProvider(settings: AIEnrichmentSettings, provider: AIProvider): string {
  return settings.apiKeys[provider]?.trim() ?? '';
}
