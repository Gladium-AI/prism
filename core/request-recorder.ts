import type {
  BrowserLike,
  CookieLike,
  DevtoolsNetworkRequestEntryLike,
  HeaderLike,
  RecordedNetworkEntry,
  RequestScore,
  ScoreReason,
} from './types';

const EMPTY_ARRAY: readonly never[] = Object.freeze([]);
const URL_PATTERNS = ['/api/', '/graphql/', '/v1/'] as const;
const AUTH_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
]);

const SCORE_WEIGHTS = Object.freeze({
  contentTypeJsonOrGraphql: 40,
  methodWrite: 25,
  methodGet: 5,
  urlPattern: 10,
  requestBody: 15,
  authHeader: 15,
});

interface RecorderState {
  entries: RecordedNetworkEntry[];
  isListening: boolean;
  nextId: number;
}

interface ContentResult {
  body: string | null;
  encoding: string | null;
  error: string | null;
}

export interface RequestRecorder {
  start(): void;
  stop(): void;
  clear(): void;
  getEntries(): RecordedNetworkEntry[];
}

function toSafeArray<T>(value: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(value) ? value : (EMPTY_ARRAY as readonly T[]);
}

function cloneHeaders(headers: readonly HeaderLike[] | null | undefined): HeaderLike[] {
  return toSafeArray(headers).map((header) => ({
    name: header.name,
    value: header.value,
  }));
}

function normalizeCookieExpires(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return null;
}

function cloneCookies(
  cookies: readonly CookieLike[] | null | undefined,
): Array<{
  name: string;
  value: string;
  domain: string | null;
  path: string | null;
  expires: string | null;
  httpOnly: boolean | null;
  secure: boolean | null;
  sameSite: string | null;
}> {
  return toSafeArray(cookies)
    .filter((cookie): cookie is CookieLike => !!cookie && typeof cookie.name === 'string')
    .map((cookie) => ({
      name: cookie.name,
      value: cookie.value == null ? '' : String(cookie.value),
      domain: typeof cookie.domain === 'string' && cookie.domain.length > 0 ? cookie.domain : null,
      path: typeof cookie.path === 'string' && cookie.path.length > 0 ? cookie.path : null,
      expires: normalizeCookieExpires(cookie.expires),
      httpOnly: typeof cookie.httpOnly === 'boolean' ? cookie.httpOnly : null,
      secure: typeof cookie.secure === 'boolean' ? cookie.secure : null,
      sameSite: typeof cookie.sameSite === 'string' && cookie.sameSite.length > 0 ? cookie.sameSite : null,
    }));
}

function toHeaderMap(headers: readonly HeaderLike[] | null | undefined): Record<string, string> {
  const map: Record<string, string> = {};

  for (const header of toSafeArray(headers)) {
    if (!header || typeof header.name !== 'string') {
      continue;
    }

    const lowerName = header.name.toLowerCase();
    map[lowerName] = header.value == null ? '' : String(header.value);
  }

  return map;
}

function getRequestContentType(entry: DevtoolsNetworkRequestEntryLike): string {
  const request = entry.request ?? {};
  const headers = toHeaderMap(request.headers);
  const headerContentType = headers['content-type'];
  const mimeType = typeof request.postData?.mimeType === 'string' ? request.postData.mimeType : '';

  return (headerContentType || mimeType || '').toLowerCase();
}

function getResponseContentType(entry: DevtoolsNetworkRequestEntryLike): string {
  const response = entry.response ?? {};
  const headers = toHeaderMap(response.headers);
  const headerContentType = headers['content-type'];
  const mimeType = typeof response.content?.mimeType === 'string' ? response.content.mimeType : '';

  return (headerContentType || mimeType || '').toLowerCase();
}

function hasRequestBody(entry: DevtoolsNetworkRequestEntryLike): boolean {
  const postData = entry.request?.postData;
  if (!postData) {
    return false;
  }

  if (typeof postData.text === 'string' && postData.text.trim().length > 0) {
    return true;
  }

  return Array.isArray(postData.params) && postData.params.length > 0;
}

function hasAuthHeaders(entry: DevtoolsNetworkRequestEntryLike): boolean {
  const headers = toHeaderMap(entry.request?.headers);
  for (const name of Object.keys(headers)) {
    if (AUTH_HEADER_NAMES.has(name) || name.startsWith('x-auth-') || name.startsWith('x-api-')) {
      return true;
    }
  }
  return false;
}

function getMatchedUrlPatterns(url: string | null | undefined): readonly string[] {
  if (typeof url !== 'string' || url.length === 0) {
    return EMPTY_ARRAY;
  }

  const normalizedUrl = url.toLowerCase();
  return URL_PATTERNS.filter((pattern) => normalizedUrl.includes(pattern));
}

export function scoreRequest(entry: DevtoolsNetworkRequestEntryLike): RequestScore {
  let total = 0;
  const reasons: ScoreReason[] = [];

  const requestContentType = getRequestContentType(entry);
  const responseContentType = getResponseContentType(entry);
  const contentType = responseContentType || requestContentType;

  if (contentType.includes('json') || contentType.includes('graphql')) {
    total += SCORE_WEIGHTS.contentTypeJsonOrGraphql;
    reasons.push({
      rule: 'content-type',
      points: SCORE_WEIGHTS.contentTypeJsonOrGraphql,
      detail: contentType,
    });
  }

  const method = typeof entry.request?.method === 'string' ? entry.request.method.toUpperCase() : '';
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    total += SCORE_WEIGHTS.methodWrite;
    reasons.push({
      rule: 'method',
      points: SCORE_WEIGHTS.methodWrite,
      detail: method,
    });
  } else if (method === 'GET') {
    total += SCORE_WEIGHTS.methodGet;
    reasons.push({
      rule: 'method',
      points: SCORE_WEIGHTS.methodGet,
      detail: method,
    });
  }

  const matchedPatterns = getMatchedUrlPatterns(entry.request?.url);
  if (matchedPatterns.length > 0) {
    const urlPoints = matchedPatterns.length * SCORE_WEIGHTS.urlPattern;
    total += urlPoints;
    reasons.push({
      rule: 'url-pattern',
      points: urlPoints,
      detail: matchedPatterns.join(', '),
    });
  }

  if (hasRequestBody(entry)) {
    total += SCORE_WEIGHTS.requestBody;
    reasons.push({
      rule: 'request-body',
      points: SCORE_WEIGHTS.requestBody,
    });
  }

  if (hasAuthHeaders(entry)) {
    total += SCORE_WEIGHTS.authHeader;
    reasons.push({
      rule: 'auth-header',
      points: SCORE_WEIGHTS.authHeader,
    });
  }

  return {
    total,
    reasons,
    normalized: Math.min(100, total),
  };
}

async function getContent(entry: DevtoolsNetworkRequestEntryLike): Promise<ContentResult> {
  return new Promise((resolve) => {
    if (!entry || typeof entry.getContent !== 'function') {
      resolve({ body: null, encoding: null, error: 'getContent unavailable' });
      return;
    }

    try {
      entry.getContent((body, encoding) => {
        resolve({
          body: typeof body === 'string' ? body : null,
          encoding: typeof encoding === 'string' && encoding.length > 0 ? encoding : null,
          error: null,
        });
      });
    } catch (error) {
      resolve({
        body: null,
        encoding: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

function buildRecordedEntry(
  entry: DevtoolsNetworkRequestEntryLike,
  contentResult: ContentResult,
  id: number,
): RecordedNetworkEntry {
  const request = entry.request ?? {};
  const response = entry.response ?? {};
  const score = scoreRequest(entry);

  return {
    id,
    capturedAt: new Date().toISOString(),
    score,
    request: {
      method: request.method ?? null,
      url: request.url ?? null,
      headers: cloneHeaders(request.headers),
      cookies: cloneCookies(request.cookies),
      body: typeof request.postData?.text === 'string' ? request.postData.text : null,
    },
    response: {
      status: typeof response.status === 'number' ? response.status : null,
      statusText: response.statusText ?? null,
      headers: cloneHeaders(response.headers),
      cookies: cloneCookies(response.cookies),
      contentType: getResponseContentType(entry) || getRequestContentType(entry) || null,
      body: contentResult.body,
      encoding: contentResult.encoding,
      bodyCaptureError: contentResult.error,
    },
    timing: {
      startedDateTime: entry.startedDateTime ?? null,
      durationMs: typeof entry.time === 'number' ? entry.time : null,
    },
  };
}

function getDefaultBrowser(): BrowserLike | undefined {
  const globalValue = globalThis as { browser?: BrowserLike };
  return globalValue.browser;
}

export function createRequestRecorder(targetBrowser: BrowserLike | undefined = getDefaultBrowser()): RequestRecorder {
  const state: RecorderState = {
    entries: [],
    isListening: false,
    nextId: 1,
  };

  const handleRequestFinished = async (entry: DevtoolsNetworkRequestEntryLike): Promise<void> => {
    const contentResult = await getContent(entry);
    const recorded = buildRecordedEntry(entry, contentResult, state.nextId);
    state.nextId += 1;
    state.entries.push(recorded);
  };

  const start = (): void => {
    if (state.isListening) {
      return;
    }

    const finishedEvent = targetBrowser?.devtools?.network?.onRequestFinished;
    if (
      !finishedEvent ||
      typeof finishedEvent.addListener !== 'function' ||
      typeof finishedEvent.removeListener !== 'function'
    ) {
      return;
    }

    finishedEvent.addListener(handleRequestFinished);
    state.isListening = true;
  };

  const stop = (): void => {
    if (!state.isListening) {
      return;
    }

    const finishedEvent = targetBrowser?.devtools?.network?.onRequestFinished;
    if (
      !finishedEvent ||
      typeof finishedEvent.addListener !== 'function' ||
      typeof finishedEvent.removeListener !== 'function'
    ) {
      state.isListening = false;
      return;
    }

    finishedEvent.removeListener(handleRequestFinished);
    state.isListening = false;
  };

  const clear = (): void => {
    state.entries.length = 0;
  };

  const getEntries = (): RecordedNetworkEntry[] => {
    return state.entries.slice();
  };

  return {
    start,
    stop,
    clear,
    getEntries,
  };
}
