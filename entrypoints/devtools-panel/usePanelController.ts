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

interface BundleEndpoint {
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

function buildPrismMapMarkdown(args: {
  endpointsFile: EndpointsFilePayload;
  responsesFile: ResponsesFilePayload;
}): string {
  const sampleEndpoint = args.endpointsFile.endpoints[0] ?? null;
  const fallbackRef = Object.keys(args.responsesFile.responses)[0] ?? 'response_0001';
  const sampleResponseRef = sampleEndpoint?.responseRef ?? fallbackRef;
  const sampleMethod = sampleEndpoint?.method ?? 'GET';
  const sampleUrl = sampleEndpoint?.url ?? 'https://api.example.com/v1/resource/{id}';

  return [
    '# PRISM_MAP',
    '',
    'This bundle is designed for LLMs and coding agents. It separates endpoint indexing from response schemas so tools only load the minimum required context.',
    '',
    '## File Roles',
    '- `endpoints.json`: Lightweight endpoint index. Includes method, normalized URL, auth headers (names + types only), request schema, and `responseRef`.',
    '- `responses.json`: Response schema library keyed by `responseRef`. Each key contains response headers and payload schema.',
    '- `PRISM_MAP.md`: Instructions for navigating and using this bundle.',
    '',
    '## Cross-Reference Workflow',
    '1. Open `endpoints.json` and choose an endpoint by method + URL.',
    `2. Read its \`responseRef\`. Example endpoint: \`${sampleMethod} ${sampleUrl}\` uses \`${sampleResponseRef}\`.`,
    `3. Open \`responses.json\` and load only \`responses["${sampleResponseRef}"]\` for the response schema.`,
    '4. Combine endpoint request schema + referenced response schema to generate a scraper or integration.',
    '',
    '## Schema Reading Rules',
    '- Header schemas use `{ "name", "type" }`; `optional: true` means the field did not appear in every observation.',
    '- Payload schemas are recursive and type-based: `object` uses `fields`, `array` uses `items`.',
    '- Union types are represented as `{ "type": "mixed", "variants": ["string", "number"] }`.',
    '- Optional payload fields are marked with `optional: true` on that field node.',
    '- No raw request/response values are exported in these files.',
    '',
    '## Example Usage',
    `To build a scraper for \`${sampleMethod} ${sampleUrl}\`:`,
    `1. In \`endpoints.json\`, locate that endpoint and copy its request schema plus \`responseRef: ${sampleResponseRef}\`.`,
    `2. In \`responses.json\`, resolve \`${sampleResponseRef}\` and apply its headers/payload schema in your parser.`,
    '3. Generate request code using endpoint auth headers and request payload fields; generate parsing code from the response schema.',
  ].join('\n');
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

function buildStructuredBundlePayload(args: {
  groups: PanelEndpointGroup[];
  checkedEndpointKeys: Record<string, boolean>;
  mergedSchemaByKey: Record<string, SchemaObservation | null>;
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
    const method = group.method || 'GET';
    const url = group.normalizedUrl || group.endpointKey;
    const requestFields = mergedSchema?.request.headers.fields ?? [];
    const responseFields = mergedSchema?.response.headers.fields ?? [];
    const authHeaders = requestFields
      .filter((field) => field.isAuth)
      .map((field) => ({ name: field.name, type: field.valueType || 'string' }));

    const responseSchemaEntry: ResponseSchemaEntry = {
      headers: responseFields.length > 0 ? responseFields.map(serializeHeaderForBundle) : null,
      payload: serializePayloadForBundle(mergedSchema?.response.body ?? null),
    };

    const responseSignature = getResponseSchemaSignature(responseSchemaEntry);
    let responseRef = responseRefBySignature.get(responseSignature);
    if (!responseRef) {
      responseRef = buildResponseRef(responseCounter);
      responseCounter += 1;
      responseRefBySignature.set(responseSignature, responseRef);
      responses[responseRef] = responseSchemaEntry;
    }

    endpoints.push({
      method,
      url,
      apiType: classifyGroups([group]).graphql.length > 0 ? 'graphql' : 'rest',
      observations: group.entries.length,
      authHeaders,
      requestSchema: {
        headers: requestFields.length > 0 ? requestFields.map(serializeHeaderForBundle) : null,
        payload: serializePayloadForBundle(mergedSchema?.request.body ?? null),
      },
      responseRef,
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

  const exportMap = useCallback(async () => {
    if (!displayEntries.length) {
      return;
    }

    try {
      const payload = buildStructuredBundlePayload({
        groups,
        checkedEndpointKeys,
        mergedSchemaByKey,
      });
      if (!payload.endpointsFile.endpointCount) {
        return;
      }
      await downloadStructuredBundleZip(payload);
      setStatusOverride(null);
    } catch (error) {
      setStatusOverride(`Bundle export failed: ${error instanceof Error ? error.message : String(error)}`);
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
