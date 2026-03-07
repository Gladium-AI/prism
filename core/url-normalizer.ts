const NUMERIC_RE = /^\d+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RE = /^[0-9a-f]{8,}$/i;
const LONG_ALNUM_RE = /^[A-Za-z0-9_-]{16,}$/;
const PLACEHOLDER = ':id';

export function isDynamicSegment(segment: string): boolean {
  if (segment.length === 0) {
    return false;
  }

  if (NUMERIC_RE.test(segment)) {
    return true;
  }

  if (UUID_RE.test(segment)) {
    return true;
  }

  if (HEX_RE.test(segment) && !/^[a-z]+$/i.test(segment)) {
    return true;
  }

  if (LONG_ALNUM_RE.test(segment) && /\d/.test(segment)) {
    return true;
  }

  return false;
}

export function normalizePath(pathname: string): string {
  const segments = pathname.split('/');
  const normalized: string[] = [];

  for (const segment of segments) {
    if (segment.length === 0) {
      normalized.push(segment);
      continue;
    }
    normalized.push(isDynamicSegment(segment) ? PLACEHOLDER : segment);
  }

  return normalized.join('/');
}

export function normalizeQueryKeys(search: string): string {
  if (search.length === 0) {
    return '';
  }

  const raw = search.charAt(0) === '?' ? search.slice(1) : search;
  if (raw.length === 0) {
    return '';
  }

  const keys = raw
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      return eq === -1 ? pair : pair.slice(0, eq);
    })
    .filter((key) => key.length > 0)
    .sort();

  if (keys.length === 0) {
    return '';
  }

  const unique: string[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    if (index === 0 || keys[index] !== keys[index - 1]) {
      unique.push(keys[index]);
    }
  }

  if (unique.length === 0) {
    return '';
  }

  return `?${unique.join('&')}`;
}

export function normalizeUrl(url: string): string | null {
  if (url.length === 0) {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    const path = normalizePath(parsed.pathname);
    const query = normalizeQueryKeys(parsed.search);
    return `${parsed.protocol}//${parsed.host}${path}${query}`;
  } catch {
    return null;
  }
}

export function endpointKey(method: string | null | undefined, url: string | null | undefined): string {
  const normalizedMethod =
    typeof method === 'string' && method.length > 0 ? method.toUpperCase() : 'GET';
  const normalizedUrl = typeof url === 'string' ? normalizeUrl(url) : null;

  if (normalizedUrl === null) {
    return `${normalizedMethod} ${typeof url === 'string' ? url : '(unknown)'}`;
  }

  return `${normalizedMethod} ${normalizedUrl}`;
}
