import { useEffect, useRef, useState } from 'react';
import { formatSnapshotTime } from '../panel-utils';

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
}: PanelToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const snapshotSuffix = formatSnapshotTime(snapshotTime);

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleDocumentClick);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
    };
  }, []);

  const handleExportSnapshot = () => {
    setMenuOpen(false);
    onExportSnapshot();
  };

  const handleExportMap = () => {
    setMenuOpen(false);
    onExportMap();
  };

  return (
    <header className="panel-toolbar">
      <div className="toolbar-actions">
        <button
          className={`mode-toggle${isSnapshot ? ' is-frozen' : ' is-live'}`}
          type="button"
          onClick={onSnapshotToggle}
          title={isSnapshot && snapshotSuffix ? `Frozen at ${snapshotSuffix}` : undefined}
        >
          <span className="mode-indicator" aria-hidden="true"></span>
          {isSnapshot ? 'Frozen' : 'Live'}
        </button>

        <div className="export-menu" ref={menuRef}>
          <button
            className="export-button"
            type="button"
            onClick={() => setMenuOpen((previous) => !previous)}
            aria-haspopup="menu"
            aria-expanded={menuOpen ? 'true' : 'false'}
          >
            Export
          </button>
          {menuOpen ? (
            <div className="export-menu-panel" role="menu">
              <button
                className="export-menu-item"
                type="button"
                role="menuitem"
                disabled={!canExportSnapshot || isCapturingCookies}
                onClick={handleExportSnapshot}
              >
                Snapshot JSON
              </button>
              <button
                className="export-menu-item"
                type="button"
                role="menuitem"
                disabled={!canExportMap}
                onClick={handleExportMap}
              >
                Endpoint Map JSON
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {statusOverride ? (
        <p className="status-message" aria-live="polite">
          {statusOverride}
        </p>
      ) : null}
    </header>
  );
}
