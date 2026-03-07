import { inferHeaderValueType, inferSchema } from './schema-inferrer';
import { mergeFullSchemas } from './schema-merger';
import type {
  BodySchema,
  EndpointGroup,
  HeaderField,
  RecordedNetworkEntry,
  SchemaObservation,
} from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STANDARD_HEADER_NAMES = new Set<string>([
  'accept',
  'accept-charset',
  'accept-encoding',
  'accept-language',
  'accept-patch',
  'accept-ranges',
  'access-control-request-headers',
  'access-control-request-method',
  'authorization',
  'cache-control',
  'connection',
  'content-disposition',
  'content-encoding',
  'content-language',
  'content-length',
  'content-location',
  'content-range',
  'content-type',
  'cookie',
  'date',
  'etag',
  'expect',
  'expires',
  'forwarded',
  'host',
  'if-match',
  'if-modified-since',
  'if-none-match',
  'if-range',
  'if-unmodified-since',
  'last-modified',
  'location',
  'origin',
  'pragma',
  'proxy-authorization',
  'range',
  'referer',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'sec-fetch-user',
  'server',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'upgrade-insecure-requests',
  'user-agent',
  'vary',
  'via',
  'warning',
  'www-authenticate',
]);

export type RestValueType =
  | 'unknown'
  | 'empty'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'string'
  | 'uuid'
  | 'mixed';

export interface RestPathParameter {
  name: string;
  placeholder: string;
  type: RestValueType;
  role: string;
  optional?: boolean;
  seenCount: number;
}

export interface RestQueryParameter {
  name: string;
  type: RestValueType;
  optional?: boolean;
  seenCount: number;
}

export interface RestStatusSchema {
  statusCode: number | null;
  statusLabel: string;
  observationCount: number;
  response: SchemaObservation['response'];
}

export interface MergedRestEndpoint {
  endpointKey: string;
  method: string;
  normalizedUrl: string | null;
  observationCount: number;
  pathTemplate: string | null;
  pathParameters: RestPathParameter[];
  queryParameters: RestQueryParameter[];
  statusCodes: string[];
  statusSchemas: RestStatusSchema[];
  requestBody: BodySchema | null;
  requestHeaders: {
    custom: HeaderField[];
    standard: HeaderField[];
  };
}

function getUrlInstance(url: string | null | undefined): URL | null {
  if (typeof url !== 'string' || url.length === 0) {
    return null;
  }

  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function getPathTemplate(normalizedUrl: string | null): string | null {
  const parsed = getUrlInstance(normalizedUrl);
  return parsed?.pathname ?? null;
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function inferRestValueType(values: readonly string[]): RestValueType {
  if (!values.length) {
    return 'unknown';
  }

  const types = new Set<RestValueType>();
  for (const rawValue of values) {
    if (UUID_RE.test(rawValue)) {
      types.add('uuid');
      continue;
    }

    const primitiveType = inferHeaderValueType(rawValue);
    if (
      primitiveType === 'empty' ||
      primitiveType === 'integer' ||
      primitiveType === 'number' ||
      primitiveType === 'boolean' ||
      primitiveType === 'string'
    ) {
      types.add(primitiveType);
    } else {
      types.add('unknown');
    }
  }

  return types.size === 1 ? [...types][0] : 'mixed';
}

function inferPathParamRole(parameterName: string): string {
  const lower = parameterName.toLowerCase();
  if (lower === 'id' || lower.endsWith('id') || lower.includes('uuid')) {
    return 'unique identifier';
  }
  if (lower.includes('slug')) {
    return 'slug';
  }
  return 'path segment';
}

function getUniqueParamName(baseName: string, existingNames: Set<string>): string {
  if (!existingNames.has(baseName)) {
    existingNames.add(baseName);
    return baseName;
  }

  let index = 2;
  while (existingNames.has(`${baseName}${index}`)) {
    index += 1;
  }

  const candidate = `${baseName}${index}`;
  existingNames.add(candidate);
  return candidate;
}

function buildPathParameters(group: EndpointGroup<RecordedNetworkEntry>): {
  pathTemplate: string | null;
  pathParameters: RestPathParameter[];
} {
  const pathTemplate = getPathTemplate(group.normalizedUrl);
  if (!pathTemplate) {
    return { pathTemplate: null, pathParameters: [] };
  }

  const templateSegments = pathTemplate.split('/');
  const totalObservations = group.entries.length;
  const pathParameters: RestPathParameter[] = [];
  const takenNames = new Set<string>();

  for (let segmentIndex = 0; segmentIndex < templateSegments.length; segmentIndex += 1) {
    const templateSegment = templateSegments[segmentIndex];
    if (!templateSegment.startsWith(':')) {
      continue;
    }

    const rawName = templateSegment.slice(1) || `param${segmentIndex}`;
    const name = getUniqueParamName(rawName, takenNames);
    const values: string[] = [];

    for (const entry of group.entries) {
      const parsed = getUrlInstance(entry.request?.url ?? null);
      const segments = parsed?.pathname.split('/') ?? [];
      if (segmentIndex >= segments.length) {
        continue;
      }
      values.push(decodePathSegment(segments[segmentIndex]));
    }

    const seenCount = values.length;
    pathParameters.push({
      name,
      placeholder: templateSegment,
      type: inferRestValueType(values),
      role: inferPathParamRole(name),
      ...(seenCount < totalObservations ? { optional: true } : {}),
      seenCount,
    });
  }

  return { pathTemplate, pathParameters };
}

function buildQueryParameters(group: EndpointGroup<RecordedNetworkEntry>): RestQueryParameter[] {
  const totalObservations = group.entries.length;
  const parameterMap = new Map<
    string,
    {
      seenCount: number;
      values: string[];
    }
  >();

  for (const entry of group.entries) {
    const parsed = getUrlInstance(entry.request?.url ?? null);
    if (!parsed) {
      continue;
    }

    const seenInEntry = new Set<string>();
    for (const [name, value] of parsed.searchParams.entries()) {
      if (!parameterMap.has(name)) {
        parameterMap.set(name, {
          seenCount: 0,
          values: [],
        });
      }

      const target = parameterMap.get(name)!;
      target.values.push(value);
      if (!seenInEntry.has(name)) {
        target.seenCount += 1;
        seenInEntry.add(name);
      }
    }
  }

  return [...parameterMap.entries()]
    .map(([name, value]) => ({
      name,
      type: inferRestValueType(value.values),
      ...(value.seenCount < totalObservations ? { optional: true } : {}),
      seenCount: value.seenCount,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function isStandardHeaderName(name: string): boolean {
  const lowerName = name.toLowerCase();
  if (lowerName.startsWith(':')) {
    return true;
  }

  if (
    lowerName.startsWith('sec-') ||
    lowerName.startsWith('accept-') ||
    lowerName.startsWith('content-')
  ) {
    return true;
  }

  return STANDARD_HEADER_NAMES.has(lowerName);
}

function partitionHeaders(fields: readonly HeaderField[]): {
  custom: HeaderField[];
  standard: HeaderField[];
} {
  const custom: HeaderField[] = [];
  const standard: HeaderField[] = [];

  for (const field of fields) {
    if (isStandardHeaderName(field.name)) {
      standard.push(field);
    } else {
      custom.push(field);
    }
  }

  return { custom, standard };
}

function buildStatusSchemas(group: EndpointGroup<RecordedNetworkEntry>): RestStatusSchema[] {
  const entriesByStatusLabel = new Map<string, RecordedNetworkEntry[]>();
  const statusCodeByLabel = new Map<string, number | null>();

  for (const entry of group.entries) {
    const statusCode = typeof entry.response?.status === 'number' ? entry.response.status : null;
    const statusLabel = statusCode === null ? 'unknown' : String(statusCode);

    if (!entriesByStatusLabel.has(statusLabel)) {
      entriesByStatusLabel.set(statusLabel, []);
      statusCodeByLabel.set(statusLabel, statusCode);
    }
    entriesByStatusLabel.get(statusLabel)!.push(entry);
  }

  const statusSchemas: RestStatusSchema[] = [];

  for (const [statusLabel, entriesForStatus] of entriesByStatusLabel.entries()) {
    const schemaObservations = entriesForStatus
      .map((entry) => inferSchema(entry))
      .filter((schema): schema is SchemaObservation => schema != null);
    if (!schemaObservations.length) {
      continue;
    }

    const merged = mergeFullSchemas(schemaObservations);
    statusSchemas.push({
      statusCode: statusCodeByLabel.get(statusLabel) ?? null,
      statusLabel,
      observationCount: entriesForStatus.length,
      response: merged.response,
    });
  }

  return statusSchemas.sort((left, right) => {
    if (left.statusCode == null && right.statusCode == null) {
      return 0;
    }
    if (left.statusCode == null) {
      return 1;
    }
    if (right.statusCode == null) {
      return -1;
    }
    return left.statusCode - right.statusCode;
  });
}

export function mergeRestEndpointGroup(
  group: EndpointGroup<RecordedNetworkEntry> | null | undefined,
): MergedRestEndpoint | null {
  if (!group || !group.entries.length) {
    return null;
  }

  const requestSchemas = group.entries
    .map((entry) => inferSchema(entry))
    .filter((schema): schema is SchemaObservation => schema != null);

  const mergedRequest = requestSchemas.length > 0 ? mergeFullSchemas(requestSchemas).request : null;
  const requestHeaders = partitionHeaders(mergedRequest?.headers.fields ?? []);
  const { pathTemplate, pathParameters } = buildPathParameters(group);
  const queryParameters = buildQueryParameters(group);
  const statusSchemas = buildStatusSchemas(group);

  return {
    endpointKey: group.endpointKey,
    method: group.method,
    normalizedUrl: group.normalizedUrl,
    observationCount: group.entries.length,
    pathTemplate,
    pathParameters,
    queryParameters,
    statusCodes: statusSchemas.map((schema) => schema.statusLabel),
    statusSchemas,
    requestBody: mergedRequest?.body ?? null,
    requestHeaders,
  };
}
