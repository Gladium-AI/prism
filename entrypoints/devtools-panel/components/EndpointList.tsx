import type { SchemaObservation } from '@/core';
import { classifyGroups, getCompactPath, getDisplayMethod, getMethodClass, type PanelEndpointGroup } from '../panel-utils';

interface EndpointListProps {
  groups: PanelEndpointGroup[];
  requestCount: number;
  selectedEndpointKey: string | null;
  checkedEndpointKeys: Record<string, boolean>;
  collapsedSections: Record<string, boolean>;
  mergedSchemaByKey: Record<string, SchemaObservation | null>;
  onSelectEndpoint(endpointKey: string): void;
  onToggleChecked(endpointKey: string, checked: boolean): void;
  onToggleSection(sectionKey: 'graphql' | 'rest'): void;
  onSelectAll(): void;
  onSelectNone(): void;
}

function GroupHeader({
  label,
  count,
  collapsed,
  onClick,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onClick(): void;
}) {
  return (
    <div className="group-header" onClick={onClick}>
      <span className="group-toggle">{collapsed ? '▶' : '▼'}</span>
      <span className="group-label">{label}</span>
      <span className="group-count">{count}</span>
    </div>
  );
}

function EndpointRow({
  group,
  selectedEndpointKey,
  checkedEndpointKeys,
  mergedSchema,
  onSelectEndpoint,
  onToggleChecked,
}: {
  group: PanelEndpointGroup;
  selectedEndpointKey: string | null;
  checkedEndpointKeys: Record<string, boolean>;
  mergedSchema: SchemaObservation | null;
  onSelectEndpoint(endpointKey: string): void;
  onToggleChecked(endpointKey: string, checked: boolean): void;
}) {
  const method = getDisplayMethod(group.method);
  const path = getCompactPath(group.normalizedUrl);
  const observationCount = group.entries.length;
  const isSelected = selectedEndpointKey === group.endpointKey;
  const isChecked = checkedEndpointKeys[group.endpointKey] === true;
  const hasAuth =
    mergedSchema?.request?.headers?.fields?.some((field) => field.isAuth === true) ?? false;

  return (
    <div
      className={`endpoint-row${isSelected ? ' active' : ''}`}
      role="option"
      data-endpoint-key={group.endpointKey}
      aria-selected={isSelected ? 'true' : 'false'}
      onClick={() => onSelectEndpoint(group.endpointKey)}
    >
      <div className="row-top">
        <input
          className="endpoint-checkbox"
          type="checkbox"
          title="Include in export"
          checked={isChecked}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onToggleChecked(group.endpointKey, event.target.checked)}
        />
        <span className={`method-chip ${getMethodClass(method)}`}>{method}</span>
        <span className="endpoint-path" title={group.endpointKey}>
          {path}
          {hasAuth ? (
            <span className="auth-indicator" title="Auth headers detected on this endpoint">
              🔑
            </span>
          ) : null}
        </span>
        <span className="obs-chip">{observationCount}</span>
      </div>
    </div>
  );
}

export function EndpointList({
  groups,
  requestCount,
  selectedEndpointKey,
  checkedEndpointKeys,
  collapsedSections,
  mergedSchemaByKey,
  onSelectEndpoint,
  onToggleChecked,
  onToggleSection,
  onSelectAll,
  onSelectNone,
}: EndpointListProps) {
  const classified = classifyGroups(groups);

  return (
    <article className="pane list-pane" aria-label="Endpoints">
      <header className="pane-header">
        <h2>Endpoints</h2>
        <span className="count-pill">{groups.length}</span>
        <span className="count-pill request-pill" title="Total observations">
          {requestCount} observations
        </span>
        <span className="selection-controls">
          <button className="select-control" type="button" title="Select all" onClick={onSelectAll}>
            All
          </button>
          <button className="select-control" type="button" title="Deselect all" onClick={onSelectNone}>
            None
          </button>
        </span>
      </header>

      <div className="endpoint-list" role="listbox" aria-label="Discovered endpoints">
        {!groups.length ? (
          <div className="empty-state">
            No endpoints discovered yet. Trigger network activity to populate the map.
          </div>
        ) : classified.graphql.length > 0 ? (
          <>
            <GroupHeader
              label="GraphQL"
              count={classified.graphql.length}
              collapsed={collapsedSections.graphql === true}
              onClick={() => onToggleSection('graphql')}
            />
            {collapsedSections.graphql === true
              ? null
              : classified.graphql.map((group) => (
                  <EndpointRow
                    key={group.endpointKey}
                    group={group}
                    selectedEndpointKey={selectedEndpointKey}
                    checkedEndpointKeys={checkedEndpointKeys}
                    mergedSchema={mergedSchemaByKey[group.endpointKey]}
                    onSelectEndpoint={onSelectEndpoint}
                    onToggleChecked={onToggleChecked}
                  />
                ))}
            <GroupHeader
              label="REST"
              count={classified.rest.length}
              collapsed={collapsedSections.rest === true}
              onClick={() => onToggleSection('rest')}
            />
            {collapsedSections.rest === true
              ? null
              : classified.rest.map((group) => (
                  <EndpointRow
                    key={group.endpointKey}
                    group={group}
                    selectedEndpointKey={selectedEndpointKey}
                    checkedEndpointKeys={checkedEndpointKeys}
                    mergedSchema={mergedSchemaByKey[group.endpointKey]}
                    onSelectEndpoint={onSelectEndpoint}
                    onToggleChecked={onToggleChecked}
                  />
                ))}
          </>
        ) : (
          groups.map((group) => (
            <EndpointRow
              key={group.endpointKey}
              group={group}
              selectedEndpointKey={selectedEndpointKey}
              checkedEndpointKeys={checkedEndpointKeys}
              mergedSchema={mergedSchemaByKey[group.endpointKey]}
              onSelectEndpoint={onSelectEndpoint}
              onToggleChecked={onToggleChecked}
            />
          ))
        )}
      </div>
    </article>
  );
}
