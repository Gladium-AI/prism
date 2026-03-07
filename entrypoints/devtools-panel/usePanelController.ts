import {
  createRequestRecorder,
  deduplicateEntries,
  endpointKey,
  inferSchema,
  mergeEndpointGroup,
  type BodySchema,
  type HeaderField,
  type JsonSchema,
  type RecordedNetworkEntry,
  type RequestRecorder,
  type SchemaObservation,
} from '@/core';
import {
  buildMapFilename,
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

interface MapHeader {
  name: string;
  type: string;
  optional?: boolean;
  authentication?: boolean;
}

interface MapSchemaNode {
  type: string;
  variants?: string[];
  optional?: boolean;
  items?: MapSchemaNode | null;
  fields?: Record<string, MapSchemaNode>;
}

interface MapBodyNode {
  contentType: string;
  schema?: MapSchemaNode | null;
}

interface MapAuthHeader {
  header: string;
  type: string;
}

interface MapEndpoint {
  method: string;
  url: string;
  apiType: 'graphql' | 'rest';
  observations: number;
  authentication?: MapAuthHeader[];
  request?: {
    headers: MapHeader[] | null;
    body: MapBodyNode | null;
  };
  response?: {
    headers: MapHeader[] | null;
    body: MapBodyNode | null;
  };
}

interface MapExportPayload {
  format: 'prism-api-map-v1';
  exportedAt: string;
  endpointCount: number;
  endpoints: MapEndpoint[];
}

function downloadTextFile(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
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
      body: typeof request.body === 'string' ? request.body : null,
    },
    response: {
      status: typeof response.status === 'number' ? response.status : null,
      statusText: typeof response.statusText === 'string' ? response.statusText : null,
      headers: normalizeHeaders(response.headers),
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

function serializeHeaderForMap(field: HeaderField): MapHeader {
  return {
    name: field.name,
    type: field.valueType || 'unknown',
    ...(field.optional ? { optional: true } : {}),
    ...(field.isAuth ? { authentication: true } : {}),
  };
}

function serializeSchemaForMap(schema: JsonSchema | null): MapSchemaNode | null {
  if (!schema) {
    return null;
  }

  if (schema.type === 'mixed' && Array.isArray(schema.variants)) {
    return { type: 'mixed', variants: schema.variants };
  }

  if (schema.type === 'array') {
    return {
      type: 'array',
      items: schema.items ? serializeSchemaForMap(schema.items) : undefined,
    };
  }

  if (schema.type === 'object' && schema.fields) {
    const fields: Record<string, MapSchemaNode> = {};
    for (const key of Object.keys(schema.fields)) {
      const child = schema.fields[key];
      const serialized = serializeSchemaForMap(child);
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

function serializeBodyForMap(bodySchema: BodySchema | null): MapBodyNode | null {
  if (!bodySchema) {
    return null;
  }

  return {
    contentType: bodySchema.contentType || 'unknown',
    ...(bodySchema.schema ? { schema: serializeSchemaForMap(bodySchema.schema) } : {}),
  };
}

function buildEndpointsSummary(entries: readonly RecordedNetworkEntry[]): EndpointSummary[] {
  const groups = deduplicateEntries(entries);
  return groups.map((group) => {
    const maxScore = group.entries.reduce((max, entry) => Math.max(max, getScore(entry)), 0);

    return {
      endpointKey: group.endpointKey,
      normalizedUrl: group.normalizedUrl,
      method: group.method,
      apiType: classifyGroups([group]).graphql.length > 0 ? 'graphql' : 'rest',
      observationCount: group.entries.length,
      maxScore,
      mergedSchema: mergeEndpointGroup(group)?.schema ?? null,
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

function buildMapExportPayload(args: {
  groups: PanelEndpointGroup[];
  checkedEndpointKeys: Record<string, boolean>;
  mergedSchemaByKey: Record<string, SchemaObservation | null>;
}): MapExportPayload {
  const endpoints: MapEndpoint[] = [];

  for (const group of args.groups) {
    if (!args.checkedEndpointKeys[group.endpointKey]) {
      continue;
    }

    const mergedSchema = args.mergedSchemaByKey[group.endpointKey];
    const endpoint: MapEndpoint = {
      method: group.method || 'GET',
      url: group.normalizedUrl || group.endpointKey,
      apiType: classifyGroups([group]).graphql.length > 0 ? 'graphql' : 'rest',
      observations: group.entries.length,
    };

    if (mergedSchema) {
      const requestFields = mergedSchema.request.headers.fields ?? [];
      const authHeaders = requestFields
        .filter((field) => field.isAuth)
        .map((field) => ({ header: field.name, type: field.valueType || 'string' }));
      if (authHeaders.length > 0) {
        endpoint.authentication = authHeaders;
      }

      endpoint.request = {
        headers: requestFields.length > 0 ? requestFields.map(serializeHeaderForMap) : null,
        body: serializeBodyForMap(mergedSchema.request.body),
      };

      const responseFields = mergedSchema.response.headers.fields ?? [];
      endpoint.response = {
        headers: responseFields.length > 0 ? responseFields.map(serializeHeaderForMap) : null,
        body: serializeBodyForMap(mergedSchema.response.body),
      };
    }

    endpoints.push(endpoint);
  }

  return {
    format: 'prism-api-map-v1',
    exportedAt: new Date().toISOString(),
    endpointCount: endpoints.length,
    endpoints,
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

  const recorderRef = useRef<RequestRecorder | null>(null);
  const snapshotCaptureIdRef = useRef(0);

  useEffect(() => {
    const recorder = createRequestRecorder(browser);
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

  const exportMap = useCallback(() => {
    if (!displayEntries.length) {
      return;
    }

    try {
      const payload = buildMapExportPayload({
        groups,
        checkedEndpointKeys,
        mergedSchemaByKey,
      });
      downloadTextFile(buildMapFilename(), JSON.stringify(payload, null, 2));
      setStatusOverride(null);
    } catch (error) {
      setStatusOverride(`Map export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [displayEntries.length, groups, checkedEndpointKeys, mergedSchemaByKey]);

  return {
    isSnapshot,
    snapshotTime,
    selectedEndpointKey,
    checkedEndpointKeys,
    collapsedSections,
    displayEntries,
    groups,
    mergedSchemaByKey,
    selectedGroup,
    selectedMergedSchema,
    snapshotCookies,
    snapshotCookieDomain,
    snapshotCookieError,
    isCapturingCookies,
    statusOverride,
    checkedCount,
    setSelectedEndpointKey,
    setCheckedEndpointKeys,
    setCollapsedSections,
    selectAll,
    selectNone,
    toggleSnapshot,
    exportSnapshot,
    exportMap,
  };
}
