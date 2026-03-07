import { Button, Toggle, Tooltip } from '@/src/design-system';
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

        <div className="export-menu" ref={menuRef}>
          <Button
            className="export-button"
            variant="secondary"
            size="sm"
            onClick={() => setMenuOpen((previous) => !previous)}
            aria-haspopup="menu"
            aria-expanded={menuOpen ? 'true' : 'false'}
          >
            Export
          </Button>
          {menuOpen ? (
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
                disabled={!canExportMap}
                onClick={handleExportMap}
              >
                Structured Bundle (.zip)
              </Button>
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
