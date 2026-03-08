import {
  Badge,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
} from '@/src/design-system';
import {
  isGraphQLRequest,
  parseGraphQLOperation,
  type GraphQLSelectionField,
  type HeaderLike,
  type MergedGraphQLOperation,
  type RecordedNetworkEntry,
  type SchemaObservation,
} from '@/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildHeaderValuesMap,
  classifyGroups,
  getCompactPath,
  getDisplayMethod,
  getMethodClass,
  inferSemanticGroup,
  isLikelyAuthHeaderName,
  truncateValue,
  type PanelEndpointGroup,
} from '../panel-utils';
import { EndpointList } from './EndpointList';
import { BodySchemaView, JsonSchemaTree } from './SchemaView';

export type PanelTabId = 'dashboard' | 'mapping-tree' | 'sequence-flow';

export const PANEL_TABS: Array<{ id: PanelTabId; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'mapping-tree', label: 'Mapping Tree' },
  { id: 'sequence-flow', label: 'Sequence Flow' },
];

const methodBadgeVariantByClass = {
  'method-get': 'methodGet',
  'method-write': 'methodWrite',
  'method-other': 'methodOther',
} as const;

type MethodClass = keyof typeof methodBadgeVariantByClass;

type GraphQLOperationExplorerTab = 'schema' | 'explorer';
type SequenceDetailTab =
  | 'headers'
  | 'auth'
  | 'cookies'
  | 'graphql'
  | 'variables'
  | 'request-body'
  | 'incoming'
  | 'response-headers';

const SEQUENCE_OVERVIEW_PAGE_SIZE = 120;

interface HeaderPreviewRow {
  name: string;
  value: string;
  type: string;
  isAuth: boolean;
}

interface CookieSignalRow {
  name: string;
  value: string;
  observedCount: number;
}

interface DashboardTabProps {
  groups: PanelEndpointGroup[];
  displayEntries: RecordedNetworkEntry[];
  selectedEndpointKey: string | null;
  checkedEndpointKeys: Record<string, boolean>;
  collapsedSections: Record<string, boolean>;
  mergedSchemaByKey: Record<string, SchemaObservation | null>;
  graphQLOperationByKey: Record<string, MergedGraphQLOperation | null>;
  selectedGroup: PanelEndpointGroup | null;
  selectedMergedSchema: SchemaObservation | null;
  selectedGraphQLOperation: MergedGraphQLOperation | null;
  onSelectEndpoint(endpointKey: string): void;
  onToggleChecked(endpointKey: string, checked: boolean): void;
  onToggleSection(sectionKey: 'graphql' | 'rest'): void;
  onSelectAll(): void;
  onSelectNone(): void;
}

interface MappingTreeTabProps {
  groups: PanelEndpointGroup[];
  displayEntries: RecordedNetworkEntry[];
  selectedEndpointKey: string | null;
  checkedEndpointKeys: Record<string, boolean>;
  mergedSchemaByKey: Record<string, SchemaObservation | null>;
  graphQLOperationByKey: Record<string, MergedGraphQLOperation | null>;
  selectedGroup: PanelEndpointGroup | null;
  selectedMergedSchema: SchemaObservation | null;
  selectedGraphQLOperation: MergedGraphQLOperation | null;
  onSelectEndpoint(endpointKey: string): void;
  onToggleChecked(endpointKey: string, checked: boolean): void;
  onSetBranchChecked(endpointKeys: string[], checked: boolean): void;
  onSelectAll(): void;
  onSelectNone(): void;
}

interface SequenceFlowTabProps {
  groups: PanelEndpointGroup[];
  displayEntries: RecordedNetworkEntry[];
  onSelectEndpoint(endpointKey: string): void;
}

interface SessionAuthHeader {
  name: string;
  values: string[];
  observationCount: number;
}

interface MappingTreeBranch {
  key: string;
  label: string;
  apiType: 'graphql' | 'rest';
  endpoints: Array<{
    group: PanelEndpointGroup;
    graphQLOperation: MergedGraphQLOperation | null;
    hasAuth: boolean;
  }>;
  inferredCount: number;
}

function normalizeHeaderValue(rawValue: unknown): string {
  return rawValue == null ? '' : String(rawValue);
}

function parseCookiePair(rawPair: string): { name: string; value: string } | null {
  const normalized = rawPair.trim();
  if (!normalized) {
    return null;
  }

  const separatorIndex = normalized.indexOf('=');
  if (separatorIndex < 0) {
    return null;
  }

  const name = normalized.slice(0, separatorIndex).trim();
  const value = normalized.slice(separatorIndex + 1).trim();
  if (!name) {
    return null;
  }

  return { name, value };
}

function addCookieSignal(
  map: Map<string, CookieSignalRow>,
  signal: { name: string; value: string },
  count = 1,
): void {
  const key = `${signal.name}\u0000${signal.value}`;
  const existing = map.get(key);
  if (existing) {
    existing.observedCount += count;
    return;
  }

  map.set(key, {
    name: signal.name,
    value: signal.value,
    observedCount: count,
  });
}

function sortCookieSignals(rows: Iterable<CookieSignalRow>): CookieSignalRow[] {
  return Array.from(rows).sort((left, right) => {
    const countDiff = right.observedCount - left.observedCount;
    if (countDiff !== 0) {
      return countDiff;
    }
    return left.name.localeCompare(right.name);
  });
}

function mergeCookieSignals(...sources: ReadonlyArray<readonly CookieSignalRow[]>): CookieSignalRow[] {
  const map = new Map<string, CookieSignalRow>();
  for (const source of sources) {
    for (const cookie of source) {
      addCookieSignal(map, { name: cookie.name, value: cookie.value }, cookie.observedCount);
    }
  }
  return sortCookieSignals(map.values());
}

function extractSentCookieSignalsFromHeaders(headers: readonly HeaderLike[]): CookieSignalRow[] {
  const map = new Map<string, CookieSignalRow>();

  for (const header of headers) {
    if (!header || header.name.toLowerCase() !== 'cookie') {
      continue;
    }

    const value = normalizeHeaderValue(header.value);
    const pieces = value.split(';');
    for (const piece of pieces) {
      const parsedPair = parseCookiePair(piece);
      if (!parsedPair) {
        continue;
      }
      addCookieSignal(map, parsedPair);
    }
  }

  return sortCookieSignals(map.values());
}

function extractCapturedCookieSignalsFromHeaders(headers: readonly HeaderLike[]): CookieSignalRow[] {
  const map = new Map<string, CookieSignalRow>();

  for (const header of headers) {
    if (!header || header.name.toLowerCase() !== 'set-cookie') {
      continue;
    }

    const value = normalizeHeaderValue(header.value);
    const firstSegment = value.split(';')[0] ?? '';
    const parsedPair = parseCookiePair(firstSegment);
    if (!parsedPair) {
      continue;
    }

    addCookieSignal(map, parsedPair);
  }

  return sortCookieSignals(map.values());
}

function extractCookieSignalsFromRecordedCookies(
  cookies:
    | readonly {
        name: string;
        value: string;
      }[]
    | null
    | undefined,
): CookieSignalRow[] {
  const map = new Map<string, CookieSignalRow>();
  if (!Array.isArray(cookies) || cookies.length === 0) {
    return [];
  }

  for (const cookie of cookies) {
    if (!cookie || typeof cookie.name !== 'string' || cookie.name.length === 0) {
      continue;
    }
    addCookieSignal(map, {
      name: cookie.name,
      value: typeof cookie.value === 'string' ? cookie.value : '',
    });
  }

  return sortCookieSignals(map.values());
}

function collectCookieSignals(entries: readonly RecordedNetworkEntry[]): {
  sent: CookieSignalRow[];
  captured: CookieSignalRow[];
} {
  const sentMap = new Map<string, CookieSignalRow>();
  const capturedMap = new Map<string, CookieSignalRow>();

  for (const entry of entries) {
    const sentCookies = mergeCookieSignals(
      extractCookieSignalsFromRecordedCookies(entry.request.cookies),
      extractSentCookieSignalsFromHeaders(entry.request.headers),
    );
    for (const cookie of sentCookies) {
      addCookieSignal(sentMap, { name: cookie.name, value: cookie.value }, cookie.observedCount);
    }

    const capturedCookies = mergeCookieSignals(
      extractCookieSignalsFromRecordedCookies(entry.response.cookies),
      extractCapturedCookieSignalsFromHeaders(entry.response.headers),
    );
    for (const cookie of capturedCookies) {
      addCookieSignal(capturedMap, { name: cookie.name, value: cookie.value }, cookie.observedCount);
    }
  }

  return {
    sent: sortCookieSignals(sentMap.values()),
    captured: sortCookieSignals(capturedMap.values()),
  };
}

function inferValueType(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return 'empty';
  }
  if (/^-?\d+$/.test(normalized)) {
    return 'integer';
  }
  if (/^-?\d*\.\d+$/.test(normalized)) {
    return 'number';
  }
  if (normalized === 'true' || normalized === 'false') {
    return 'boolean';
  }
  return 'string';
}

function formatDuration(durationMs: number | null | undefined): string {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
    return 'n/a';
  }

  if (durationMs < 10) {
    return `${durationMs.toFixed(1)} ms`;
  }

  return `${Math.round(durationMs)} ms`;
}

function toHeaderPreviewRowsFromRaw(headers: readonly HeaderLike[] | null | undefined): HeaderPreviewRow[] {
  if (!Array.isArray(headers) || headers.length === 0) {
    return [];
  }

  return headers.map((header) => {
    const name = typeof header?.name === 'string' ? header.name : '(unknown)';
    const value = normalizeHeaderValue(header?.value);
    return {
      name,
      value,
      type: inferValueType(value),
      isAuth: isLikelyAuthHeaderName(name),
    };
  });
}

function collectSessionAuthHeaders(entries: readonly RecordedNetworkEntry[]): SessionAuthHeader[] {
  const bucketByName = new Map<string, { displayName: string; values: Set<string>; observationCount: number }>();

  for (const entry of entries) {
    const seenInEntry = new Set<string>();

    for (const header of entry.request.headers) {
      if (!header || typeof header.name !== 'string' || !isLikelyAuthHeaderName(header.name)) {
        continue;
      }

      const normalizedName = header.name.toLowerCase();
      let bucket = bucketByName.get(normalizedName);
      if (!bucket) {
        bucket = {
          displayName: header.name,
          values: new Set<string>(),
          observationCount: 0,
        };
        bucketByName.set(normalizedName, bucket);
      }

      bucket.values.add(normalizeHeaderValue(header.value));

      if (!seenInEntry.has(normalizedName)) {
        bucket.observationCount += 1;
        seenInEntry.add(normalizedName);
      }
    }
  }

  return Array.from(bucketByName.entries())
    .sort((left, right) => {
      const countDiff = right[1].observationCount - left[1].observationCount;
      if (countDiff !== 0) {
        return countDiff;
      }
      return left[0].localeCompare(right[0]);
    })
    .map(([_, bucket]) => ({
      name: bucket.displayName,
      values: Array.from(bucket.values.values()),
      observationCount: bucket.observationCount,
    }));
}

function getEndpointDisplayLabel(args: {
  group: PanelEndpointGroup;
  graphQLOperation: MergedGraphQLOperation | null;
}): string {
  if (args.graphQLOperation?.operationName) {
    return args.graphQLOperation.operationName;
  }
  return getCompactPath(args.group.normalizedUrl);
}

function GraphQLSelectionTree({
  fields,
  parentSeenCount,
}: {
  fields: readonly GraphQLSelectionField[];
  parentSeenCount: number;
}) {
  if (!fields.length) {
    return <div className="schema-note">No fields detected</div>;
  }

  return (
    <ul className="graphql-selection-list">
      {fields.map((field) => {
        const nestedFields = Array.isArray(field.fields) ? field.fields : [];
        const seenCount = typeof field.seenCount === 'number' ? field.seenCount : null;
        const showSeenCount = seenCount != null && seenCount !== parentSeenCount;

        return (
          <li key={field.name}>
            <div className="graphql-selection-field">
              <span className="graphql-selection-name">{field.name}</span>
              {field.optional ? (
                <Badge className="schema-optional" variant="subtle" size="xs" uppercase={false}>
                  optional
                </Badge>
              ) : null}
              {showSeenCount ? (
                <Badge className="seen-count" variant="counter" size="xs" uppercase={false}>
                  {seenCount}
                </Badge>
              ) : null}
            </div>
            {nestedFields.length > 0 ? (
              <GraphQLSelectionTree
                fields={nestedFields}
                parentSeenCount={seenCount != null ? seenCount : parentSeenCount}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function HeaderPreviewTable({
  rows,
  emptyMessage,
  showAuthBadge = false,
  className,
}: {
  rows: HeaderPreviewRow[];
  emptyMessage: string;
  showAuthBadge?: boolean;
  className?: string;
}) {
  if (!rows.length) {
    return <div className="empty-state module-empty-state">{emptyMessage}</div>;
  }

  return (
    <DataTable className={`module-headers-table${className ? ` ${className}` : ''}`}>
      <DataTableHead>
        <DataTableRow>
          <DataTableHeaderCell>Header</DataTableHeaderCell>
          <DataTableHeaderCell>Observed Value</DataTableHeaderCell>
          <DataTableHeaderCell>Type</DataTableHeaderCell>
        </DataTableRow>
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => {
          const safeValue = row.value.length > 0 ? row.value : '(empty)';
          const displayValue = row.isAuth ? safeValue : truncateValue(safeValue, 96);

          return (
            <DataTableRow key={`${row.name}-${row.type}-${displayValue}`}>
              <DataTableCell className="module-header-name">
                <span className="module-header-name-content">
                  <span className="module-header-name-label">{row.name}</span>
                  {showAuthBadge && row.isAuth ? (
                    <Badge className="module-inline-badge" variant="danger" size="xs" uppercase={false}>
                      auth
                    </Badge>
                  ) : null}
                </span>
              </DataTableCell>
              <DataTableCell className="module-header-value" title={safeValue}>
                {displayValue}
              </DataTableCell>
              <DataTableCell className="module-header-type">{row.type}</DataTableCell>
            </DataTableRow>
          );
        })}
      </DataTableBody>
    </DataTable>
  );
}

function CookiesSignalList({
  title,
  rows,
  emptyMessage,
}: {
  title: string;
  rows: CookieSignalRow[];
  emptyMessage: string;
}) {
  return (
    <section className="cookie-signal-group">
      <p className="module-subsection-title">{title}</p>
      {!rows.length ? (
        <div className="empty-state module-empty-state">{emptyMessage}</div>
      ) : (
        <div className="cookie-signal-list">
          {rows.map((row) => (
            <article className="cookie-signal-row" key={`${row.name}\u0000${row.value}`}>
              <div className="cookie-signal-head">
                <span className="cookie-signal-name">{row.name}</span>
                <Badge variant="counter" uppercase={false}>
                  {row.observedCount}
                </Badge>
              </div>
              <code className="cookie-signal-value">{row.value || '(empty)'}</code>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function BranchSelectionCheckbox({
  checked,
  indeterminate,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange(nextChecked: boolean): void;
  ariaLabel: string;
}) {
  const checkboxRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      ref={checkboxRef}
      className="mapping-branch-checkbox"
      type="checkbox"
      checked={checked}
      aria-label={ariaLabel}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

function EndpointDetailsModules({
  displayEntries,
  selectedGroup,
  selectedMergedSchema,
  selectedGraphQLOperation,
  title,
}: {
  displayEntries: RecordedNetworkEntry[];
  selectedGroup: PanelEndpointGroup | null;
  selectedMergedSchema: SchemaObservation | null;
  selectedGraphQLOperation: MergedGraphQLOperation | null;
  title: string;
}) {
  const [graphQLTab, setGraphQLTab] = useState<GraphQLOperationExplorerTab>('schema');
  const [collapsedDetailCards, setCollapsedDetailCards] = useState<{
    auth: boolean;
    cookies: boolean;
    requestBody: boolean;
  }>({
    auth: true,
    cookies: true,
    requestBody: true,
  });

  useEffect(() => {
    setGraphQLTab('schema');
  }, [selectedGroup?.endpointKey]);

  useEffect(() => {
    setCollapsedDetailCards({
      auth: true,
      cookies: true,
      requestBody: true,
    });
  }, [selectedGroup?.endpointKey]);

  const sessionAuthHeaders = useMemo(() => collectSessionAuthHeaders(displayEntries), [displayEntries]);
  const endpointCookieSignals = useMemo(
    () => collectCookieSignals(selectedGroup?.entries ?? []),
    [selectedGroup],
  );

  if (!selectedGroup) {
    return (
      <section className="module-card">
        <header className="module-header">
          <h3>{title}</h3>
        </header>
        <div className="module-body">
          <div className="empty-state module-empty-state">Select an endpoint to inspect details.</div>
        </div>
      </section>
    );
  }

  const method = getDisplayMethod(selectedGroup.method);
  const methodClass = getMethodClass(method) as MethodClass;
  const observationCount = selectedGroup.entries.length;
  const endpointLabel = getEndpointDisplayLabel({
    group: selectedGroup,
    graphQLOperation: selectedGraphQLOperation,
  });
  const endpointPath = getCompactPath(selectedGroup.normalizedUrl);
  const requestHeaderValues = buildHeaderValuesMap(selectedGroup.entries, 'request');
  const requestHeaderRows = (selectedMergedSchema?.request.headers.fields ?? []).map((field) => {
    const observedValue = requestHeaderValues[field.name.toLowerCase()]?.[0] ?? '';
    return {
      name: field.name,
      value: observedValue,
      type: field.valueType || 'unknown',
      isAuth: field.isAuth === true,
    };
  });
  const requestBodyDefinition = getEndpointRequestBodyDefinition(selectedGroup.entries);
  const isRestEndpoint = selectedGraphQLOperation == null;

  return (
    <div className="module-stack">
      <section className="module-card">
        <header className="module-header">
          <h3>{title}</h3>
        </header>
        <div className="module-body module-summary-body">
          <div className="module-summary-meta">
            <Badge variant={methodBadgeVariantByClass[methodClass]}>{method}</Badge>
            <Badge variant={selectedGraphQLOperation ? 'apiGraphql' : 'apiRest'} uppercase={false}>
              {selectedGraphQLOperation ? 'GraphQL' : 'REST'}
            </Badge>
            <Badge variant="count" uppercase={false}>
              {observationCount}
            </Badge>
          </div>
          <p className="module-summary-title">{endpointLabel}</p>
          <p className="module-summary-subtitle">{endpointPath}</p>
        </div>
      </section>

      <section className="module-card">
        <header className="module-header">
          <div className="module-header-main">
            <h3>Authentication</h3>
            <Badge variant="count" uppercase={false}>
              {sessionAuthHeaders.length}
            </Badge>
          </div>
          <button
            className="module-collapse-toggle"
            type="button"
            aria-expanded={collapsedDetailCards.auth ? 'false' : 'true'}
            onClick={() =>
              setCollapsedDetailCards((previous) => ({
                ...previous,
                auth: !previous.auth,
              }))
            }
          >
            {collapsedDetailCards.auth ? 'Show' : 'Hide'}
          </button>
        </header>
        {collapsedDetailCards.auth ? null : (
          <div className="module-body auth-module-body">
            {!sessionAuthHeaders.length ? (
              <div className="empty-state module-empty-state">No auth headers observed in this session.</div>
            ) : (
              sessionAuthHeaders.map((header) => (
                <article className="auth-value-row" key={header.name}>
                  <div className="auth-value-head">
                    <span className="auth-value-name">{header.name}</span>
                    <Badge variant="counter" uppercase={false}>
                      {header.observationCount}
                    </Badge>
                  </div>
                  <div className="auth-value-list">
                    {header.values.map((value) => (
                      <code key={`${header.name}-${value}`} className="auth-value-pill">
                        {value.length > 0 ? value : '(empty)'}
                      </code>
                    ))}
                  </div>
                </article>
              ))
            )}
          </div>
        )}
      </section>

      <section className="module-card">
        <header className="module-header">
          <div className="module-header-main">
            <h3>Cookies</h3>
            <Badge variant="count" uppercase={false}>
              {endpointCookieSignals.sent.length + endpointCookieSignals.captured.length}
            </Badge>
          </div>
          <button
            className="module-collapse-toggle"
            type="button"
            aria-expanded={collapsedDetailCards.cookies ? 'false' : 'true'}
            onClick={() =>
              setCollapsedDetailCards((previous) => ({
                ...previous,
                cookies: !previous.cookies,
              }))
            }
          >
            {collapsedDetailCards.cookies ? 'Show' : 'Hide'}
          </button>
        </header>
        {collapsedDetailCards.cookies ? null : (
          <div className="module-body cookie-signal-stack">
            <CookiesSignalList
              title="Sent Cookies"
              rows={endpointCookieSignals.sent}
              emptyMessage="No request Cookie headers observed on this endpoint."
            />
            <CookiesSignalList
              title="Captured Cookies"
              rows={endpointCookieSignals.captured}
              emptyMessage="No Set-Cookie headers observed on this endpoint."
            />
          </div>
        )}
      </section>

      {isRestEndpoint ? (
        <section className="module-card">
          <header className="module-header">
            <div className="module-header-main">
              <h3>Request Body</h3>
              <Badge variant="count" uppercase={false}>
                {requestBodyDefinition.observedCount}
              </Badge>
            </div>
            <button
              className="module-collapse-toggle"
              type="button"
              aria-expanded={collapsedDetailCards.requestBody ? 'false' : 'true'}
              onClick={() =>
                setCollapsedDetailCards((previous) => ({
                  ...previous,
                  requestBody: !previous.requestBody,
                }))
              }
            >
              {collapsedDetailCards.requestBody ? 'Show' : 'Hide'}
            </button>
          </header>
          {collapsedDetailCards.requestBody ? null : (
            <div className="module-body">
              <div className="module-subsection">
                <p className="module-subsection-title">Schema</p>
                <BodySchemaView bodySchema={selectedMergedSchema?.request.body ?? null} />
              </div>
              <div className="module-subsection">
                <p className="module-subsection-title">Definition</p>
                {requestBodyDefinition.observedCount === 0 ? (
                  <div className="schema-note">No request bodies observed on this endpoint.</div>
                ) : (
                  <>
                    <div className="sequence-incoming-meta">
                      <span>Type: {requestBodyDefinition.contentType ?? 'unknown'}</span>
                      <span>Observed payloads: {requestBodyDefinition.observedCount}</span>
                    </div>
                    <pre className={`incoming-body-preview${requestBodyDefinition.kind === 'json' ? ' json' : ''}`}>
                      {requestBodyDefinition.kind === 'json'
                        ? tokenizeJson(requestBodyDefinition.body).map((token, index) => (
                            <span
                              key={`request-definition-token-${index}`}
                              className={token.kind === 'plain' ? undefined : `incoming-token ${token.kind}`}
                            >
                              {token.value}
                            </span>
                          ))
                        : requestBodyDefinition.body}
                    </pre>
                  </>
                )}
              </div>
            </div>
          )}
        </section>
      ) : null}

      <section className="module-card">
        <header className="module-header">
          <h3>GraphQL Operation</h3>
          <div className="module-tab-switch">
            <button
              className={`module-tab-button${graphQLTab === 'schema' ? ' active' : ''}`}
              type="button"
              onClick={() => setGraphQLTab('schema')}
            >
              Schema
            </button>
            <button
              className={`module-tab-button${graphQLTab === 'explorer' ? ' active' : ''}`}
              type="button"
              onClick={() => setGraphQLTab('explorer')}
            >
              Explorer
            </button>
          </div>
        </header>
        <div className="module-body">
          {!selectedGraphQLOperation ? (
            <div className="empty-state module-empty-state">
              Select a GraphQL endpoint to inspect operation type, variables, and selection set.
            </div>
          ) : graphQLTab === 'schema' ? (
            <div className="graphql-schema-stack">
              <div className="graphql-operation-head">
                <Badge variant="apiGraphql" uppercase={false}>
                  {selectedGraphQLOperation.operationType}
                </Badge>
                <span className="graphql-operation-name">
                  {selectedGraphQLOperation.operationName ?? selectedGraphQLOperation.operationKey}
                </span>
              </div>

              <div className="module-subsection">
                <p className="module-subsection-title">Variables Schema</p>
                {selectedGraphQLOperation.variablesSchema ? (
                  <JsonSchemaTree schema={selectedGraphQLOperation.variablesSchema} />
                ) : (
                  <div className="schema-note">No variables observed for this operation.</div>
                )}
              </div>

              <div className="module-subsection">
                <p className="module-subsection-title">Selection Set</p>
                {Array.isArray(selectedGraphQLOperation.selectionSet) && selectedGraphQLOperation.selectionSet.length ? (
                  <GraphQLSelectionTree
                    fields={selectedGraphQLOperation.selectionSet}
                    parentSeenCount={selectedGraphQLOperation.observationCount}
                  />
                ) : (
                  <div className="schema-note">No selection set detected.</div>
                )}
              </div>
            </div>
          ) : Array.isArray(selectedGraphQLOperation.rawQueries) && selectedGraphQLOperation.rawQueries.length ? (
            <div className="graphql-explorer-stack">
              {selectedGraphQLOperation.rawQueries.map((query, index) => (
                <pre className="graphql-raw-query" key={`${selectedGraphQLOperation.operationKey}-${index}`}>
                  {query}
                </pre>
              ))}
            </div>
          ) : (
            <div className="schema-note">Raw GraphQL query text is unavailable for this operation.</div>
          )}
        </div>
      </section>

      <section className="module-card">
        <header className="module-header">
          <h3>Request Headers</h3>
        </header>
        <div className="module-body">
          <HeaderPreviewTable
            rows={requestHeaderRows}
            emptyMessage="No request headers observed on the selected endpoint."
            showAuthBadge={true}
          />
        </div>
      </section>
    </div>
  );
}

function buildMappingTreeBranches(args: {
  groups: PanelEndpointGroup[];
  mergedSchemaByKey: Record<string, SchemaObservation | null>;
  graphQLOperationByKey: Record<string, MergedGraphQLOperation | null>;
}): MappingTreeBranch[] {
  const branchMap = new Map<string, MappingTreeBranch>();

  for (const group of args.groups) {
    const graphQLOperation = args.graphQLOperationByKey[group.endpointKey] ?? null;
    const apiType: 'graphql' | 'rest' = graphQLOperation ? 'graphql' : 'rest';
    const semanticGroup = inferSemanticGroup({
      normalizedUrl: group.normalizedUrl,
      operationName: graphQLOperation?.operationName,
      apiType,
    });
    const branchKey = `${apiType}-${semanticGroup.label.toLowerCase()}`;
    const hasAuth =
      args.mergedSchemaByKey[group.endpointKey]?.request.headers.fields.some((field) => field.isAuth) ?? false;

    let branch = branchMap.get(branchKey);
    if (!branch) {
      branch = {
        key: branchKey,
        label: semanticGroup.label,
        apiType,
        endpoints: [],
        inferredCount: 0,
      };
      branchMap.set(branchKey, branch);
    }

    branch.endpoints.push({
      group,
      graphQLOperation,
      hasAuth,
    });
    if (semanticGroup.isInferred) {
      branch.inferredCount += 1;
    }
  }

  return Array.from(branchMap.values())
    .map((branch) => ({
      ...branch,
      endpoints: branch.endpoints.slice().sort((left, right) => right.group.entries.length - left.group.entries.length),
    }))
    .sort((left, right) => {
      if (right.endpoints.length !== left.endpoints.length) {
        return right.endpoints.length - left.endpoints.length;
      }
      return left.label.localeCompare(right.label);
    });
}

function getSequenceStartMs(entry: RecordedNetworkEntry): number {
  const parsed = Date.parse(entry.timing.startedDateTime ?? '');
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return entry.id;
}

function parseJsonSafely(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function normalizeContentType(contentType: string | null | undefined): string | null {
  if (typeof contentType !== 'string') {
    return null;
  }

  const [mimeType = ''] = contentType.toLowerCase().split(';', 1);
  const normalized = mimeType.trim();
  return normalized.length > 0 ? normalized : null;
}

function shouldTreatAsJson(contentType: string | null | undefined, body: string): boolean {
  const normalizedType = normalizeContentType(contentType);
  if (normalizedType && (normalizedType.includes('json') || normalizedType.endsWith('+json'))) {
    return true;
  }

  const trimmed = body.trim();
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))
  );
}

type JsonHighlightTokenKind = 'plain' | 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punctuation';

interface JsonHighlightToken {
  kind: JsonHighlightTokenKind;
  value: string;
}

const JSON_TOKEN_REGEX = /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\],:]/g;

function tokenizeJson(value: string): JsonHighlightToken[] {
  const tokens: JsonHighlightToken[] = [];
  let index = 0;

  for (const match of value.matchAll(JSON_TOKEN_REGEX)) {
    const matchValue = match[0];
    const matchIndex = typeof match.index === 'number' ? match.index : -1;
    if (matchIndex < 0) {
      continue;
    }

    if (matchIndex > index) {
      tokens.push({
        kind: 'plain',
        value: value.slice(index, matchIndex),
      });
    }

    let kind: JsonHighlightTokenKind = 'number';
    if (matchValue === 'true' || matchValue === 'false') {
      kind = 'boolean';
    } else if (matchValue === 'null') {
      kind = 'null';
    } else if (/^[{}\[\],:]$/.test(matchValue)) {
      kind = 'punctuation';
    } else if (matchValue.startsWith('"')) {
      let cursor = matchIndex + matchValue.length;
      while (cursor < value.length && /\s/.test(value[cursor] ?? '')) {
        cursor += 1;
      }
      kind = value[cursor] === ':' ? 'key' : 'string';
    }

    tokens.push({
      kind,
      value: matchValue,
    });
    index = matchIndex + matchValue.length;
  }

  if (index < value.length) {
    tokens.push({
      kind: 'plain',
      value: value.slice(index),
    });
  }

  return tokens;
}

interface BodyDisplay {
  contentType: string | null;
  kind: 'json' | 'plain';
  body: string;
}

function getHeaderValue(
  headers: readonly HeaderLike[] | null | undefined,
  targetName: string,
): string | null {
  if (!Array.isArray(headers) || headers.length === 0) {
    return null;
  }

  const normalizedName = targetName.toLowerCase();
  for (const header of headers) {
    if (!header || typeof header.name !== 'string' || header.name.toLowerCase() !== normalizedName) {
      continue;
    }
    const normalizedValue = normalizeHeaderValue(header.value).trim();
    if (normalizedValue.length > 0) {
      return normalizedValue;
    }
  }

  return null;
}

function getBodyDisplay(body: string, contentType: string | null | undefined): BodyDisplay {
  const normalizedType = normalizeContentType(contentType);
  if (body.length === 0) {
    return {
      contentType: normalizedType,
      kind: 'plain',
      body: '(empty body)',
    };
  }

  if (!shouldTreatAsJson(contentType, body)) {
    return {
      contentType: normalizedType,
      kind: 'plain',
      body,
    };
  }

  const parsed = parseJsonSafely(body);
  if (parsed === undefined) {
    return {
      contentType: normalizedType,
      kind: 'plain',
      body,
    };
  }

  return {
    contentType: normalizedType,
    kind: 'json',
    body: stringifyJson(parsed),
  };
}

function getIncomingBodyDisplay(entry: RecordedNetworkEntry | null): BodyDisplay {
  if (!entry) {
    return {
      contentType: null,
      kind: 'plain',
      body: '(empty body)',
    };
  }

  const body = typeof entry.response.body === 'string' ? entry.response.body : '';
  return getBodyDisplay(body, entry.response.contentType);
}

function getRequestBodyDisplay(entry: RecordedNetworkEntry | null): BodyDisplay {
  if (!entry) {
    return {
      contentType: null,
      kind: 'plain',
      body: '(empty body)',
    };
  }

  const body = typeof entry.request.body === 'string' ? entry.request.body : '';
  const requestContentType = getHeaderValue(entry.request.headers, 'content-type');
  return getBodyDisplay(body, requestContentType);
}

interface RequestBodyDefinitionDisplay extends BodyDisplay {
  observedCount: number;
}

function getEndpointRequestBodyDefinition(entries: readonly RecordedNetworkEntry[]): RequestBodyDefinitionDisplay {
  let latestEntryWithBody: RecordedNetworkEntry | null = null;
  let observedCount = 0;

  for (const entry of entries) {
    const body = entry.request.body;
    if (typeof body !== 'string' || body.length === 0) {
      continue;
    }

    observedCount += 1;
    latestEntryWithBody = entry;
  }

  if (!latestEntryWithBody) {
    return {
      contentType: null,
      kind: 'plain',
      body: '(empty body)',
      observedCount: 0,
    };
  }

  const bodyDisplay = getRequestBodyDisplay(latestEntryWithBody);
  return {
    ...bodyDisplay,
    observedCount,
  };
}

function extractGraphQLVariablesPayload(entry: RecordedNetworkEntry): unknown {
  const body = entry.request.body;
  if (typeof body === 'string' && body.trim().length > 0) {
    const parsedBody = parseJsonSafely(body);
    if (parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody)) {
      const record = parsedBody as Record<string, unknown>;
      if ('variables' in record) {
        return record.variables ?? null;
      }
    }

    const bodyParams = new URLSearchParams(body);
    const variablesParam = bodyParams.get('variables');
    if (variablesParam) {
      const parsedVariables = parseJsonSafely(variablesParam);
      return parsedVariables !== undefined ? parsedVariables : variablesParam;
    }
  }

  if (typeof entry.request.url === 'string' && entry.request.url.length > 0) {
    try {
      const parsedUrl = new URL(entry.request.url);
      const variablesParam = parsedUrl.searchParams.get('variables');
      if (variablesParam) {
        const parsedVariables = parseJsonSafely(variablesParam);
        return parsedVariables !== undefined ? parsedVariables : variablesParam;
      }
    } catch {
      // Ignore invalid URLs.
    }
  }

  return null;
}

function stringifyJson(value: unknown): string {
  if (value == null) {
    return '(empty)';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getSequenceEntryKind(entry: RecordedNetworkEntry): 'graphql' | 'rest' | 'auth' {
  if (isGraphQLRequest(entry.request)) {
    return 'graphql';
  }

  const hasRequestAuthHeader = entry.request.headers.some((header) => isLikelyAuthHeaderName(header.name));
  const hasResponseAuthCookie = entry.response.headers.some((header) => {
    if (!header || typeof header.name !== 'string') {
      return false;
    }
    return header.name.toLowerCase() === 'set-cookie';
  });

  if (hasRequestAuthHeader || hasResponseAuthCookie) {
    return 'auth';
  }

  return 'rest';
}

export function DashboardTab({
  groups,
  displayEntries,
  selectedEndpointKey,
  checkedEndpointKeys,
  collapsedSections,
  mergedSchemaByKey,
  graphQLOperationByKey,
  selectedGroup,
  selectedMergedSchema,
  selectedGraphQLOperation,
  onSelectEndpoint,
  onToggleChecked,
  onToggleSection,
  onSelectAll,
  onSelectNone,
}: DashboardTabProps) {
  const classified = useMemo(() => classifyGroups(groups), [groups]);
  const graphQLCount = classified.graphql.length;
  const restCount = classified.rest.length;
  const authEndpointCount = useMemo(
    () =>
      groups.filter(
        (group) => mergedSchemaByKey[group.endpointKey]?.request.headers.fields.some((field) => field.isAuth) ?? false,
      ).length,
    [groups, mergedSchemaByKey],
  );

  const graphQLRatio = groups.length > 0 ? Math.round((graphQLCount / groups.length) * 100) : 0;
  const restRatio = groups.length > 0 ? Math.round((restCount / groups.length) * 100) : 0;

  return (
    <section className="dashboard-view" aria-label="Dashboard view">
      <div className="dashboard-column dashboard-column-primary">
        <article className="pane dashboard-module stats-module" aria-label="Overview and stats">
          <header className="pane-header">
            <h2>Overview &amp; Stats</h2>
            <Badge variant="count" uppercase={false}>
              {groups.length} endpoints
            </Badge>
          </header>
          <div className="dashboard-stats">
            <div className="stat-card">
              <p className="stat-label">Endpoints</p>
              <p className="stat-value">{groups.length}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Observations</p>
              <p className="stat-value">{displayEntries.length}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">GraphQL</p>
              <p className="stat-value">
                {graphQLCount}
                <span className="stat-subvalue">{graphQLRatio}%</span>
              </p>
            </div>
            <div className="stat-card">
              <p className="stat-label">REST</p>
              <p className="stat-value">
                {restCount}
                <span className="stat-subvalue">{restRatio}%</span>
              </p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Auth-Touched</p>
              <p className="stat-value">{authEndpointCount}</p>
            </div>
          </div>
        </article>

        <EndpointList
          groups={groups}
          requestCount={displayEntries.length}
          selectedEndpointKey={selectedEndpointKey}
          checkedEndpointKeys={checkedEndpointKeys}
          collapsedSections={collapsedSections}
          mergedSchemaByKey={mergedSchemaByKey}
          graphQLOperationByKey={graphQLOperationByKey}
          onSelectEndpoint={onSelectEndpoint}
          onToggleChecked={onToggleChecked}
          onToggleSection={onToggleSection}
          onSelectAll={onSelectAll}
          onSelectNone={onSelectNone}
        />
      </div>

      <div className="dashboard-column dashboard-column-secondary">
        <EndpointDetailsModules
          displayEntries={displayEntries}
          selectedGroup={selectedGroup}
          selectedMergedSchema={selectedMergedSchema}
          selectedGraphQLOperation={selectedGraphQLOperation}
          title="Endpoint Details"
        />
      </div>
    </section>
  );
}

export function MappingTreeTab({
  groups,
  displayEntries,
  selectedEndpointKey,
  checkedEndpointKeys,
  mergedSchemaByKey,
  graphQLOperationByKey,
  selectedGroup,
  selectedMergedSchema,
  selectedGraphQLOperation,
  onSelectEndpoint,
  onToggleChecked,
  onSetBranchChecked,
  onSelectAll,
  onSelectNone,
}: MappingTreeTabProps) {
  const [collapsedBranches, setCollapsedBranches] = useState<Record<string, boolean>>({});

  const branches = useMemo(
    () =>
      buildMappingTreeBranches({
        groups,
        mergedSchemaByKey,
        graphQLOperationByKey,
      }),
    [groups, mergedSchemaByKey, graphQLOperationByKey],
  );

  useEffect(() => {
    setCollapsedBranches((previous) => {
      const branchKeys = new Set(branches.map((branch) => branch.key));
      const next: Record<string, boolean> = {};

      for (const key of Object.keys(previous)) {
        if (branchKeys.has(key)) {
          next[key] = previous[key];
        }
      }

      return next;
    });
  }, [branches]);

  const graphQLCount = useMemo(
    () => branches.filter((branch) => branch.apiType === 'graphql').reduce((sum, branch) => sum + branch.endpoints.length, 0),
    [branches],
  );
  const restCount = groups.length - graphQLCount;
  const inferredCount = useMemo(() => branches.reduce((sum, branch) => sum + branch.inferredCount, 0), [branches]);

  const graphQLRatio = groups.length > 0 ? Math.round((graphQLCount / groups.length) * 100) : 0;
  const restRatio = groups.length > 0 ? Math.round((restCount / groups.length) * 100) : 0;
  const inferredRatio = groups.length > 0 ? Math.round((inferredCount / groups.length) * 100) : 0;

  return (
    <section className="mapping-view" aria-label="Mapping tree view">
      <div className="mapping-main">
        <article className="pane mapping-overview-pane" aria-label="Mapping overview">
          <header className="pane-header">
            <h2>Mapping Overview</h2>
            <Badge variant="count" uppercase={false}>
              {groups.length} total
            </Badge>
          </header>
          <div className="mapping-overview-grid">
            <div className="mapping-ratio-row">
              <span className="mapping-ratio-label">GraphQL</span>
              <div className="mapping-ratio-track">
                <span className="mapping-ratio-fill graphql" style={{ width: `${graphQLRatio}%` }}></span>
              </div>
              <span className="mapping-ratio-meta">
                {graphQLCount} <em>{graphQLRatio}%</em>
              </span>
            </div>
            <div className="mapping-ratio-row">
              <span className="mapping-ratio-label">REST</span>
              <div className="mapping-ratio-track">
                <span className="mapping-ratio-fill rest" style={{ width: `${restRatio}%` }}></span>
              </div>
              <span className="mapping-ratio-meta">
                {restCount} <em>{restRatio}%</em>
              </span>
            </div>
            <div className="mapping-ratio-row">
              <span className="mapping-ratio-label">AI-enriched</span>
              <div className="mapping-ratio-track">
                <span className="mapping-ratio-fill ai" style={{ width: `${inferredRatio}%` }}></span>
              </div>
              <span className="mapping-ratio-meta">
                {inferredCount} <em>{inferredRatio}%</em>
              </span>
            </div>
          </div>
        </article>

        <article className="pane mapping-tree-pane" aria-label="API mapping tree">
          <header className="pane-header">
            <h2>Mapping Tree</h2>
            <div className="mapping-pane-controls">
              <Badge variant="count" uppercase={false}>
                {branches.length} groups
              </Badge>
              <span className="selection-controls">
                <button className="mapping-select-button" type="button" onClick={onSelectAll}>
                  All
                </button>
                <button className="mapping-select-button" type="button" onClick={onSelectNone}>
                  None
                </button>
              </span>
            </div>
          </header>

          <div className="mapping-tree-scroll">
            {!groups.length ? (
              <div className="empty-state">No endpoints discovered yet.</div>
            ) : (
              branches.map((branch) => {
                const isCollapsed = collapsedBranches[branch.key] === true;
                const branchEndpointKeys = branch.endpoints.map((endpoint) => endpoint.group.endpointKey);
                const checkedCount = branchEndpointKeys.filter((key) => checkedEndpointKeys[key] === true).length;
                const isFullyChecked = branchEndpointKeys.length > 0 && checkedCount === branchEndpointKeys.length;
                const isPartiallyChecked = checkedCount > 0 && checkedCount < branchEndpointKeys.length;

                return (
                  <section className="mapping-branch" key={branch.key}>
                    <div className="mapping-branch-header">
                      <button
                        className="mapping-branch-toggle-button"
                        type="button"
                        aria-expanded={isCollapsed ? 'false' : 'true'}
                        onClick={() =>
                          setCollapsedBranches((previous) => ({
                            ...previous,
                            [branch.key]: !previous[branch.key],
                          }))
                        }
                      >
                        <span className="mapping-branch-toggle" aria-hidden="true">
                          {isCollapsed ? '▶' : '▼'}
                        </span>
                      </button>
                      <BranchSelectionCheckbox
                        checked={isFullyChecked}
                        indeterminate={isPartiallyChecked}
                        ariaLabel={`Select ${branch.label}`}
                        onChange={(nextChecked) => onSetBranchChecked(branchEndpointKeys, nextChecked)}
                      />
                      <span className="mapping-branch-label">{branch.label}</span>
                      <Badge variant={branch.apiType === 'graphql' ? 'apiGraphql' : 'apiRest'} uppercase={false}>
                        {branch.apiType.toUpperCase()}
                      </Badge>
                      <Badge variant="counter" uppercase={false}>
                        {branch.endpoints.length}
                      </Badge>
                    </div>

                    {isCollapsed ? null : (
                      <div className="mapping-node-list">
                        {branch.endpoints.map((node) => {
                          const method = getDisplayMethod(node.group.method);
                          const methodClass = getMethodClass(method) as MethodClass;
                          const label = getEndpointDisplayLabel({
                            group: node.group,
                            graphQLOperation: node.graphQLOperation,
                          });
                          const isActive = selectedEndpointKey === node.group.endpointKey;

                          return (
                            <div
                              className={`mapping-node${isActive ? ' active' : ''}`}
                              role="button"
                              tabIndex={0}
                              key={node.group.endpointKey}
                              onClick={() => onSelectEndpoint(node.group.endpointKey)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  onSelectEndpoint(node.group.endpointKey);
                                }
                              }}
                            >
                              <input
                                className="mapping-node-checkbox"
                                type="checkbox"
                                checked={checkedEndpointKeys[node.group.endpointKey] === true}
                                title="Include in export"
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => onToggleChecked(node.group.endpointKey, event.target.checked)}
                              />
                              <Badge variant={methodBadgeVariantByClass[methodClass]}>{method}</Badge>
                              <span className="mapping-node-label" title={label}>
                                {label}
                              </span>
                              {node.hasAuth ? (
                                <span className="mapping-node-auth" aria-label="Authentication headers observed">
                                  🔑
                                </span>
                              ) : null}
                              <Badge variant="counter" uppercase={false}>
                                {node.group.entries.length}
                              </Badge>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })
            )}
          </div>
        </article>
      </div>

      <aside className="mapping-drawer" aria-label="Selected endpoint details">
        <EndpointDetailsModules
          displayEntries={displayEntries}
          selectedGroup={selectedGroup}
          selectedMergedSchema={selectedMergedSchema}
          selectedGraphQLOperation={selectedGraphQLOperation}
          title="Endpoint Details"
        />
      </aside>
    </section>
  );
}

export function SequenceFlowTab({ groups, displayEntries, onSelectEndpoint }: SequenceFlowTabProps) {
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<SequenceDetailTab>('headers');
  const [sequenceVisibleCount, setSequenceVisibleCount] = useState<number>(SEQUENCE_OVERVIEW_PAGE_SIZE);
  const [isSequenceLoadingMore, setIsSequenceLoadingMore] = useState(false);
  const sequenceLoadTimerRef = useRef<number | null>(null);

  const orderedEntries = useMemo(
    () => displayEntries.slice().sort((left, right) => getSequenceStartMs(left) - getSequenceStartMs(right)),
    [displayEntries],
  );

  const endpointKeyByEntryId = useMemo(() => {
    const map = new Map<number, string>();
    for (const group of groups) {
      for (const entry of group.entries) {
        map.set(entry.id, group.endpointKey);
      }
    }
    return map;
  }, [groups]);

  useEffect(() => {
    if (!orderedEntries.length) {
      if (selectedEntryId !== null) {
        setSelectedEntryId(null);
      }
      return;
    }

    if (selectedEntryId == null || !orderedEntries.some((entry) => entry.id === selectedEntryId)) {
      setSelectedEntryId(orderedEntries[0].id);
      setDetailTab('headers');
    }
  }, [orderedEntries, selectedEntryId]);

  useEffect(() => {
    if (orderedEntries.length <= sequenceVisibleCount && sequenceLoadTimerRef.current !== null) {
      window.clearTimeout(sequenceLoadTimerRef.current);
      sequenceLoadTimerRef.current = null;
      setIsSequenceLoadingMore(false);
    }

    setSequenceVisibleCount((previous) => {
      if (orderedEntries.length === 0) {
        return SEQUENCE_OVERVIEW_PAGE_SIZE;
      }

      const baseline = Math.min(SEQUENCE_OVERVIEW_PAGE_SIZE, orderedEntries.length);
      if (previous < baseline) {
        return baseline;
      }

      if (orderedEntries.length < previous) {
        return orderedEntries.length;
      }

      return previous;
    });
  }, [orderedEntries.length, sequenceVisibleCount]);

  useEffect(() => {
    return () => {
      if (sequenceLoadTimerRef.current !== null) {
        window.clearTimeout(sequenceLoadTimerRef.current);
        sequenceLoadTimerRef.current = null;
      }
    };
  }, []);

  const queueSequenceLoadMore = useCallback(() => {
    if (sequenceLoadTimerRef.current !== null || isSequenceLoadingMore) {
      return;
    }
    if (sequenceVisibleCount >= orderedEntries.length) {
      return;
    }

    setIsSequenceLoadingMore(true);

    sequenceLoadTimerRef.current = window.setTimeout(() => {
      setSequenceVisibleCount((previous) => Math.min(previous + SEQUENCE_OVERVIEW_PAGE_SIZE, orderedEntries.length));
      setIsSequenceLoadingMore(false);
      sequenceLoadTimerRef.current = null;
    }, 140);
  }, [isSequenceLoadingMore, orderedEntries.length, sequenceVisibleCount]);

  const selectedEntry = useMemo(
    () => orderedEntries.find((entry) => entry.id === selectedEntryId) ?? null,
    [orderedEntries, selectedEntryId],
  );

  const timelineStartMs = orderedEntries.length > 0 ? getSequenceStartMs(orderedEntries[0]) : 0;

  const sequenceSummary = useMemo(
    () =>
      orderedEntries.slice(0, sequenceVisibleCount).map((entry, index) => {
        const kind = getSequenceEntryKind(entry);
        const relativeStart = getSequenceStartMs(entry) - timelineStartMs;
        const graphQLOperation = parseGraphQLOperation(entry.request);

        return {
          id: entry.id,
          kind,
          rank: index + 1,
          relativeStart,
          label: graphQLOperation?.operationName ?? getCompactPath(entry.request.url),
          duration: formatDuration(entry.timing.durationMs),
        };
      }),
    [orderedEntries, sequenceVisibleCount, timelineStartMs],
  );

  const selectedGraphQLOperation = selectedEntry ? parseGraphQLOperation(selectedEntry.request) : null;
  const selectedVariablesPayload = selectedEntry ? extractGraphQLVariablesPayload(selectedEntry) : null;
  const selectedRequestHeaders = selectedEntry ? toHeaderPreviewRowsFromRaw(selectedEntry.request.headers) : [];
  const selectedResponseHeaders = selectedEntry ? toHeaderPreviewRowsFromRaw(selectedEntry.response.headers) : [];
  const selectedAuthHeaders = selectedRequestHeaders.filter((row) => row.isAuth);
  const selectedSentCookies = selectedEntry
    ? mergeCookieSignals(
        extractCookieSignalsFromRecordedCookies(selectedEntry.request.cookies),
        extractSentCookieSignalsFromHeaders(selectedEntry.request.headers),
      )
    : [];
  const selectedCapturedCookies = selectedEntry
    ? mergeCookieSignals(
        extractCookieSignalsFromRecordedCookies(selectedEntry.response.cookies),
        extractCapturedCookieSignalsFromHeaders(selectedEntry.response.headers),
      )
    : [];
  const requestBodyDisplay = useMemo(() => getRequestBodyDisplay(selectedEntry), [selectedEntry]);
  const incomingBodyDisplay = useMemo(() => getIncomingBodyDisplay(selectedEntry), [selectedEntry]);

  return (
    <section className="sequence-view" aria-label="Sequence flow view">
      <article className="pane sequence-timeline-pane" aria-label="Request timeline">
        <header className="pane-header">
          <h2>Timeline</h2>
          <Badge variant="count" uppercase={false}>
            {orderedEntries.length}
          </Badge>
        </header>

        <div className="sequence-timeline-content">
          {!orderedEntries.length ? (
            <div className="empty-state">No requests recorded yet. Trigger network activity to populate the timeline.</div>
          ) : (
            <>
              <div className="sequence-marker-row" role="listbox" aria-label="Timeline markers">
                {orderedEntries.map((entry, index) => {
                  const kind = getSequenceEntryKind(entry);
                  const isActive = selectedEntry?.id === entry.id;
                  const relativeStart = getSequenceStartMs(entry) - timelineStartMs;
                  const graphQLOperation = parseGraphQLOperation(entry.request);
                  const label = graphQLOperation?.operationName ?? getCompactPath(entry.request.url);

                  return (
                    <button
                      key={entry.id}
                      className={`sequence-marker ${kind}${isActive ? ' active' : ''}`}
                      type="button"
                      title={`#${index + 1} ${label} (${formatDuration(entry.timing.durationMs)})`}
                      onClick={() => {
                        setSelectedEntryId(entry.id);
                        const endpointKey = endpointKeyByEntryId.get(entry.id);
                        if (endpointKey) {
                          onSelectEndpoint(endpointKey);
                        }
                      }}
                    >
                      <span className="sequence-marker-dot" aria-hidden="true"></span>
                      <span className="sequence-marker-index">{index + 1}</span>
                      <span className="sequence-marker-time">{relativeStart}ms</span>
                    </button>
                  );
                })}
              </div>

              <div className="sequence-marker-legend">
                <span>
                  <i className="legend-dot graphql"></i> GraphQL
                </span>
                <span>
                  <i className="legend-dot rest"></i> REST
                </span>
                <span>
                  <i className="legend-dot auth"></i> Auth
                </span>
              </div>
            </>
          )}
        </div>
      </article>

      <div className="sequence-bottom-grid">
        <article className="pane sequence-overview-pane" aria-label="Sequence overview">
          <header className="pane-header">
            <h2>Sequence Overview</h2>
          </header>
          <div
            className="sequence-overview-list"
            onScroll={(event) => {
              const target = event.currentTarget;
              const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 64;
              if (!nearBottom) {
                return;
              }
              queueSequenceLoadMore();
            }}
          >
            {!sequenceSummary.length ? (
              <div className="empty-state module-empty-state">No sequence events available.</div>
            ) : (
              <>
                {sequenceSummary.map((item) => (
                  <button
                    key={item.id}
                    className={`sequence-overview-item${selectedEntry?.id === item.id ? ' active' : ''}`}
                    type="button"
                    onClick={() => setSelectedEntryId(item.id)}
                  >
                    <span className={`sequence-kind-chip ${item.kind}`}></span>
                    <span className="sequence-overview-rank">{item.rank}.</span>
                    <span className="sequence-overview-label" title={item.label}>
                      {item.label}
                    </span>
                    <span className="sequence-overview-time">{item.relativeStart}ms</span>
                  </button>
                ))}
                {isSequenceLoadingMore && sequenceVisibleCount < orderedEntries.length ? (
                  <div className="sequence-overview-loading" role="status" aria-label="Loading more sequence events">
                    <span className="sequence-overview-spinner" aria-hidden="true"></span>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </article>

        <article className="pane sequence-detail-pane" aria-label="Request deep inspection">
          <header className="pane-header">
            <h2>Deep Inspection</h2>
            {selectedEntry ? (
              <Badge variant="count" uppercase={false}>
                {formatDuration(selectedEntry.timing.durationMs)}
              </Badge>
            ) : null}
          </header>

          {!selectedEntry ? (
            <div className="sequence-detail-content">
              <div className="empty-state">Select a timeline marker to inspect request and response details.</div>
            </div>
          ) : (
            <>
              <div className="sequence-detail-tabs" role="tablist" aria-label="Sequence detail tabs">
                {[
                  { id: 'headers', label: 'Headers' },
                  { id: 'auth', label: 'Auth' },
                  { id: 'cookies', label: 'Cookies' },
                  { id: 'graphql', label: 'GraphQL' },
                  { id: 'variables', label: 'Variables' },
                  { id: 'request-body', label: 'Request Body' },
                  { id: 'incoming', label: 'Incoming' },
                  { id: 'response-headers', label: 'Headers+' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    className={`sequence-tab${detailTab === tab.id ? ' active' : ''}`}
                    role="tab"
                    type="button"
                    aria-selected={detailTab === tab.id ? 'true' : 'false'}
                    onClick={() => setDetailTab(tab.id as SequenceDetailTab)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="sequence-detail-content">
                <section className="sequence-request-summary">
                  <div className="sequence-request-row">
                    <span className="sequence-label">Method</span>
                    <Badge variant={methodBadgeVariantByClass[getMethodClass(getDisplayMethod(selectedEntry.request.method)) as MethodClass]}>
                      {getDisplayMethod(selectedEntry.request.method)}
                    </Badge>
                  </div>
                  <div className="sequence-request-row">
                    <span className="sequence-label">Endpoint</span>
                    <code className="sequence-value">{getCompactPath(selectedEntry.request.url)}</code>
                  </div>
                  <div className="sequence-request-row">
                    <span className="sequence-label">Status</span>
                    <span className="sequence-value">
                      {typeof selectedEntry.response.status === 'number' ? selectedEntry.response.status : 'unknown'}
                    </span>
                  </div>
                </section>

                {detailTab === 'headers' ? (
                  <HeaderPreviewTable
                    rows={selectedRequestHeaders}
                    emptyMessage="No request headers observed."
                    showAuthBadge={true}
                  />
                ) : null}

                {detailTab === 'auth' ? (
                  <HeaderPreviewTable
                    rows={selectedAuthHeaders}
                    emptyMessage="No auth headers observed for this request."
                    showAuthBadge={true}
                  />
                ) : null}

                {detailTab === 'cookies' ? (
                  <div className="cookie-signal-stack">
                    <CookiesSignalList
                      title="Sent Cookies"
                      rows={selectedSentCookies}
                      emptyMessage="No request Cookie headers on this request."
                    />
                    <CookiesSignalList
                      title="Captured Cookies"
                      rows={selectedCapturedCookies}
                      emptyMessage="No Set-Cookie headers on this request."
                    />
                  </div>
                ) : null}

                {detailTab === 'graphql' ? (
                  selectedGraphQLOperation ? (
                    <div className="graphql-schema-stack">
                      <div className="graphql-operation-head">
                        <Badge variant="apiGraphql" uppercase={false}>
                          {selectedGraphQLOperation.operationType}
                        </Badge>
                        <span className="graphql-operation-name">
                          {selectedGraphQLOperation.operationName ?? selectedGraphQLOperation.operationKey}
                        </span>
                      </div>
                      {selectedGraphQLOperation.rawQuery ? (
                        <pre className="graphql-raw-query">{selectedGraphQLOperation.rawQuery}</pre>
                      ) : (
                        <div className="schema-note">Raw GraphQL query text unavailable for this entry.</div>
                      )}
                    </div>
                  ) : (
                    <div className="empty-state module-empty-state">This request is not classified as GraphQL.</div>
                  )
                ) : null}

                {detailTab === 'variables' ? (
                  selectedGraphQLOperation ? (
                    <div className="graphql-schema-stack">
                      <div className="module-subsection">
                        <p className="module-subsection-title">Variables Schema</p>
                        {selectedGraphQLOperation.variablesSchema ? (
                          <JsonSchemaTree schema={selectedGraphQLOperation.variablesSchema} />
                        ) : (
                          <div className="schema-note">No GraphQL variables detected.</div>
                        )}
                      </div>
                      <div className="module-subsection">
                        <p className="module-subsection-title">Observed Payload</p>
                        <pre className="graphql-raw-query">{stringifyJson(selectedVariablesPayload)}</pre>
                      </div>
                    </div>
                  ) : (
                    <div className="empty-state module-empty-state">Variables are available only for GraphQL requests.</div>
                  )
                ) : null}

                {detailTab === 'request-body' ? (
                  <div className="sequence-incoming-stack">
                    <div className="sequence-incoming-meta">
                      <span>Method: {getDisplayMethod(selectedEntry.request.method)}</span>
                      <span>Type: {requestBodyDisplay.contentType ?? 'unknown'}</span>
                      <span>
                        Size:{' '}
                        {typeof selectedEntry.request.body === 'string' ? `${selectedEntry.request.body.length} chars` : '0 chars'}
                      </span>
                    </div>
                    <pre className={`incoming-body-preview${requestBodyDisplay.kind === 'json' ? ' json' : ''}`}>
                      {requestBodyDisplay.kind === 'json'
                        ? tokenizeJson(requestBodyDisplay.body).map((token, index) => (
                            <span
                              key={`request-token-${index}`}
                              className={token.kind === 'plain' ? undefined : `incoming-token ${token.kind}`}
                            >
                              {token.value}
                            </span>
                          ))
                        : requestBodyDisplay.body}
                    </pre>
                  </div>
                ) : null}

                {detailTab === 'incoming' ? (
                  <div className="sequence-incoming-stack">
                    <div className="sequence-incoming-meta">
                      <span>Status: {typeof selectedEntry.response.status === 'number' ? selectedEntry.response.status : 'unknown'}</span>
                      <span>Duration: {formatDuration(selectedEntry.timing.durationMs)}</span>
                      <span>Type: {incomingBodyDisplay.contentType ?? 'unknown'}</span>
                    </div>
                    <pre className={`incoming-body-preview${incomingBodyDisplay.kind === 'json' ? ' json' : ''}`}>
                      {incomingBodyDisplay.kind === 'json'
                        ? tokenizeJson(incomingBodyDisplay.body).map((token, index) => (
                            <span
                              key={`incoming-token-${index}`}
                              className={token.kind === 'plain' ? undefined : `incoming-token ${token.kind}`}
                            >
                              {token.value}
                            </span>
                          ))
                        : incomingBodyDisplay.body}
                    </pre>
                  </div>
                ) : null}

                {detailTab === 'response-headers' ? (
                  <HeaderPreviewTable
                    rows={selectedResponseHeaders}
                    emptyMessage="No response headers observed."
                    showAuthBadge={false}
                  />
                ) : null}
              </div>
            </>
          )}
        </article>
      </div>
    </section>
  );
}
