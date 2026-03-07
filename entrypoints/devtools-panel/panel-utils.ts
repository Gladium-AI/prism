import type {
  EndpointGroup,
  HeaderLike,
  RecordedNetworkEntry,
  RequestScore,
} from '@/core';

export type PanelEndpointGroup = EndpointGroup<RecordedNetworkEntry>;

function normalizeHeaderValue(rawValue: unknown): string {
  return rawValue == null ? '' : String(rawValue);
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
  const request = entry.request ?? {};
  const url = typeof request.url === 'string' ? request.url : '';

  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.includes('/graphql')) {
      return true;
    }
  } catch {
    if (url.toLowerCase().includes('/graphql')) {
      return true;
    }
  }

  const body = typeof request.body === 'string' ? request.body : '';
  if (body.length === 0) {
    return false;
  }

  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return typeof parsed.query === 'string' || typeof parsed.mutation === 'string';
  } catch {
    return false;
  }
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
