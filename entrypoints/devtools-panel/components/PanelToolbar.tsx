import { Button, Toggle, Tooltip } from '@/src/design-system';
import { useEffect, useRef, useState } from 'react';
import {
  AI_PROVIDER_OPTIONS,
  getProviderLabel,
  getRecommendedModel,
  type AIEnrichmentSettings,
  type AIProvider,
} from '../ai-settings';
import { formatSnapshotTime } from '../panel-utils';

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
  aiProgress: AIProgressState | null;
  onSetAIProvider(provider: AIProvider): void;
  onSetAIEnrichmentEnabled(enabled: boolean): void;
  onSetAIApiKey(provider: AIProvider, apiKey: string): void;
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
  aiProgress,
  onSetAIProvider,
  onSetAIEnrichmentEnabled,
  onSetAIApiKey,
}: PanelToolbarProps) {
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const snapshotSuffix = formatSnapshotTime(snapshotTime);
  const apiKeyForProvider = aiSettings.apiKeys[aiSettings.provider] ?? '';
  const recommendedModel = getRecommendedModel(aiSettings.provider);
  const progressPercent =
    aiProgress && aiProgress.total > 0
      ? Math.min(100, Math.max(0, Math.round((aiProgress.completed / aiProgress.total) * 100)))
      : 0;

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedExportMenu = exportMenuRef.current?.contains(target);
      const clickedSettingsMenu = settingsRef.current?.contains(target);

      if (!clickedExportMenu) {
        setExportMenuOpen(false);
      }
      if (!clickedSettingsMenu) {
        setSettingsOpen(false);
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

        <div className="export-menu" ref={exportMenuRef}>
          <Button
            className="export-button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setExportMenuOpen((previous) => !previous);
              setSettingsOpen(false);
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
