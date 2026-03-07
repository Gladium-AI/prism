import { formatSnapshotTime } from '../panel-utils';

interface PanelToolbarProps {
  isSnapshot: boolean;
  isCapturingCookies: boolean;
  snapshotTime: Date | null;
  statusOverride: string | null;
  onSnapshotToggle(): void;
  onExportSnapshot(): void;
  onExportMap(): void;
  mapExportDisabled: boolean;
}

export function PanelToolbar({
  isSnapshot,
  isCapturingCookies,
  snapshotTime,
  statusOverride,
  onSnapshotToggle,
  onExportSnapshot,
  onExportMap,
  mapExportDisabled,
}: PanelToolbarProps) {
  const snapshotSuffix = formatSnapshotTime(snapshotTime);
  const liveIndicator = statusOverride
    ? statusOverride
    : isSnapshot
      ? `Snapshot frozen${snapshotSuffix ? ` at ${snapshotSuffix}` : ''}`
      : 'Live updates enabled';

  return (
    <header className="panel-toolbar">
      <div className="toolbar-title">
        <p className="eyebrow">Gladium AI</p>
        <h1>API Map</h1>
      </div>
      <div className="toolbar-actions">
        <button
          className={`snapshot-button${isSnapshot ? ' snapshot-active' : ''}`}
          type="button"
          onClick={onSnapshotToggle}
        >
          {isSnapshot ? 'Resume Live' : 'Take Snapshot'}
        </button>
        <button
          className="export-button"
          type="button"
          disabled={!isSnapshot || isCapturingCookies}
          onClick={onExportSnapshot}
        >
          Export JSON
        </button>
        <button
          className="export-button map-export-button"
          type="button"
          disabled={mapExportDisabled}
          onClick={onExportMap}
        >
          Export Map
        </button>
        <p className="live-indicator" aria-live="polite">
          {liveIndicator}
        </p>
      </div>
    </header>
  );
}
