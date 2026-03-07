import { isGraphQLRequest, type EndpointGroup, type HeaderLike, type RecordedNetworkEntry, type RequestScore } from '@/core';

export type PanelEndpointGroup = EndpointGroup<RecordedNetworkEntry>;

const AUTH_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
  'x-csrf-token',
  'x-xsrf-token',
  'x-session-token',
  'set-cookie',
]);

const GENERIC_PATH_SEGMENTS = new Set([
  'api',
  'rest',
  'graphql',
  'graph',
  'v1',
  'v2',
  'v3',
  'internal',
  'public',
  'svc',
  'service',
]);

const GENERIC_OPERATION_WORDS = new Set([
  'query',
  'mutation',
  'subscription',
  'get',
  'list',
  'fetch',
  'load',
  'create',
  'update',
  'delete',
  'set',
  'by',
  'for',
  'all',
  'use',
]);

function normalizeHeaderValue(rawValue: unknown): string {
  return rawValue == null ? '' : String(rawValue);
}

function toTitleCase(value: string): string {
  if (!value) {
    return value;
  }
  return value[0].toUpperCase() + value.slice(1).toLowerCase();
}

function splitOperationTokens(operationName: string): string[] {
  return operationName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function tokenizePath(pathname: string): string[] {
  return pathname
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.replace(/^\{(.+)\}$/, '$1'))
    .map((segment) => segment.replace(/^\:.+$/, ''))
    .filter((segment) => segment.length > 0);
}

function normalizeSemanticToken(token: string): string {
  return token.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function tryExtractSemanticToken(args: {
  operationName: string | null | undefined;
  normalizedUrl: string | null | undefined;
}): string | null {
  if (typeof args.operationName === 'string' && args.operationName.trim().length > 0) {
    const operationTokens = splitOperationTokens(args.operationName.trim());
    for (const token of operationTokens) {
      const normalized = normalizeSemanticToken(token);
      if (!normalized || GENERIC_OPERATION_WORDS.has(normalized)) {
        continue;
      }
      return toTitleCase(normalized);
    }
  }

  if (typeof args.normalizedUrl !== 'string' || args.normalizedUrl.length === 0) {
    return null;
  }

  try {
    const parsed = new URL(args.normalizedUrl);
    const segments = tokenizePath(parsed.pathname);
    for (const segment of segments) {
      const normalized = normalizeSemanticToken(segment);
      if (!normalized || GENERIC_PATH_SEGMENTS.has(normalized) || normalized.length < 2) {
        continue;
      }
      return toTitleCase(normalized);
    }
  } catch {
    return null;
  }

  return null;
}

export function isLikelyAuthHeaderName(headerName: string | null | undefined): boolean {
  if (typeof headerName !== 'string' || headerName.length === 0) {
    return false;
  }

  const normalized = headerName.toLowerCase();
  if (AUTH_HEADER_NAMES.has(normalized)) {
    return true;
  }

  return (
    normalized.startsWith('x-auth-') ||
    normalized.startsWith('x-api-') ||
    normalized.includes('token') ||
    normalized.includes('session')
  );
}

export function truncateValue(value: string, maxLength = 78): string {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 1) {
    return '…';
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function redactSensitiveValue(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return '(empty)';
  }

  if (normalized.length <= 6) {
    return `${normalized[0] ?? ''}•••${normalized.slice(-1)}`;
  }

  const prefix = normalized.slice(0, 4);
  const suffix = normalized.slice(-3);
  return `${prefix}••••${suffix}`;
}

export function inferSemanticGroup(args: {
  normalizedUrl: string | null | undefined;
  operationName: string | null | undefined;
  apiType: 'graphql' | 'rest';
}): { label: string; isInferred: boolean } {
  const semanticToken = tryExtractSemanticToken({
    operationName: args.operationName,
    normalizedUrl: args.normalizedUrl,
  });

  if (!semanticToken) {
    return {
      label: args.apiType === 'graphql' ? 'Core GraphQL API' : 'Core REST API',
      isInferred: false,
    };
  }

  return {
    label: `${semanticToken} ${args.apiType === 'graphql' ? 'GraphQL API' : 'REST API'}`,
    isInferred: true,
  };
}

export function buildHeaderValuesMap(
  entries: readonly RecordedNetworkEntry[],
  source: 'request' | 'response',
): Record<string, string[]> {
  const valuesByHeader: Record<string, string[]> = {};

  for (const entry of entries) {
    const headers = source === 'request' ? entry.request?.headers : entry.response?.headers;
    if (!Array.isArray(headers)) {
      continue;
    }

    for (const header of headers) {
      if (!header || typeof header.name !== 'string') {
        continue;
      }

      const lowerName = header.name.toLowerCase();
      const value = normalizeHeaderValue(header.value);

      if (!(lowerName in valuesByHeader)) {
        valuesByHeader[lowerName] = [];
      }

      if (!valuesByHeader[lowerName].includes(value)) {
        valuesByHeader[lowerName].push(value);
      }
    }
  }

  return valuesByHeader;
}

export function getScore(entry: RecordedNetworkEntry): number {
  return typeof entry.score?.total === 'number' ? entry.score.total : 0;
}

export function sortByScore(entries: readonly RecordedNetworkEntry[]): RecordedNetworkEntry[] {
  return entries.slice().sort((left, right) => {
    const scoreDifference = getScore(right) - getScore(left);
    if (scoreDifference !== 0) {
      return scoreDifference;
    }
    return (right.id || 0) - (left.id || 0);
  });
}

export function getMethodClass(method: string): 'method-get' | 'method-write' | 'method-other' {
  if (method === 'GET') {
    return 'method-get';
  }
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    return 'method-write';
  }
  return 'method-other';
}

export function getDisplayMethod(method: string | null | undefined): string {
  return typeof method === 'string' && method.length > 0 ? method.toUpperCase() : 'GET';
}

export function isGraphQLEntry(entry: RecordedNetworkEntry): boolean {
  return isGraphQLRequest(entry.request);
}

export function isGraphQLGroup(group: PanelEndpointGroup): boolean {
  return group.entries.some((entry) => isGraphQLEntry(entry));
}

export function classifyGroups(groups: readonly PanelEndpointGroup[]): {
  graphql: PanelEndpointGroup[];
  rest: PanelEndpointGroup[];
} {
  const graphql: PanelEndpointGroup[] = [];
  const rest: PanelEndpointGroup[] = [];

  for (const group of groups) {
    if (isGraphQLGroup(group)) {
      graphql.push(group);
    } else {
      rest.push(group);
    }
  }

  return { graphql, rest };
}

export function sortGroups(groups: readonly PanelEndpointGroup[]): PanelEndpointGroup[] {
  return groups.slice().sort((left, right) => {
    const leftMax = left.entries.reduce((max, entry) => Math.max(max, getScore(entry)), 0);
    const rightMax = right.entries.reduce((max, entry) => Math.max(max, getScore(entry)), 0);

    if (rightMax !== leftMax) {
      return rightMax - leftMax;
    }
    if (right.entries.length !== left.entries.length) {
      return right.entries.length - left.entries.length;
    }
    return 0;
  });
}

export function formatSnapshotTime(snapshotTime: Date | null): string {
  if (!(snapshotTime instanceof Date)) {
    return '';
  }

  return snapshotTime.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function getCompactPath(normalizedUrl: string | null): string {
  if (typeof normalizedUrl !== 'string') {
    return '(unknown)';
  }

  try {
    const parsed = new URL(normalizedUrl);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return normalizedUrl;
  }
}

export function formatCookieFlags(cookie: Browser.cookies.Cookie): string {
  const flags: string[] = [];

  if (cookie.secure) {
    flags.push('Secure');
  }
  if (cookie.httpOnly) {
    flags.push('HttpOnly');
  }
  if (cookie.session) {
    flags.push('Session');
  }
  if (cookie.hostOnly) {
    flags.push('HostOnly');
  }
  if (typeof cookie.sameSite === 'string' && cookie.sameSite !== 'unspecified') {
    flags.push(`SameSite=${cookie.sameSite}`);
  }
  if (cookie.partitionKey) {
    flags.push('Partitioned');
  }

  return flags.length > 0 ? flags.join(', ') : 'None';
}

export function sortCookies(cookies: readonly Browser.cookies.Cookie[]): Browser.cookies.Cookie[] {
  return cookies.slice().sort((left, right) => {
    const nameOrder = (left.name ?? '').localeCompare(right.name ?? '');
    if (nameOrder !== 0) {
      return nameOrder;
    }
    return (left.domain ?? '').localeCompare(right.domain ?? '');
  });
}

export function getHostnameFromUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || url.length === 0) {
    return null;
  }
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

export function getHttpUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || url.length === 0) {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function getUrlFromEntries(entries: readonly RecordedNetworkEntry[]): string | null {
  for (const entry of entries) {
    const candidate = getHttpUrl(entry.request?.url);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

export function getDomainFromEntries(entries: readonly RecordedNetworkEntry[]): string | null {
  for (const entry of entries) {
    const domain = getHostnameFromUrl(entry.request?.url);
    if (domain) {
      return domain;
    }
  }
  return null;
}

export function normalizeHeaders(
  headers: readonly HeaderLike[] | null | undefined,
): Array<{ name: string; value: string }> {
  if (!Array.isArray(headers)) {
    return [];
  }

  const result: Array<{ name: string; value: string }> = [];
  for (const header of headers) {
    if (!header || typeof header.name !== 'string') {
      continue;
    }
    result.push({
      name: header.name,
      value: header.value != null ? String(header.value) : '',
    });
  }

  return result;
}

export function serializeScore(score: RequestScore | null | undefined): {
  total: number;
  normalized: number | null;
  reasons: RequestScore['reasons'];
} {
  return {
    total: score && typeof score.total === 'number' ? score.total : 0,
    normalized: score && typeof score.normalized === 'number' ? score.normalized : null,
    reasons: score?.reasons ?? [],
  };
}

export function getSnapshotTimestamp(snapshotTime: Date | null): string | null {
  return snapshotTime instanceof Date ? snapshotTime.toISOString() : null;
}

function formatNumberForFilename(value: number): string {
  return String(value).padStart(2, '0');
}

export function buildSnapshotFilename(snapshotTime: Date | null): string {
  const date = snapshotTime instanceof Date ? snapshotTime : new Date();
  const yyyy = date.getFullYear();
  const mm = formatNumberForFilename(date.getMonth() + 1);
  const dd = formatNumberForFilename(date.getDate());
  const hh = formatNumberForFilename(date.getHours());
  const min = formatNumberForFilename(date.getMinutes());
  const ss = formatNumberForFilename(date.getSeconds());

  return `prism-snapshot-${yyyy}${mm}${dd}-${hh}${min}${ss}.json`;
}

export function buildBundleFilename(): string {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = formatNumberForFilename(date.getMonth() + 1);
  const dd = formatNumberForFilename(date.getDate());
  const hh = formatNumberForFilename(date.getHours());
  const min = formatNumberForFilename(date.getMinutes());
  const ss = formatNumberForFilename(date.getSeconds());

  return `prism-api-bundle-${yyyy}${mm}${dd}-${hh}${min}${ss}.zip`;
}
