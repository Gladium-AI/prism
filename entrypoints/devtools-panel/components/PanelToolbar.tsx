import { Button, Toggle, Tooltip } from '@/src/design-system';
import {
  createDefaultNoiseFilterSettings,
  type NoiseFilterCategoryKey,
  type NoiseFilterCategorySettings,
  type NoiseFilterSettings,
} from '@/core';
import { useEffect, useRef, useState } from 'react';
import {
  AI_PROVIDER_OPTIONS,
  getProviderLabel,
  getRecommendedModel,
  type AIEnrichmentSettings,
  type AIProvider,
} from '../ai-settings';
import { parseCommaSeparatedValues } from '../noise-filter-settings';
import { formatSnapshotTime } from '../panel-utils';

const NOISE_FILTER_CATEGORY_OPTIONS: ReadonlyArray<{
  key: NoiseFilterCategoryKey;
  label: string;
  description: string;
}> = Object.freeze([
  {
    key: 'media',
    label: 'Media',
    description: 'Exclude images, audio/video payloads, and font files.',
  },
  {
    key: 'staticAssets',
    label: 'Static assets',
    description: 'Exclude JS/CSS/HTML/map/icon/SVG assets loaded as documents/scripts/styles.',
  },
  {
    key: 'analyticsTracking',
    label: 'Analytics & tracking',
    description: 'Exclude known tracker domains plus collect/track/pixel/beacon URLs.',
  },
  {
    key: 'prefetchPreload',
    label: 'Prefetch / preload',
    description: 'Exclude prefetch-like requests that return no response body.',
  },
  {
    key: 'healthChecksPings',
    label: 'Health checks & pings',
    description: 'Exclude health/ping/status endpoints with empty or tiny ack-like responses.',
  },
  {
    key: 'browserInternals',
    label: 'Browser internals',
    description: 'Exclude chrome-extension/devtools/blob/data URLs.',
  },
]);

interface AIProgressState {
  completed: number;
  total: number;
  message: string;
}

interface PanelToolbarProps {
  isSnapshot: boolean;
  isCapturingCookies: boolean;
  snapshotTime: Date | null;
  statusOverride: string | null;
  onSnapshotToggle(): void;
  onExportSnapshot(): void;
  onExportMap(): void;
  canExportSnapshot: boolean;
  canExportMap: boolean;
  isExportingMap: boolean;
  aiSettings: AIEnrichmentSettings;
  isAISettingsLoaded: boolean;
  noiseFilterSettings: NoiseFilterSettings;
  aiProgress: AIProgressState | null;
  onSetAIProvider(provider: AIProvider): void;
  onSetAIEnrichmentEnabled(enabled: boolean): void;
  onSetAIApiKey(provider: AIProvider, apiKey: string): void;
  onSetNoiseFilterEnabled(enabled: boolean): void;
  onApplyNoiseFilterSettings(settings: NoiseFilterSettings): void;
}

export function PanelToolbar({
  isSnapshot,
  isCapturingCookies,
  snapshotTime,
  statusOverride,
  onSnapshotToggle,
  onExportSnapshot,
  onExportMap,
  canExportSnapshot,
  canExportMap,
  isExportingMap,
  aiSettings,
  isAISettingsLoaded,
  noiseFilterSettings,
  aiProgress,
  onSetAIProvider,
  onSetAIEnrichmentEnabled,
  onSetAIApiKey,
  onSetNoiseFilterEnabled,
  onApplyNoiseFilterSettings,
}: PanelToolbarProps) {
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [noiseFilterOpen, setNoiseFilterOpen] = useState(false);
  const [noiseFilterDraft, setNoiseFilterDraft] = useState<NoiseFilterCategorySettings>(
    noiseFilterSettings.categories,
  );
  const [customUrlPatternsInput, setCustomUrlPatternsInput] = useState(noiseFilterSettings.customUrlPatterns.join(', '));
  const [customDomainsInput, setCustomDomainsInput] = useState(noiseFilterSettings.customDomains.join(', '));
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const noiseFilterRef = useRef<HTMLDivElement | null>(null);
  const snapshotSuffix = formatSnapshotTime(snapshotTime);
  const apiKeyForProvider = aiSettings.apiKeys[aiSettings.provider] ?? '';
  const recommendedModel = getRecommendedModel(aiSettings.provider);
  const progressPercent =
    aiProgress && aiProgress.total > 0
      ? Math.min(100, Math.max(0, Math.round((aiProgress.completed / aiProgress.total) * 100)))
      : 0;

  const syncNoiseFilterDraft = (settings: NoiseFilterSettings) => {
    setNoiseFilterDraft({ ...settings.categories });
    setCustomUrlPatternsInput(settings.customUrlPatterns.join(', '));
    setCustomDomainsInput(settings.customDomains.join(', '));
  };

  useEffect(() => {
    if (!noiseFilterOpen) {
      syncNoiseFilterDraft(noiseFilterSettings);
    }
  }, [noiseFilterOpen, noiseFilterSettings]);

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedExportMenu = exportMenuRef.current?.contains(target);
      const clickedSettingsMenu = settingsRef.current?.contains(target);
      const clickedNoiseFilter = noiseFilterRef.current?.contains(target);

      if (!clickedExportMenu) {
        setExportMenuOpen(false);
      }
      if (!clickedSettingsMenu) {
        setSettingsOpen(false);
      }
      if (!clickedNoiseFilter) {
        setNoiseFilterOpen(false);
      }
    };

    document.addEventListener('mousedown', handleDocumentClick);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
    };
  }, []);

  const handleExportSnapshot = () => {
    setExportMenuOpen(false);
    onExportSnapshot();
  };

  const handleExportMap = () => {
    setExportMenuOpen(false);
    onExportMap();
  };

  const handleToggleNoiseCategory = (key: NoiseFilterCategoryKey, checked: boolean) => {
    setNoiseFilterDraft((previous) => ({
      ...previous,
      [key]: checked,
    }));
  };

  const handleResetNoiseFilters = () => {
    const defaults = createDefaultNoiseFilterSettings();
    setNoiseFilterDraft({ ...defaults.categories });
    setCustomUrlPatternsInput('');
    setCustomDomainsInput('');
  };

  const handleApplyNoiseFilters = () => {
    onApplyNoiseFilterSettings({
      enabled: noiseFilterSettings.enabled,
      categories: { ...noiseFilterDraft },
      customUrlPatterns: parseCommaSeparatedValues(customUrlPatternsInput),
      customDomains: parseCommaSeparatedValues(customDomainsInput),
    });
    setNoiseFilterOpen(false);
  };

  const modeToggle = (
    <Toggle
      checked={isSnapshot}
      checkedLabel="Frozen"
      uncheckedLabel="Live"
      checkedTone="danger"
      uncheckedTone="success"
      onClick={onSnapshotToggle}
    />
  );

  return (
    <header className="panel-toolbar">
      <div className="toolbar-actions">
        {isSnapshot && snapshotSuffix ? (
          <Tooltip label={`Frozen at ${snapshotSuffix}`}>{modeToggle}</Tooltip>
        ) : (
          modeToggle
        )}

        <div className="noise-filter-menu" ref={noiseFilterRef}>
          <div className="noise-filter-quick-controls">
            <Toggle
              checked={noiseFilterSettings.enabled}
              checkedLabel="Filter Noise"
              uncheckedLabel="Filter Noise"
              checkedTone="info"
              uncheckedTone="neutral"
              onClick={() => onSetNoiseFilterEnabled(!noiseFilterSettings.enabled)}
            />
            <Button
              className="noise-filter-settings-trigger"
              variant="ghost"
              size="sm"
              aria-haspopup="dialog"
              aria-expanded={noiseFilterOpen ? 'true' : 'false'}
              onClick={() => {
                setNoiseFilterOpen((previous) => {
                  const next = !previous;
                  if (next) {
                    syncNoiseFilterDraft(noiseFilterSettings);
                  }
                  return next;
                });
                setExportMenuOpen(false);
                setSettingsOpen(false);
              }}
            >
              ⚙ Filters
            </Button>
          </div>

          {noiseFilterOpen ? (
            <section className="noise-filter-panel" role="dialog" aria-label="Advanced noise filters">
              <div className="noise-filter-heading">
                <p className="noise-filter-title">Advanced filters</p>
                <p className="noise-filter-caption">
                  Choose what to exclude while <span>{noiseFilterSettings.enabled ? 'Filter Noise is on' : 'Filter Noise is off'}</span>.
                </p>
              </div>

              <div className="noise-filter-category-list">
                {NOISE_FILTER_CATEGORY_OPTIONS.map((option) => (
                  <label className="noise-filter-category" key={option.key}>
                    <input
                      className="noise-filter-checkbox"
                      type="checkbox"
                      checked={noiseFilterDraft[option.key]}
                      onChange={(event) => handleToggleNoiseCategory(option.key, event.target.checked)}
                    />
                    <span className="noise-filter-category-copy">
                      <span className="noise-filter-category-label">{option.label}</span>
                      <span className="noise-filter-category-description">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>

              <label className="settings-field" htmlFor="noise-filter-url-patterns">
                <span className="settings-label">Custom URL patterns</span>
                <input
                  id="noise-filter-url-patterns"
                  className="settings-input"
                  type="text"
                  value={customUrlPatternsInput}
                  onChange={(event) => setCustomUrlPatternsInput(event.target.value)}
                  placeholder="/collect, /internal/*, *tracking*"
                  autoComplete="off"
                  spellCheck={false}
                />
                <span className="noise-filter-input-hint">Comma-separated substrings or glob patterns.</span>
              </label>

              <label className="settings-field" htmlFor="noise-filter-domains">
                <span className="settings-label">Custom domains</span>
                <input
                  id="noise-filter-domains"
                  className="settings-input"
                  type="text"
                  value={customDomainsInput}
                  onChange={(event) => setCustomDomainsInput(event.target.value)}
                  placeholder="analytics.example.com, tracker.internal"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>

              <div className="noise-filter-actions">
                <Button variant="ghost" size="sm" onClick={handleResetNoiseFilters}>
                  Reset to defaults
                </Button>
                <Button variant="secondary" size="sm" onClick={handleApplyNoiseFilters}>
                  Apply
                </Button>
              </div>
            </section>
          ) : null}
        </div>

        <div className="export-menu" ref={exportMenuRef}>
          <Button
            className="export-button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setExportMenuOpen((previous) => !previous);
              setSettingsOpen(false);
              setNoiseFilterOpen(false);
            }}
            aria-haspopup="menu"
            aria-expanded={exportMenuOpen ? 'true' : 'false'}
          >
            Export
          </Button>
          {exportMenuOpen ? (
            <div className="export-menu-panel" role="menu">
              <Button
                className="export-menu-item"
                variant="menu"
                size="sm"
                role="menuitem"
                disabled={!canExportSnapshot || isCapturingCookies}
                onClick={handleExportSnapshot}
              >
                Snapshot JSON
              </Button>
              <Button
                className="export-menu-item"
                variant="menu"
                size="sm"
                role="menuitem"
                disabled={!canExportMap || isExportingMap}
                onClick={handleExportMap}
              >
                {isExportingMap ? 'Exporting Bundle...' : 'Structured Bundle (.zip)'}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="settings-menu" ref={settingsRef}>
          <Button
            className="settings-button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSettingsOpen((previous) => !previous);
              setExportMenuOpen(false);
              setNoiseFilterOpen(false);
            }}
            aria-haspopup="dialog"
            aria-expanded={settingsOpen ? 'true' : 'false'}
          >
            Settings
          </Button>

          {settingsOpen ? (
            <section className="settings-menu-panel" role="dialog" aria-label="Panel settings">
              {!isAISettingsLoaded ? (
                <p className="settings-loading">Loading AI settings...</p>
              ) : (
                <>
                  <div className="settings-field settings-toggle-field">
                    <span className="settings-label">AI Enrichment</span>
                    <Toggle
                      checked={aiSettings.enabled}
                      checkedLabel="On"
                      uncheckedLabel="Off"
                      checkedTone="info"
                      uncheckedTone="neutral"
                      onClick={() => onSetAIEnrichmentEnabled(!aiSettings.enabled)}
                    />
                  </div>

                  <label className="settings-field" htmlFor="provider-select">
                    <span className="settings-label">Provider</span>
                    <select
                      id="provider-select"
                      className="settings-select"
                      value={aiSettings.provider}
                      onChange={(event) => onSetAIProvider(event.target.value as AIProvider)}
                    >
                      {AI_PROVIDER_OPTIONS.map((providerOption) => (
                        <option key={providerOption.id} value={providerOption.id}>
                          {providerOption.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="settings-field" htmlFor="provider-api-key">
                    <span className="settings-label">API Key</span>
                    <input
                      id="provider-api-key"
                      className="settings-input"
                      type="password"
                      value={apiKeyForProvider}
                      onChange={(event) => onSetAIApiKey(aiSettings.provider, event.target.value)}
                      placeholder={`Paste ${getProviderLabel(aiSettings.provider)} API key`}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>

                  <p className="settings-note">Recommended model: {recommendedModel}</p>
                  <p className="settings-caption">
                    Stored locally in browser storage and sent only to {getProviderLabel(aiSettings.provider)} during
                    export.
                  </p>
                </>
              )}
            </section>
          ) : null}
        </div>
      </div>

      {aiProgress || statusOverride ? (
        <div className="toolbar-status-stack">
          {aiProgress ? (
            <div className="progress-block" aria-live="polite" role="status">
              <p className="progress-label">{aiProgress.message}</p>
              <div className="progress-track" aria-hidden="true">
                <div className="progress-fill" style={{ width: `${progressPercent}%` }}></div>
              </div>
            </div>
          ) : null}

          {statusOverride ? <p className="status-message">{statusOverride}</p> : null}
        </div>
      ) : null}
    </header>
  );
}
