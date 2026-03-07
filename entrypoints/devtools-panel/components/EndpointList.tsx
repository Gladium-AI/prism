import { Badge, Button, type BadgeVariant, Tooltip } from '@/src/design-system';
import type { SchemaObservation } from '@/core';
import {
  classifyGroups,
  getCompactPath,
  getDisplayMethod,
  getMethodClass,
  type PanelEndpointGroup,
} from '../panel-utils';

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

const badgeVariantByMethodClass: Record<'method-get' | 'method-write' | 'method-other', BadgeVariant> = {
  'method-get': 'methodGet',
  'method-write': 'methodWrite',
  'method-other': 'methodOther',
};

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
    <button className="group-header" type="button" onClick={onClick}>
      <span className="group-toggle" aria-hidden="true">
        {collapsed ? '▶' : '▼'}
      </span>
      <span className="group-label">{label}</span>
      <Badge className="group-count" variant="subtle" uppercase={false}>
        {count}
      </Badge>
    </button>
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
  const methodClass = getMethodClass(method);
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

        <Badge variant={badgeVariantByMethodClass[methodClass]}>{method}</Badge>

        <span className="endpoint-path" title={group.endpointKey}>
          {path}
          {hasAuth ? (
            <Tooltip label="Auth headers detected on this endpoint">
              <span className="auth-indicator" aria-label="Auth headers detected on this endpoint">
                🔑
              </span>
            </Tooltip>
          ) : null}
        </span>

        <Badge className="obs-chip" variant="subtle" uppercase={false}>
          {observationCount}
        </Badge>
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
        <Badge className="count-pill" variant="count" uppercase={false}>
          {groups.length}
        </Badge>
        <Badge className="request-pill" variant="info" uppercase={false} title="Total observations">
          {requestCount} observations
        </Badge>
        <span className="selection-controls">
          <Button className="select-control" variant="ghost" size="xs" title="Select all" onClick={onSelectAll}>
            All
          </Button>
          <Button
            className="select-control"
            variant="ghost"
            size="xs"
            title="Deselect all"
            onClick={onSelectNone}
          >
            None
          </Button>
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
