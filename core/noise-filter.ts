import type {
  DevtoolsNetworkRequestEntryLike,
  HeaderLike,
  NoiseFilterCategoryKey,
  NoiseFilterCategorySettings,
  NoiseFilterSettings,
} from './types';

const EMPTY_ARRAY: readonly never[] = Object.freeze([]);

const FONT_EXTENSIONS = new Set(['.woff', '.woff2', '.ttf', '.otf', '.eot']);
const MEDIA_FILE_EXTENSIONS = new Set(['.m3u8', '.m4s']);
const STATIC_ASSET_EXTENSIONS = new Set(['.js', '.css', '.html', '.map', '.ico', '.svg']);
const MEDIA_RESOURCE_TYPES = new Set(['image', 'media', 'font', 'imageset']);
const STATIC_RESOURCE_TYPES = new Set(['document', 'script', 'stylesheet']);
const STATIC_DESTINATIONS = new Set(['document', 'script', 'style']);

const BROWSER_INTERNAL_PROTOCOLS = new Set(['chrome-extension:', 'devtools:', 'blob:', 'data:']);

const TRACKER_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'googleadservices.com',
  'segment.com',
  'segment.io',
  'mixpanel.com',
  'amplitude.com',
  'hotjar.com',
  'sentry.io',
  'sentry-cdn.com',
  'datadoghq.com',
  'datadoghq-browser-agent.com',
  'browser-intake-datadoghq.com',
] as const;

const TRACKING_URL_PATTERNS = ['/collect', '/track', '/pixel', '/beacon'] as const;
const HEALTH_URL_PATTERNS = ['/health', '/ping', '/heartbeat', '/status'] as const;

const TEXTUAL_ACK_BODY_LENGTHS = new Set([2, 4]);

export const DEFAULT_NOISE_FILTER_CATEGORIES: Readonly<NoiseFilterCategorySettings> = Object.freeze({
  media: true,
  staticAssets: true,
  analyticsTracking: true,
  prefetchPreload: true,
  healthChecksPings: true,
  browserInternals: true,
});

function toSafeArray<T>(value: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(value) ? value : (EMPTY_ARRAY as readonly T[]);
}

function toHeaderMap(headers: readonly HeaderLike[] | null | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const header of toSafeArray(headers)) {
    if (!header || typeof header.name !== 'string') {
      continue;
    }
    map[header.name.toLowerCase()] = header.value == null ? '' : String(header.value);
  }
  return map;
}

function parseUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function getPathExtension(pathname: string): string {
  const fileName = pathname.split('/').pop() ?? '';
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0) {
    return '';
  }
  return fileName.slice(dotIndex).toLowerCase();
}

function getRequestContentType(entry: DevtoolsNetworkRequestEntryLike, requestHeaders: Record<string, string>): string {
  const requestMimeType = typeof entry.request?.postData?.mimeType === 'string' ? entry.request.postData.mimeType : '';
  const headerContentType = requestHeaders['content-type'];
  return (headerContentType || requestMimeType || '').toLowerCase();
}

function getResponseContentType(entry: DevtoolsNetworkRequestEntryLike, responseHeaders: Record<string, string>): string {
  const responseMimeType = typeof entry.response?.content?.mimeType === 'string' ? entry.response.content.mimeType : '';
  const headerContentType = responseHeaders['content-type'];
  return (headerContentType || responseMimeType || '').toLowerCase();
}

function parseNumericHeaderValue(value: string | undefined): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasNoResponseBody(
  entry: DevtoolsNetworkRequestEntryLike,
  responseHeaders: Record<string, string>,
): boolean {
  const method = typeof entry.request?.method === 'string' ? entry.request.method.toUpperCase() : '';
  if (method === 'HEAD') {
    return true;
  }

  const status = typeof entry.response?.status === 'number' ? entry.response.status : null;
  if (status === 204 || status === 304) {
    return true;
  }

  const contentLength = parseNumericHeaderValue(responseHeaders['content-length']);
  if (contentLength === 0) {
    return true;
  }

  const bodySize =
    typeof entry.response?.bodySize === 'number' && Number.isFinite(entry.response.bodySize)
      ? entry.response.bodySize
      : null;
  if (bodySize === 0) {
    return true;
  }

  const contentSize =
    typeof entry.response?.content?.size === 'number' && Number.isFinite(entry.response.content.size)
      ? entry.response.content.size
      : null;
  if (contentSize === 0) {
    return true;
  }

  const transferEncoding = responseHeaders['transfer-encoding'];
  if (transferEncoding && transferEncoding.toLowerCase().includes('chunked')) {
    return false;
  }

  return false;
}

function isTextualContentType(contentType: string): boolean {
  if (!contentType) {
    return false;
  }
  return (
    contentType.includes('text/') ||
    contentType.includes('application/json') ||
    contentType.includes('application/problem+json') ||
    contentType.includes('application/x-www-form-urlencoded')
  );
}

function hasKnownAckBodyHeuristic(entry: DevtoolsNetworkRequestEntryLike, responseHeaders: Record<string, string>): boolean {
  const contentLength = parseNumericHeaderValue(responseHeaders['content-length']);
  const inferredBodyLength =
    contentLength ??
    (typeof entry.response?.content?.size === 'number' && Number.isFinite(entry.response.content.size)
      ? entry.response.content.size
      : null);

  if (inferredBodyLength == null || !TEXTUAL_ACK_BODY_LENGTHS.has(inferredBodyLength)) {
    return false;
  }

  const contentType = getResponseContentType(entry, responseHeaders);
  return isTextualContentType(contentType);
}

function getResourceType(entry: DevtoolsNetworkRequestEntryLike): string {
  return typeof entry._resourceType === 'string' ? entry._resourceType.toLowerCase() : '';
}

function normalizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return '';
  }

  const withoutProtocol = trimmed.replace(/^[a-z]+:\/\//, '');
  const firstSegment = withoutProtocol.split('/')[0] ?? '';
  const withoutPort = firstSegment.split(':')[0] ?? '';
  return withoutPort.replace(/^\*\./, '').replace(/^\./, '');
}

function domainMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function customDomainMatch(hostname: string, domains: readonly string[]): boolean {
  for (const domainPattern of domains) {
    const domain = normalizeDomain(domainPattern);
    if (!domain) {
      continue;
    }
    if (domainMatches(hostname, domain)) {
      return true;
    }
  }
  return false;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globMatch(value: string, globPattern: string): boolean {
  const segments = globPattern.split('*').map(escapeRegex);
  const regex = new RegExp(segments.join('.*'));
  return regex.test(value);
}

function customUrlPatternMatch(urlLowerCase: string, patterns: readonly string[]): boolean {
  for (const patternValue of patterns) {
    const pattern = patternValue.trim().toLowerCase();
    if (!pattern) {
      continue;
    }
    if (pattern.includes('*')) {
      if (globMatch(urlLowerCase, pattern)) {
        return true;
      }
      continue;
    }
    if (urlLowerCase.includes(pattern)) {
      return true;
    }
  }
  return false;
}

function isBrowserInternalRequest(urlLowerCase: string, parsedUrl: URL | null): boolean {
  if (parsedUrl) {
    return BROWSER_INTERNAL_PROTOCOLS.has(parsedUrl.protocol);
  }
  return (
    urlLowerCase.startsWith('chrome-extension://') ||
    urlLowerCase.startsWith('devtools://') ||
    urlLowerCase.startsWith('blob:') ||
    urlLowerCase.startsWith('data:')
  );
}

function isMediaRequest(
  entry: DevtoolsNetworkRequestEntryLike,
  parsedUrl: URL | null,
  requestHeaders: Record<string, string>,
  responseHeaders: Record<string, string>,
): boolean {
  const responseContentType = getResponseContentType(entry, responseHeaders);
  const requestContentType = getRequestContentType(entry, requestHeaders);
  const contentType = responseContentType || requestContentType;
  const resourceType = getResourceType(entry);

  if (
    contentType.startsWith('image/') ||
    contentType.startsWith('video/') ||
    contentType.startsWith('audio/') ||
    contentType.startsWith('font/')
  ) {
    return true;
  }

  if (MEDIA_RESOURCE_TYPES.has(resourceType)) {
    return true;
  }

  const extension = parsedUrl ? getPathExtension(parsedUrl.pathname) : '';
  return FONT_EXTENSIONS.has(extension) || MEDIA_FILE_EXTENSIONS.has(extension);
}

function isStaticAssetRequest(
  entry: DevtoolsNetworkRequestEntryLike,
  parsedUrl: URL | null,
  requestHeaders: Record<string, string>,
): boolean {
  if (!parsedUrl) {
    return false;
  }

  const extension = getPathExtension(parsedUrl.pathname);
  if (!STATIC_ASSET_EXTENSIONS.has(extension)) {
    return false;
  }

  const destination = (requestHeaders['sec-fetch-dest'] ?? '').toLowerCase();
  if (destination && !STATIC_DESTINATIONS.has(destination)) {
    return false;
  }

  const resourceType = getResourceType(entry);
  if (resourceType && !STATIC_RESOURCE_TYPES.has(resourceType)) {
    return false;
  }

  return true;
}

function isAnalyticsOrTrackingRequest(parsedUrl: URL | null, urlLowerCase: string): boolean {
  if (!parsedUrl) {
    return TRACKING_URL_PATTERNS.some((pattern) => urlLowerCase.includes(pattern));
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (TRACKER_DOMAINS.some((domain) => domainMatches(hostname, domain))) {
    return true;
  }

  const pathAndQuery = `${parsedUrl.pathname}${parsedUrl.search}`.toLowerCase();
  return TRACKING_URL_PATTERNS.some((pattern) => pathAndQuery.includes(pattern));
}

function isPrefetchOrPreloadRequest(
  entry: DevtoolsNetworkRequestEntryLike,
  requestHeaders: Record<string, string>,
  responseHeaders: Record<string, string>,
): boolean {
  const purposeHeader = (requestHeaders['purpose'] ?? requestHeaders['sec-purpose'] ?? '').toLowerCase();
  const destination = (requestHeaders['sec-fetch-dest'] ?? '').toLowerCase();
  const prefetchLike = purposeHeader.includes('prefetch') || destination === 'empty';

  return prefetchLike && hasNoResponseBody(entry, responseHeaders);
}

function isHealthCheckOrPingRequest(
  entry: DevtoolsNetworkRequestEntryLike,
  parsedUrl: URL | null,
  responseHeaders: Record<string, string>,
): boolean {
  if (!parsedUrl) {
    return false;
  }

  const pathAndQuery = `${parsedUrl.pathname}${parsedUrl.search}`.toLowerCase();
  const looksLikeHealthEndpoint = HEALTH_URL_PATTERNS.some((pattern) => pathAndQuery.includes(pattern));
  if (!looksLikeHealthEndpoint) {
    return false;
  }

  return (
    hasNoResponseBody(entry, responseHeaders) || hasKnownAckBodyHeuristic(entry, responseHeaders)
  );
}

function isCategoryEnabled(settings: NoiseFilterSettings, category: NoiseFilterCategoryKey): boolean {
  return settings.categories[category];
}

export function createDefaultNoiseFilterSettings(): NoiseFilterSettings {
  return {
    enabled: true,
    categories: {
      media: DEFAULT_NOISE_FILTER_CATEGORIES.media,
      staticAssets: DEFAULT_NOISE_FILTER_CATEGORIES.staticAssets,
      analyticsTracking: DEFAULT_NOISE_FILTER_CATEGORIES.analyticsTracking,
      prefetchPreload: DEFAULT_NOISE_FILTER_CATEGORIES.prefetchPreload,
      healthChecksPings: DEFAULT_NOISE_FILTER_CATEGORIES.healthChecksPings,
      browserInternals: DEFAULT_NOISE_FILTER_CATEGORIES.browserInternals,
    },
    customUrlPatterns: [],
    customDomains: [],
  };
}

export function shouldRecord(entry: DevtoolsNetworkRequestEntryLike, filterSettings: NoiseFilterSettings): boolean {
  if (!filterSettings.enabled) {
    return true;
  }

  const rawUrl = typeof entry.request?.url === 'string' ? entry.request.url : '';
  if (!rawUrl) {
    return true;
  }

  const urlLowerCase = rawUrl.toLowerCase();
  const parsedUrl = parseUrl(rawUrl);

  if (parsedUrl && customDomainMatch(parsedUrl.hostname.toLowerCase(), filterSettings.customDomains)) {
    return false;
  }
  if (customUrlPatternMatch(urlLowerCase, filterSettings.customUrlPatterns)) {
    return false;
  }

  const requestHeaders = toHeaderMap(entry.request?.headers);
  const responseHeaders = toHeaderMap(entry.response?.headers);

  if (isCategoryEnabled(filterSettings, 'browserInternals') && isBrowserInternalRequest(urlLowerCase, parsedUrl)) {
    return false;
  }

  if (isCategoryEnabled(filterSettings, 'media') && isMediaRequest(entry, parsedUrl, requestHeaders, responseHeaders)) {
    return false;
  }

  if (
    isCategoryEnabled(filterSettings, 'staticAssets') &&
    isStaticAssetRequest(entry, parsedUrl, requestHeaders)
  ) {
    return false;
  }

  if (isCategoryEnabled(filterSettings, 'analyticsTracking') && isAnalyticsOrTrackingRequest(parsedUrl, urlLowerCase)) {
    return false;
  }

  if (
    isCategoryEnabled(filterSettings, 'prefetchPreload') &&
    isPrefetchOrPreloadRequest(entry, requestHeaders, responseHeaders)
  ) {
    return false;
  }

  if (
    isCategoryEnabled(filterSettings, 'healthChecksPings') &&
    isHealthCheckOrPingRequest(entry, parsedUrl, responseHeaders)
  ) {
    return false;
  }

  return true;
}
