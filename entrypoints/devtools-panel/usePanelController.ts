import {
  createRequestRecorder,
  deduplicateEntries,
  endpointKey,
  inferSchema,
  mergeEndpointGroup,
  mergeGraphQLOperationsFromEntries,
  mergeRestEndpointGroup,
  shouldRecord,
  type BodySchema,
  type GraphQLSelectionField,
  type HeaderField,
  type JsonSchema,
  type MergedGraphQLOperation,
  type MergedRestEndpoint,
  type NoiseFilterSettings,
  type RecordedNetworkEntry,
  type RequestRecorder,
  type RestPathParameter,
  type RestQueryParameter,
  type SchemaObservation,
} from '@/core';
import {
  buildBundleFilename,
  buildSnapshotFilename,
  classifyGroups,
  getDomainFromEntries,
  getHostnameFromUrl,
  getHttpUrl,
  getScore,
  getSnapshotTimestamp,
  getUrlFromEntries,
  normalizeHeaders,
  serializeScore,
  sortByScore,
  sortCookies,
  sortGroups,
  type PanelEndpointGroup,
} from './panel-utils';
import JSZip from 'jszip';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_AI_ENRICHMENT_SETTINGS,
  getAPIKeyForProvider,
  getProviderLabel,
  loadAIEnrichmentSettings,
  saveAIEnrichmentSettings,
  type AIEnrichmentSettings,
  type AIProvider,
} from './ai-settings';
import type { AIEnrichmentBatchResult, EndpointForAIEnrichment } from './ai-enrichment';
import {
  loadNoiseFilterSettings,
  normalizeNoiseFilterSettings,
  saveNoiseFilterSettings,
} from './noise-filter-settings';

const POLL_INTERVAL_MS = 400;

interface ActiveTabCookieScope {
  domain: string | null;
  url: string | null;
}

interface CookieQueryResult {
  cookies: Browser.cookies.Cookie[];
  error: string | null;
}

interface SnapshotSummary {
  capturedAt: string | null;
  requestCount: number;
  endpointCount: number;
  cookieCount: number;
  cookieDomain: string | null;
  cookieCaptureError: string | null;
}

interface EndpointSummary {
  endpointKey: string;
  normalizedUrl: string | null;
  method: string;
  apiType: 'graphql' | 'rest';
  observationCount: number;
  maxScore: number;
  mergedSchema: SchemaObservation | null;
  graphql: MergedGraphQLOperation | null;
  rest: MergedRestEndpoint | null;
  requestIds: Array<number | null>;
}

interface SnapshotExportPayload {
  format: 'prism-snapshot-v1';
  exportedAt: string;
  snapshot: SnapshotSummary;
  endpoints: EndpointSummary[];
  requests: ReturnType<typeof serializeRequestForExport>[];
  cookies: ReturnType<typeof serializeCookieForExport>[];
}

interface BundleHeader {
  name: string;
  type: string;
  optional?: boolean;
  authentication?: boolean;
}

interface BundleSchemaNode {
  type: string;
  variants?: string[];
  optional?: boolean;
  items?: BundleSchemaNode | null;
  fields?: Record<string, BundleSchemaNode>;
}

interface BundlePayloadSchema {
  contentType: string;
  schema: BundleSchemaNode | null;
}

interface BundleAuthHeader {
  name: string;
  type: string;
}

interface BundleResponseFieldAnnotation {
  fieldPath: string;
  meaning: string;
}

interface BundleEndpointAIContext {
  description: string;
  authExplanation: string;
  semanticGroup: string;
  responseFieldAnnotations: BundleResponseFieldAnnotation[];
}

interface BundleGraphQLOperationType {
  operationType: string;
  operationName: string | null;
  variables: BundleSchemaNode | null;
  selectionSet: BundleGraphQLSelectionField[] | null;
  rawQueries: string[];
}

interface BundleGraphQLSelectionField {
  name: string;
  optional?: boolean;
  seenCount?: number;
  fields?: BundleGraphQLSelectionField[];
}

interface BundleRestPathParameter {
  name: string;
  placeholder: string;
  type: string;
  role: string;
  optional?: boolean;
  seenCount?: number;
}

interface BundleRestQueryParameter {
  name: string;
  type: string;
  optional?: boolean;
  seenCount?: number;
}

interface BundleRestResponseStatusRef {
  statusCode: string;
  responseRef: string;
  observations: number;
}

interface BundleRestOperationType {
  pathTemplate: string | null;
  pathParameters: BundleRestPathParameter[] | null;
  queryParameters: BundleRestQueryParameter[] | null;
  requestHeaders: {
    custom: BundleHeader[] | null;
    standard: BundleHeader[] | null;
  };
  requestBody: BundlePayloadSchema | null;
  statusCodes: string[];
  responsesByStatus: BundleRestResponseStatusRef[];
}

interface BundleEndpoint {
  endpointKey: string;
  method: string;
  url: string;
  apiType: 'graphql' | 'rest';
  observations: number;
  authHeaders: BundleAuthHeader[];
  requestSchema: {
    headers: BundleHeader[] | null;
    payload: BundlePayloadSchema | null;
  };
  responseRef: string;
  graphql?: BundleGraphQLOperationType;
  rest?: BundleRestOperationType;
  ai?: BundleEndpointAIContext;
}

interface EndpointsFilePayload {
  format: 'prism-endpoints-v1';
  exportedAt: string;
  endpointCount: number;
  endpoints: BundleEndpoint[];
}

interface ResponseSchemaEntry {
  headers: BundleHeader[] | null;
  payload: BundlePayloadSchema | null;
}

interface ResponsesFilePayload {
  format: 'prism-responses-v1';
  exportedAt: string;
  responseCount: number;
  responses: Record<string, ResponseSchemaEntry>;
}

interface StructuredBundlePayload {
  endpointsFile: EndpointsFilePayload;
  responsesFile: ResponsesFilePayload;
  prismMapMarkdown: string;
}

interface AIEnrichmentProgress {
  completed: number;
  total: number;
  message: string;
}

function downloadBlobFile(fileName: string, blob: Blob): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = objectUrl;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();

  globalThis.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 0);
}

function downloadTextFile(
  fileName: string,
  content: string,
  mimeType = 'application/json;charset=utf-8',
): void {
  downloadBlobFile(fileName, new Blob([content], { type: mimeType }));
}

function getEvaluationError(exceptionInfo: Browser.devtools.inspectedWindow.EvaluationExceptionInfo): string {
  if (exceptionInfo.value) {
    return exceptionInfo.value;
  }
  if (exceptionInfo.description) {
    return exceptionInfo.description;
  }
  if (exceptionInfo.code) {
    return exceptionInfo.code;
  }
  return 'inspectedWindow eval failed';
}

async function evaluateInInspectedWindow(
  expression: string,
): Promise<{ value: unknown; error: string | null }> {
  if (
    !browser.devtools ||
    !browser.devtools.inspectedWindow ||
    typeof browser.devtools.inspectedWindow.eval !== 'function'
  ) {
    return { value: null, error: 'inspectedWindow API unavailable' };
  }

  return new Promise((resolve) => {
    try {
      browser.devtools.inspectedWindow.eval<unknown>(expression, (value, exceptionInfo) => {
        if (exceptionInfo && (exceptionInfo.isException || exceptionInfo.isError)) {
          resolve({ value: null, error: getEvaluationError(exceptionInfo) });
          return;
        }
        resolve({ value, error: null });
      });
    } catch (error) {
      resolve({
        value: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

async function getActiveTabCookieScope(
  liveEntries: readonly RecordedNetworkEntry[],
): Promise<ActiveTabCookieScope> {
  const evalResult = await evaluateInInspectedWindow('window.location.href');
  const inspectedUrl = typeof evalResult.value === 'string' ? getHttpUrl(evalResult.value) : null;

  if (inspectedUrl) {
    return {
      domain: getHostnameFromUrl(inspectedUrl),
      url: inspectedUrl,
    };
  }

  const fallbackUrl = getUrlFromEntries(liveEntries);
  return {
    domain: fallbackUrl ? getHostnameFromUrl(fallbackUrl) : getDomainFromEntries(liveEntries),
    url: fallbackUrl,
  };
}

async function getCookiesByFilter(filter: Browser.cookies.GetAllDetails): Promise<CookieQueryResult> {
  if (!browser.cookies || typeof browser.cookies.getAll !== 'function') {
    return { cookies: [], error: 'cookies API unavailable' };
  }

  try {
    const cookies = await browser.cookies.getAll(filter);
    return {
      cookies: Array.isArray(cookies) ? cookies : [],
      error: null,
    };
  } catch (error) {
    return {
      cookies: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function getCookiesForScope(scope: ActiveTabCookieScope): Promise<CookieQueryResult> {
  const filters: Browser.cookies.GetAllDetails[] = [];
  if (scope.domain) {
    filters.push({ domain: scope.domain });
  }
  if (scope.url) {
    filters.push({ url: scope.url });
  }

  if (!filters.length) {
    return { cookies: [], error: 'active tab domain unavailable' };
  }

  const seen = new Set<string>();
  const mergedCookies: Browser.cookies.Cookie[] = [];
  let firstError: string | null = null;
  let hasSuccessfulQuery = false;

  for (const filter of filters) {
    const result = await getCookiesByFilter(filter);
    if (result.error) {
      if (!firstError) {
        firstError = result.error;
      }
      continue;
    }

    hasSuccessfulQuery = true;
    for (const cookie of result.cookies) {
      const partitionKey = cookie.partitionKey ? JSON.stringify(cookie.partitionKey) : '';
      const key = [cookie.name ?? '', cookie.domain ?? '', cookie.path ?? '', cookie.storeId ?? '', partitionKey].join(
        '|',
      );
      if (!seen.has(key)) {
        seen.add(key);
        mergedCookies.push(cookie);
      }
    }
  }

  return {
    cookies: mergedCookies,
    error: hasSuccessfulQuery ? null : firstError,
  };
}

function serializeCookieForExport(cookie: Browser.cookies.Cookie) {
  const expirationDate = typeof cookie.expirationDate === 'number' ? cookie.expirationDate : null;

  return {
    name: cookie.name ?? '',
    value: cookie.value ?? '',
    domain: cookie.domain ?? '',
    path: cookie.path ?? '',
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: typeof cookie.sameSite === 'string' ? cookie.sameSite : 'unspecified',
    session: Boolean(cookie.session),
    hostOnly: Boolean(cookie.hostOnly),
    storeId: cookie.storeId ?? '',
    expirationDate,
    partitionKey: cookie.partitionKey ?? null,
    expiresAt: expirationDate != null ? new Date(expirationDate * 1000).toISOString() : null,
  };
}

function serializeRequestForExport(entry: RecordedNetworkEntry) {
  const request = entry.request ?? {};
  const response = entry.response ?? {};
  const timing = entry.timing ?? {};
  const requestCookies = Array.isArray(request.cookies) ? request.cookies : [];
  const responseCookies = Array.isArray(response.cookies) ? response.cookies : [];

  return {
    id: typeof entry.id === 'number' ? entry.id : null,
    capturedAt: typeof entry.capturedAt === 'string' ? entry.capturedAt : null,
    endpointKey: endpointKey(request.method, request.url),
    schema: inferSchema(entry),
    score: serializeScore(entry.score),
    request: {
      url: typeof request.url === 'string' ? request.url : null,
      method: typeof request.method === 'string' ? request.method.toUpperCase() : null,
      headers: normalizeHeaders(request.headers),
      cookies: requestCookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
      })),
      body: typeof request.body === 'string' ? request.body : null,
    },
    response: {
      status: typeof response.status === 'number' ? response.status : null,
      statusText: typeof response.statusText === 'string' ? response.statusText : null,
      headers: normalizeHeaders(response.headers),
      cookies: responseCookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
      })),
      body: typeof response.body === 'string' ? response.body : null,
      contentType: typeof response.contentType === 'string' ? response.contentType : null,
      encoding: typeof response.encoding === 'string' ? response.encoding : null,
      bodyCaptureError:
        typeof response.bodyCaptureError === 'string' ? response.bodyCaptureError : null,
    },
    timing: {
      startedDateTime: typeof timing.startedDateTime === 'string' ? timing.startedDateTime : null,
      durationMs: typeof timing.durationMs === 'number' ? timing.durationMs : null,
    },
  };
}

function serializeHeaderForBundle(field: HeaderField): BundleHeader {
  return {
    name: field.name,
    type: field.valueType || 'unknown',
    ...(field.optional ? { optional: true } : {}),
    ...(field.isAuth ? { authentication: true } : {}),
  };
}

function serializeSchemaForBundle(schema: JsonSchema | null): BundleSchemaNode | null {
  if (!schema) {
    return null;
  }

  if (schema.type === 'mixed' && Array.isArray(schema.variants)) {
    return { type: 'mixed', variants: schema.variants };
  }

  if (schema.type === 'array') {
    return {
      type: 'array',
      items: schema.items ? serializeSchemaForBundle(schema.items) : null,
    };
  }

  if (schema.type === 'object' && schema.fields) {
    const fields: Record<string, BundleSchemaNode> = {};
    for (const key of Object.keys(schema.fields)) {
      const child = schema.fields[key];
      const serialized = serializeSchemaForBundle(child);
      if (!serialized) {
        continue;
      }
      if (child.optional) {
        serialized.optional = true;
      }
      fields[key] = serialized;
    }
    return { type: 'object', fields };
  }

  return { type: schema.type || 'unknown' };
}

function serializePayloadForBundle(bodySchema: BodySchema | null): BundlePayloadSchema | null {
  if (!bodySchema) {
    return null;
  }

  return {
    contentType: bodySchema.contentType || 'unknown',
    schema: serializeSchemaForBundle(bodySchema.schema),
  };
}

function serializeGraphQLSelectionFieldForBundle(
  field: GraphQLSelectionField,
): BundleGraphQLSelectionField {
  const nestedFields =
    Array.isArray(field.fields) && field.fields.length > 0
      ? field.fields.map(serializeGraphQLSelectionFieldForBundle)
      : undefined;

  return {
    name: field.name,
    ...(field.optional ? { optional: true } : {}),
    ...(typeof field.seenCount === 'number' ? { seenCount: field.seenCount } : {}),
    ...(nestedFields ? { fields: nestedFields } : {}),
  };
}

function serializeGraphQLOperationForBundle(
  operation: MergedGraphQLOperation | null,
): BundleGraphQLOperationType | null {
  if (!operation) {
    return null;
  }

  return {
    operationType: operation.operationType,
    operationName: operation.operationName,
    variables: serializeSchemaForBundle(operation.variablesSchema),
    selectionSet:
      Array.isArray(operation.selectionSet) && operation.selectionSet.length > 0
        ? operation.selectionSet.map(serializeGraphQLSelectionFieldForBundle)
        : null,
    rawQueries: operation.rawQueries,
  };
}

function serializeRestPathParameterForBundle(
  parameter: RestPathParameter,
): BundleRestPathParameter {
  return {
    name: parameter.name,
    placeholder: parameter.placeholder,
    type: parameter.type,
    role: parameter.role,
    ...(parameter.optional ? { optional: true } : {}),
    ...(typeof parameter.seenCount === 'number' ? { seenCount: parameter.seenCount } : {}),
  };
}

function serializeRestQueryParameterForBundle(
  parameter: RestQueryParameter,
): BundleRestQueryParameter {
  return {
    name: parameter.name,
    type: parameter.type,
    ...(parameter.optional ? { optional: true } : {}),
    ...(typeof parameter.seenCount === 'number' ? { seenCount: parameter.seenCount } : {}),
  };
}

function serializeResponseSideForBundle(response: SchemaObservation['response']): ResponseSchemaEntry {
  const responseFields = response.headers.fields ?? [];
  return {
    headers: responseFields.length > 0 ? responseFields.map(serializeHeaderForBundle) : null,
    payload: serializePayloadForBundle(response.body ?? null),
  };
}

function getRestResponseRef(method: string, url: string, statusLabel: string): string {
  return `${method} ${url} -> ${statusLabel}`;
}

function getStatusPriority(statusCode: string): number {
  if (statusCode === '200') {
    return 0;
  }
  if (statusCode === '201') {
    return 1;
  }
  if (statusCode === '204') {
    return 2;
  }

  const numericStatus = Number(statusCode);
  if (Number.isFinite(numericStatus) && numericStatus >= 200 && numericStatus < 300) {
    return 3;
  }
  if (Number.isFinite(numericStatus) && numericStatus >= 300 && numericStatus < 400) {
    return 4;
  }
  if (Number.isFinite(numericStatus) && numericStatus >= 400 && numericStatus < 500) {
    return 5;
  }
  if (Number.isFinite(numericStatus) && numericStatus >= 500) {
    return 6;
  }
  return 7;
}

function normalizeForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForStableStringify(item));
  }

  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(objectValue).sort()) {
      normalized[key] = normalizeForStableStringify(objectValue[key]);
    }
    return normalized;
  }

  return value;
}

function getResponseSchemaSignature(entry: ResponseSchemaEntry): string {
  return JSON.stringify(normalizeForStableStringify(entry));
}

function buildResponseRef(index: number): string {
  return `response_${String(index).padStart(4, '0')}`;
}

function getSemanticGroupBreakdown(endpoints: readonly BundleEndpoint[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();

  for (const endpoint of endpoints) {
    const semanticGroup = endpoint.ai?.semanticGroup?.trim();
    if (!semanticGroup) {
      continue;
    }
    counts.set(semanticGroup, (counts.get(semanticGroup) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function buildPrismMapMarkdown(args: {
  endpointsFile: EndpointsFilePayload;
  responsesFile: ResponsesFilePayload;
  capabilitiesSummary?: string | null;
}): string {
  const sampleEndpoint = args.endpointsFile.endpoints[0] ?? null;
  const sampleGraphQLEndpoint = args.endpointsFile.endpoints.find((endpoint) => endpoint.apiType === 'graphql') ?? null;
  const sampleRestEndpoint = args.endpointsFile.endpoints.find((endpoint) => endpoint.apiType === 'rest') ?? null;
  const fallbackRef = Object.keys(args.responsesFile.responses)[0] ?? 'response_0001';
  const sampleResponseRef = sampleEndpoint?.responseRef ?? fallbackRef;
  const sampleMethod = sampleEndpoint?.method ?? 'GET';
  const sampleUrl = sampleEndpoint?.url ?? 'https://api.example.com/v1/resource/{id}';
  const sampleRestStatusRef = sampleRestEndpoint?.rest?.responsesByStatus[0] ?? null;
  const sampleRestStatusCode = sampleRestStatusRef?.statusCode ?? '200';
  const sampleRestResponseRef = sampleRestStatusRef?.responseRef ?? sampleResponseRef;
  const sampleGraphQLOperationName =
    sampleGraphQLEndpoint?.graphql?.operationName ?? sampleGraphQLEndpoint?.endpointKey ?? 'GetExampleQuery';
  const sampleGraphQLOperationType = sampleGraphQLEndpoint?.graphql?.operationType ?? 'query';
  const semanticGroups = getSemanticGroupBreakdown(args.endpointsFile.endpoints);
  const capabilitiesSummary = typeof args.capabilitiesSummary === 'string' ? args.capabilitiesSummary.trim() : '';

  const markdownSections = [
    '# PRISM_MAP',
    '',
    ...(capabilitiesSummary
      ? ['## What Can I Build With This API?', capabilitiesSummary, '']
      : []),
    'This bundle is designed for LLMs and coding agents. It separates endpoint indexing from response schemas so tools only load the minimum required context.',
    '',
    '## File Roles',
    '- `endpoints.json`: Lightweight endpoint index. REST entries include `rest.pathTemplate`, path/query parameter schemas, request decomposition, and `rest.responsesByStatus` refs. GraphQL entries are keyed by operation name and include a `graphql` section (operation type, variables schema, selection set, raw queries).',
    '- If AI enrichment is enabled, each endpoint includes an `ai` section with plain-language description, auth explanation, semantic group, and response field annotations.',
    '- `responses.json`: Response schema library keyed by `responseRef`. REST refs are endpoint + status (`METHOD URL -> STATUS`); GraphQL refs may use shared synthetic keys.',
    '- `PRISM_MAP.md`: Instructions for navigating and using this bundle.',
    '',
    ...(semanticGroups.length
      ? [
          '## Semantic Groups',
          ...semanticGroups.map((group) => `- ${group.name}: ${group.count} endpoint${group.count === 1 ? '' : 's'}`),
          '',
        ]
      : []),
    '## Cross-Reference Workflow',
    '1. Open `endpoints.json` and choose an endpoint by key. REST keys are method + URL; GraphQL keys are operation names.',
    `2. For REST, read \`rest.responsesByStatus\` and pick a status ref (example: status \`${sampleRestStatusCode}\` uses \`${sampleRestResponseRef}\`).`,
    `3. For GraphQL (or fallback), use \`responseRef\` (example: \`${sampleResponseRef}\`).`,
    `4. Open \`responses.json\` and load only the referenced schema key(s).`,
    '5. Combine endpoint request schema + referenced response schema(s) to generate a scraper or integration.',
    '',
    '## Schema Reading Rules',
    '- Header schemas use `{ "name", "type" }`; `optional: true` means the field did not appear in every observation.',
    '- Payload schemas are recursive and type-based: `object` uses `fields`, `array` uses `items`.',
    '- Union types are represented as `{ "type": "mixed", "variants": ["string", "number"] }`.',
    '- Optional payload fields are marked with `optional: true` on that field node.',
    '- REST path/query parameters include `optional` + `seenCount` across observations.',
    '- REST response schemas are segmented by observed status code.',
    '- No raw request/response values are exported in these files.',
    '- GraphQL entries include a structured `graphql.selectionSet` tree with per-field optionality/observation counts.',
    '',
    '## GraphQL Notes',
    `- Example GraphQL key: \`${sampleGraphQLOperationName}\` (${sampleGraphQLOperationType}).`,
    '- Use `graphql.variables` for request variable shapes and types.',
    '- Use `graphql.selectionSet` as the requested response field tree instead of parsing `graphql.rawQueries` by default.',
    '- `graphql.rawQueries` is provided for advanced debugging when you need original query text.',
    '',
    '## Example Usage',
    `To build a scraper for \`${sampleMethod} ${sampleUrl}\`:`,
    `1. In \`endpoints.json\`, locate that endpoint and copy request schema details plus status refs (for REST) or \`responseRef: ${sampleResponseRef}\` (for GraphQL).`,
    `2. In \`responses.json\`, resolve the relevant ref(s) such as \`${sampleRestResponseRef}\`.`,
    '3. Generate request code using endpoint auth headers and request payload fields; generate parsing code from the response schema.',
  ];

  return markdownSections.join('\n');
}

async function downloadStructuredBundleZip(bundle: StructuredBundlePayload): Promise<void> {
  const zip = new JSZip();
  zip.file('endpoints.json', JSON.stringify(bundle.endpointsFile, null, 2));
  zip.file('responses.json', JSON.stringify(bundle.responsesFile, null, 2));
  zip.file('PRISM_MAP.md', bundle.prismMapMarkdown);

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  downloadBlobFile(buildBundleFilename(), blob);
}

function buildGraphQLOperationSummaryByKey(
  groups: readonly PanelEndpointGroup[],
): Record<string, MergedGraphQLOperation | null> {
  const result: Record<string, MergedGraphQLOperation | null> = {};
  for (const group of groups) {
    result[group.endpointKey] = mergeGraphQLOperationsFromEntries(group.entries);
  }
  return result;
}

function buildRestEndpointSummaryByKey(
  groups: readonly PanelEndpointGroup[],
  graphQLOperationByKey: Record<string, MergedGraphQLOperation | null>,
): Record<string, MergedRestEndpoint | null> {
  const result: Record<string, MergedRestEndpoint | null> = {};
  for (const group of groups) {
    if (graphQLOperationByKey[group.endpointKey]) {
      result[group.endpointKey] = null;
      continue;
    }
    result[group.endpointKey] = mergeRestEndpointGroup(group);
  }
  return result;
}

function buildEndpointsSummary(entries: readonly RecordedNetworkEntry[]): EndpointSummary[] {
  const groups = deduplicateEntries(entries);
  const graphQLOperationByKey = buildGraphQLOperationSummaryByKey(groups);
  const restEndpointByKey = buildRestEndpointSummaryByKey(groups, graphQLOperationByKey);

  return groups.map((group) => {
    const maxScore = group.entries.reduce((max, entry) => Math.max(max, getScore(entry)), 0);
    const mergedGraphQL = graphQLOperationByKey[group.endpointKey];
    const mergedRest = restEndpointByKey[group.endpointKey];

    return {
      endpointKey: group.endpointKey,
      normalizedUrl: group.normalizedUrl,
      method: group.method,
      apiType: mergedGraphQL ? 'graphql' : 'rest',
      observationCount: group.entries.length,
      maxScore,
      mergedSchema: mergeEndpointGroup(group)?.schema ?? null,
      graphql: mergedGraphQL,
      rest: mergedRest,
      requestIds: group.entries.map((entry) => (typeof entry.id === 'number' ? entry.id : null)),
    };
  });
}

function buildSnapshotExportPayload(args: {
  snapshotEntries: RecordedNetworkEntry[];
  snapshotCookies: Browser.cookies.Cookie[];
  snapshotTime: Date | null;
  snapshotCookieDomain: string | null;
  snapshotCookieError: string | null;
}): SnapshotExportPayload {
  const endpoints = buildEndpointsSummary(args.snapshotEntries);

  return {
    format: 'prism-snapshot-v1',
    exportedAt: new Date().toISOString(),
    snapshot: {
      capturedAt: getSnapshotTimestamp(args.snapshotTime),
      requestCount: args.snapshotEntries.length,
      endpointCount: endpoints.length,
      cookieCount: args.snapshotCookies.length,
      cookieDomain: args.snapshotCookieDomain,
      cookieCaptureError: args.snapshotCookieError,
    },
    endpoints,
    requests: args.snapshotEntries.map(serializeRequestForExport),
    cookies: args.snapshotCookies.map(serializeCookieForExport),
  };
}

function buildStructuredBundlePayload(args: {
  groups: PanelEndpointGroup[];
  checkedEndpointKeys: Record<string, boolean>;
  mergedSchemaByKey: Record<string, SchemaObservation | null>;
  graphQLOperationByKey: Record<string, MergedGraphQLOperation | null>;
  restEndpointByKey: Record<string, MergedRestEndpoint | null>;
}): StructuredBundlePayload {
  const exportedAt = new Date().toISOString();
  const endpoints: BundleEndpoint[] = [];
  const responses: Record<string, ResponseSchemaEntry> = {};
  const responseRefBySignature = new Map<string, string>();
  let responseCounter = 1;

  for (const group of args.groups) {
    if (!args.checkedEndpointKeys[group.endpointKey]) {
      continue;
    }

    const mergedSchema = args.mergedSchemaByKey[group.endpointKey];
    const graphQLOperation = args.graphQLOperationByKey[group.endpointKey];
    const restEndpoint = args.restEndpointByKey[group.endpointKey];
    const method = group.method || 'GET';
    const url = group.normalizedUrl || group.endpointKey;
    const requestFields = mergedSchema?.request.headers.fields ?? [];
    const authHeaders = requestFields
      .filter((field) => field.isAuth)
      .map((field) => ({ name: field.name, type: field.valueType || 'string' }));

    const responseSchemaEntry = serializeResponseSideForBundle(
      mergedSchema?.response ?? { headers: { fields: [] }, body: null },
    );
    const responseSignature = getResponseSchemaSignature(responseSchemaEntry);
    let responseRef = responseRefBySignature.get(responseSignature);
    if (!responseRef) {
      responseRef = buildResponseRef(responseCounter);
      responseCounter += 1;
      responseRefBySignature.set(responseSignature, responseRef);
      responses[responseRef] = responseSchemaEntry;
    }

    const serializedGraphQLOperation = graphQLOperation
      ? serializeGraphQLOperationForBundle(graphQLOperation)
      : null;
    let serializedRestOperation: BundleRestOperationType | null = null;

    if (restEndpoint && !graphQLOperation) {
      const statusRefs: BundleRestResponseStatusRef[] = [];

      for (const statusSchema of restEndpoint.statusSchemas) {
        const statusResponseRef = getRestResponseRef(method, url, statusSchema.statusLabel);
        responses[statusResponseRef] = serializeResponseSideForBundle(statusSchema.response);
        statusRefs.push({
          statusCode: statusSchema.statusLabel,
          responseRef: statusResponseRef,
          observations: statusSchema.observationCount,
        });
      }

      if (statusRefs.length > 0) {
        const bestStatusRef = statusRefs
          .slice()
          .sort(
            (left, right) =>
              getStatusPriority(left.statusCode) - getStatusPriority(right.statusCode) ||
              right.observations - left.observations,
          )[0];
        responseRef = bestStatusRef.responseRef;
      }

      serializedRestOperation = {
        pathTemplate: restEndpoint.pathTemplate,
        pathParameters: restEndpoint.pathParameters.length
          ? restEndpoint.pathParameters.map(serializeRestPathParameterForBundle)
          : null,
        queryParameters: restEndpoint.queryParameters.length
          ? restEndpoint.queryParameters.map(serializeRestQueryParameterForBundle)
          : null,
        requestHeaders: {
          custom: restEndpoint.requestHeaders.custom.length
            ? restEndpoint.requestHeaders.custom.map(serializeHeaderForBundle)
            : null,
          standard: restEndpoint.requestHeaders.standard.length
            ? restEndpoint.requestHeaders.standard.map(serializeHeaderForBundle)
            : null,
        },
        requestBody: serializePayloadForBundle(restEndpoint.requestBody),
        statusCodes: restEndpoint.statusCodes,
        responsesByStatus: statusRefs,
      };
    }

    endpoints.push({
      endpointKey: group.endpointKey,
      method,
      url,
      apiType: graphQLOperation ? 'graphql' : 'rest',
      observations: group.entries.length,
      authHeaders,
      requestSchema: {
        headers: requestFields.length > 0 ? requestFields.map(serializeHeaderForBundle) : null,
        payload: serializePayloadForBundle(mergedSchema?.request.body ?? null),
      },
      responseRef,
      ...(serializedGraphQLOperation ? { graphql: serializedGraphQLOperation } : {}),
      ...(serializedRestOperation ? { rest: serializedRestOperation } : {}),
    });
  }

  const endpointsFile: EndpointsFilePayload = {
    format: 'prism-endpoints-v1',
    exportedAt,
    endpointCount: endpoints.length,
    endpoints,
  };

  const responsesFile: ResponsesFilePayload = {
    format: 'prism-responses-v1',
    exportedAt,
    responseCount: Object.keys(responses).length,
    responses,
  };

  return {
    endpointsFile,
    responsesFile,
    prismMapMarkdown: buildPrismMapMarkdown({ endpointsFile, responsesFile }),
  };
}

function buildAIEnrichmentInput(bundle: StructuredBundlePayload): EndpointForAIEnrichment[] {
  return bundle.endpointsFile.endpoints.map((endpoint) => ({
    endpointKey: endpoint.endpointKey,
    method: endpoint.method,
    url: endpoint.url,
    apiType: endpoint.apiType,
    observations: endpoint.observations,
    authHeaders: endpoint.authHeaders,
    requestSchema: endpoint.requestSchema,
    responseSchema: bundle.responsesFile.responses[endpoint.responseRef] ?? null,
  }));
}

function applyAIEnrichmentToBundle(args: {
  bundle: StructuredBundlePayload;
  enrichment: AIEnrichmentBatchResult;
}): StructuredBundlePayload {
  const endpoints = args.bundle.endpointsFile.endpoints.map((endpoint) => {
    const enriched = args.enrichment.endpointEnrichmentByKey[endpoint.endpointKey];
    if (!enriched) {
      return endpoint;
    }

    return {
      ...endpoint,
      ai: {
        description: enriched.description,
        authExplanation: enriched.authExplanation,
        semanticGroup: enriched.semanticGroup,
        responseFieldAnnotations: enriched.responseFieldAnnotations.map((annotation) => ({
          fieldPath: annotation.fieldPath,
          meaning: annotation.meaning,
        })),
      },
    };
  });

  const endpointsFile: EndpointsFilePayload = {
    ...args.bundle.endpointsFile,
    endpoints,
  };

  return {
    endpointsFile,
    responsesFile: args.bundle.responsesFile,
    prismMapMarkdown: buildPrismMapMarkdown({
      endpointsFile,
      responsesFile: args.bundle.responsesFile,
      capabilitiesSummary: args.enrichment.capabilitiesSummary,
    }),
  };
}

export function usePanelController() {
  const [isSnapshot, setIsSnapshot] = useState(false);
  const [snapshotTime, setSnapshotTime] = useState<Date | null>(null);
  const [selectedEndpointKey, setSelectedEndpointKey] = useState<string | null>(null);
  const [checkedEndpointKeys, setCheckedEndpointKeys] = useState<Record<string, boolean>>({});
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [liveEntries, setLiveEntries] = useState<RecordedNetworkEntry[]>([]);
  const [snapshotEntries, setSnapshotEntries] = useState<RecordedNetworkEntry[]>([]);
  const [snapshotCookies, setSnapshotCookies] = useState<Browser.cookies.Cookie[]>([]);
  const [snapshotCookieDomain, setSnapshotCookieDomain] = useState<string | null>(null);
  const [snapshotCookieError, setSnapshotCookieError] = useState<string | null>(null);
  const [isCapturingCookies, setIsCapturingCookies] = useState(false);
  const [statusOverride, setStatusOverride] = useState<string | null>(null);
  const [aiSettings, setAISettings] = useState<AIEnrichmentSettings>(DEFAULT_AI_ENRICHMENT_SETTINGS);
  const [isAISettingsLoaded, setIsAISettingsLoaded] = useState(false);
  const [isExportingMap, setIsExportingMap] = useState(false);
  const [aiProgress, setAIProgress] = useState<AIEnrichmentProgress | null>(null);
  const [noiseFilterSettings, setNoiseFilterSettings] = useState<NoiseFilterSettings>(() => loadNoiseFilterSettings());

  const recorderRef = useRef<RequestRecorder | null>(null);
  const snapshotCaptureIdRef = useRef(0);
  const noiseFilterSettingsRef = useRef<NoiseFilterSettings>(noiseFilterSettings);

  useEffect(() => {
    noiseFilterSettingsRef.current = noiseFilterSettings;
    saveNoiseFilterSettings(noiseFilterSettings);
  }, [noiseFilterSettings]);

  useEffect(() => {
    const recorder = createRequestRecorder(browser, {
      shouldRecord: (entry) => shouldRecord(entry, noiseFilterSettingsRef.current),
    });
    recorder.start();
    recorderRef.current = recorder;

    if (!browser.devtools?.network?.onRequestFinished) {
      setStatusOverride('Recorder unavailable in this context.');
    }

    return () => {
      recorder.stop();
      recorderRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const loadedSettings = await loadAIEnrichmentSettings();
      if (cancelled) {
        return;
      }
      setAISettings(loadedSettings);
      setIsAISettingsLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const loadEntriesFromRecorder = () => {
      const recorder = recorderRef.current;
      if (!recorder) {
        return;
      }

      const entries = sortByScore(recorder.getEntries());
      setLiveEntries(entries);
    };

    loadEntriesFromRecorder();
    const intervalId = window.setInterval(loadEntriesFromRecorder, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const displayEntries = isSnapshot ? snapshotEntries : liveEntries;

  const groups = useMemo<PanelEndpointGroup[]>(() => {
    return sortGroups(deduplicateEntries(displayEntries));
  }, [displayEntries]);

  const mergedSchemaByKey = useMemo<Record<string, SchemaObservation | null>>(() => {
    const result: Record<string, SchemaObservation | null> = {};
    for (const group of groups) {
      result[group.endpointKey] = mergeEndpointGroup(group)?.schema ?? null;
    }
    return result;
  }, [groups]);

  const graphQLOperationByKey = useMemo<Record<string, MergedGraphQLOperation | null>>(() => {
    return buildGraphQLOperationSummaryByKey(groups);
  }, [groups]);

  const restEndpointByKey = useMemo<Record<string, MergedRestEndpoint | null>>(() => {
    return buildRestEndpointSummaryByKey(groups, graphQLOperationByKey);
  }, [groups, graphQLOperationByKey]);

  useEffect(() => {
    setCheckedEndpointKeys((previous) => {
      const validKeys = new Set(groups.map((group) => group.endpointKey));
      const next: Record<string, boolean> = {};
      let changed = false;

      for (const group of groups) {
        const oldValue = previous[group.endpointKey];
        next[group.endpointKey] = oldValue !== undefined ? oldValue : true;
        if (oldValue === undefined) {
          changed = true;
        }
      }

      for (const key of Object.keys(previous)) {
        if (!validKeys.has(key)) {
          changed = true;
        }
      }

      if (!changed) {
        return previous;
      }
      return next;
    });
  }, [groups]);

  useEffect(() => {
    setSelectedEndpointKey((previous) => {
      if (previous && groups.some((group) => group.endpointKey === previous)) {
        return previous;
      }
      return groups.length > 0 ? groups[0].endpointKey : null;
    });
  }, [groups]);

  const selectedGroup = useMemo<PanelEndpointGroup | null>(() => {
    if (!selectedEndpointKey) {
      return null;
    }
    return groups.find((group) => group.endpointKey === selectedEndpointKey) ?? null;
  }, [groups, selectedEndpointKey]);

  const selectedMergedSchema = selectedGroup ? mergedSchemaByKey[selectedGroup.endpointKey] : null;
  const selectedGraphQLOperation = selectedGroup
    ? graphQLOperationByKey[selectedGroup.endpointKey] ?? null
    : null;
  const selectedRestEndpoint = selectedGroup ? restEndpointByKey[selectedGroup.endpointKey] ?? null : null;

  const checkedCount = useMemo<number>(() => {
    return Object.values(checkedEndpointKeys).filter(Boolean).length;
  }, [checkedEndpointKeys]);

  const selectAll = useCallback(() => {
    setCheckedEndpointKeys((previous) => {
      const next: Record<string, boolean> = {};
      for (const key of Object.keys(previous)) {
        next[key] = true;
      }
      return next;
    });
  }, []);

  const selectNone = useCallback(() => {
    setCheckedEndpointKeys((previous) => {
      const next: Record<string, boolean> = {};
      for (const key of Object.keys(previous)) {
        next[key] = false;
      }
      return next;
    });
  }, []);

  const setNoiseFilterEnabled = useCallback((enabled: boolean) => {
    setNoiseFilterSettings((previous) => ({
      ...previous,
      enabled,
    }));
  }, []);

  const applyNoiseFilterSettings = useCallback((nextSettings: NoiseFilterSettings) => {
    setNoiseFilterSettings(normalizeNoiseFilterSettings(nextSettings));
  }, []);

  const persistAISettings = useCallback(async (nextSettings: AIEnrichmentSettings) => {
    try {
      await saveAIEnrichmentSettings(nextSettings);
    } catch {
      // Keep runtime behavior non-blocking; persistence failures should not block exports.
    }
  }, []);

  const updateAISettings = useCallback(
    (updater: (previous: AIEnrichmentSettings) => AIEnrichmentSettings) => {
      setAISettings((previous) => {
        const next = updater(previous);
        void persistAISettings(next);
        return next;
      });
    },
    [persistAISettings],
  );

  const setAIProvider = useCallback(
    (provider: AIProvider) => {
      updateAISettings((previous) => ({
        ...previous,
        provider,
      }));
    },
    [updateAISettings],
  );

  const setAIEnrichmentEnabled = useCallback(
    (enabled: boolean) => {
      updateAISettings((previous) => ({
        ...previous,
        enabled,
      }));
    },
    [updateAISettings],
  );

  const setAIApiKeyForProvider = useCallback(
    (provider: AIProvider, apiKey: string) => {
      updateAISettings((previous) => ({
        ...previous,
        apiKeys: {
          ...previous.apiKeys,
          [provider]: apiKey,
        },
      }));
    },
    [updateAISettings],
  );

  const toggleSnapshot = useCallback(() => {
    if (isSnapshot) {
      snapshotCaptureIdRef.current += 1;
      setIsSnapshot(false);
      setSnapshotTime(null);
      setSnapshotEntries([]);
      setSnapshotCookies([]);
      setSnapshotCookieDomain(null);
      setSnapshotCookieError(null);
      setIsCapturingCookies(false);
      setStatusOverride(null);
      return;
    }

    const captureId = snapshotCaptureIdRef.current + 1;
    snapshotCaptureIdRef.current = captureId;

    const currentLiveEntries = liveEntries.slice();
    setIsSnapshot(true);
    setSnapshotTime(new Date());
    setSnapshotEntries(currentLiveEntries);
    setSnapshotCookies([]);
    setSnapshotCookieDomain(null);
    setSnapshotCookieError(null);
    setIsCapturingCookies(true);
    setStatusOverride(null);

    (async () => {
      const scope = await getActiveTabCookieScope(currentLiveEntries);
      if (snapshotCaptureIdRef.current !== captureId) {
        return;
      }

      if (!scope.domain && !scope.url) {
        if (snapshotCaptureIdRef.current !== captureId) {
          return;
        }
        setSnapshotCookieDomain(null);
        setSnapshotCookieError('active tab domain unavailable');
        setSnapshotCookies([]);
        setIsCapturingCookies(false);
        return;
      }

      const cookieResult = await getCookiesForScope(scope);
      if (snapshotCaptureIdRef.current !== captureId) {
        return;
      }

      setSnapshotCookieDomain(scope.domain);
      setSnapshotCookies(sortCookies(cookieResult.cookies));
      setSnapshotCookieError(cookieResult.error);
      setIsCapturingCookies(false);
    })();
  }, [isSnapshot, liveEntries]);

  const exportSnapshot = useCallback(() => {
    if (!isSnapshot || isCapturingCookies) {
      return;
    }

    try {
      const payload = buildSnapshotExportPayload({
        snapshotEntries,
        snapshotCookies,
        snapshotTime,
        snapshotCookieDomain,
        snapshotCookieError,
      });
      downloadTextFile(buildSnapshotFilename(snapshotTime), JSON.stringify(payload, null, 2));
      setStatusOverride(null);
    } catch (error) {
      setStatusOverride(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [
    isSnapshot,
    isCapturingCookies,
    snapshotEntries,
    snapshotCookies,
    snapshotTime,
    snapshotCookieDomain,
    snapshotCookieError,
  ]);

  const exportMap = useCallback(async () => {
    if (!displayEntries.length || isExportingMap) {
      return;
    }

    setStatusOverride(null);
    setIsExportingMap(true);

    try {
      let payload = buildStructuredBundlePayload({
        groups,
        checkedEndpointKeys,
        mergedSchemaByKey,
        graphQLOperationByKey,
        restEndpointByKey,
      });
      if (!payload.endpointsFile.endpointCount) {
        return;
      }

      let exportMessage: string | null = null;
      const providerLabel = getProviderLabel(aiSettings.provider);
      const apiKey = getAPIKeyForProvider(aiSettings, aiSettings.provider);
      const shouldRunAI = aiSettings.enabled && apiKey.length > 0;

      if (aiSettings.enabled && !apiKey) {
        exportMessage = `AI enrichment is enabled, but no ${providerLabel} API key is set. Exported without enrichment.`;
      }

      if (shouldRunAI) {
        const aiInput = buildAIEnrichmentInput(payload);
        setAIProgress({
          completed: 0,
          total: aiInput.length,
          message: `Enriching 0/${aiInput.length} endpoints...`,
        });

        try {
          const { enrichEndpointsWithAI } = await import('./ai-enrichment');
          const enrichment = await enrichEndpointsWithAI({
            settings: aiSettings,
            endpoints: aiInput,
            onProgress: (progress) => {
              const completed = Math.min(progress.completed, progress.total);
              setAIProgress({
                completed,
                total: progress.total,
                message: `Enriching ${completed}/${progress.total} endpoints...`,
              });
            },
          });

          payload = applyAIEnrichmentToBundle({
            bundle: payload,
            enrichment,
          });
        } catch (error) {
          exportMessage = `AI enrichment failed (${providerLabel}): ${error instanceof Error ? error.message : String(error)}. Exported without enrichment.`;
        }
      }

      await downloadStructuredBundleZip(payload);
      setStatusOverride(exportMessage);
    } catch (error) {
      setStatusOverride(`Bundle export failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsExportingMap(false);
      setAIProgress(null);
    }
  }, [
    displayEntries.length,
    isExportingMap,
    groups,
    checkedEndpointKeys,
    mergedSchemaByKey,
    graphQLOperationByKey,
    restEndpointByKey,
    aiSettings,
  ]);

  return {
    isSnapshot,
    snapshotTime,
    selectedEndpointKey,
    checkedEndpointKeys,
    collapsedSections,
    displayEntries,
    groups,
    mergedSchemaByKey,
    graphQLOperationByKey,
    restEndpointByKey,
    selectedGroup,
    selectedMergedSchema,
    selectedGraphQLOperation,
    selectedRestEndpoint,
    snapshotCookies,
    snapshotCookieDomain,
    snapshotCookieError,
    isCapturingCookies,
    isExportingMap,
    statusOverride,
    aiSettings,
    isAISettingsLoaded,
    noiseFilterSettings,
    aiProgress,
    checkedCount,
    setSelectedEndpointKey,
    setCheckedEndpointKeys,
    setCollapsedSections,
    setAIProvider,
    setAIEnrichmentEnabled,
    setAIApiKeyForProvider,
    setNoiseFilterEnabled,
    applyNoiseFilterSettings,
    selectAll,
    selectNone,
    toggleSnapshot,
    exportSnapshot,
    exportMap,
  };
}
