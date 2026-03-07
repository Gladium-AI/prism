import type {
  BodySchema,
  HeaderField,
  HeaderLike,
  HeadersSchema,
  JsonSchema,
  ObjectSchema,
  PrimitiveSchemaType,
  SchemaInferenceEntry,
  SchemaObservation,
} from './types';

const AUTH_HEADER_NAMES = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
] as const;

const AUTH_HEADER_PREFIXES = ['x-auth-', 'x-api-'] as const;

const BEARER_RE = /^bearer\s+/i;

export function isAuthHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.length === 0) {
    return false;
  }

  if (AUTH_HEADER_NAMES.includes(lower as (typeof AUTH_HEADER_NAMES)[number])) {
    return true;
  }

  return AUTH_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export function hasBearerToken(value: string): boolean {
  return BEARER_RE.test(value);
}

export function classifyHeaderAuth(name: string, value: string): boolean {
  if (isAuthHeaderName(name)) {
    return true;
  }
  return hasBearerToken(value);
}

export function inferHeaderValueType(value: string): HeaderField['valueType'] {
  if (value.length === 0) {
    return 'empty';
  }

  if (/^\d+$/.test(value)) {
    return 'integer';
  }

  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
    return 'number';
  }

  if (value === 'true' || value === 'false') {
    return 'boolean';
  }

  return 'string';
}

export function inferHeadersSchema(headers: readonly HeaderLike[] | null | undefined): HeadersSchema {
  if (!Array.isArray(headers) || headers.length === 0) {
    return { fields: [] };
  }

  const fields: HeaderField[] = [];
  for (const header of headers) {
    if (!header || typeof header.name !== 'string') {
      continue;
    }

    const value = header.value == null ? '' : String(header.value);

    fields.push({
      name: header.name,
      valueType: inferHeaderValueType(value),
      isAuth: classifyHeaderAuth(header.name, value),
    });
  }

  return { fields };
}

function inferType(value: unknown): PrimitiveSchemaType | 'array' | 'object' {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  if (typeof value === 'object') {
    return 'object';
  }

  return typeof value;
}

export function inferJsonSchema(value: unknown): JsonSchema {
  const type = inferType(value);

  if (type === 'object') {
    return inferObjectSchema(value as Record<string, unknown>);
  }

  if (type === 'array') {
    return inferArraySchema(value as unknown[]);
  }

  return { type };
}

function inferObjectSchema(obj: Record<string, unknown>): ObjectSchema {
  const fields: Record<string, JsonSchema> = {};
  for (const key of Object.keys(obj)) {
    fields[key] = inferJsonSchema(obj[key]);
  }

  return { type: 'object', fields };
}

function inferArraySchema(arr: readonly unknown[]): JsonSchema {
  if (arr.length === 0) {
    return { type: 'array', items: null };
  }

  let itemSchema = inferJsonSchema(arr[0]);
  for (let index = 1; index < arr.length; index += 1) {
    itemSchema = unifySchemas(itemSchema, inferJsonSchema(arr[index]));
  }

  return {
    type: 'array',
    items: itemSchema,
  };
}

export function unifySchemas(a: JsonSchema, b: JsonSchema): JsonSchema {
  if (a.type !== b.type) {
    return { type: 'mixed', variants: collectTypes(a, b) };
  }

  if (a.type === 'object' && b.type === 'object') {
    return unifyObjectSchemas(a, b);
  }

  if (a.type === 'array' && b.type === 'array') {
    if (a.items === null) {
      return { type: 'array', items: b.items };
    }
    if (b.items === null) {
      return { type: 'array', items: a.items };
    }
    return { type: 'array', items: unifySchemas(a.items, b.items) };
  }

  return a;
}

function collectTypes(a: JsonSchema, b: JsonSchema): string[] {
  const types: string[] = [];

  if (a.type === 'mixed') {
    types.push(...a.variants);
  } else {
    types.push(a.type);
  }

  if (b.type === 'mixed') {
    types.push(...b.variants);
  } else {
    types.push(b.type);
  }

  return Array.from(new Set(types));
}

function unifyObjectSchemas(a: ObjectSchema, b: ObjectSchema): ObjectSchema {
  const merged: Record<string, JsonSchema> = {};
  const aFields = a.fields;
  const bFields = b.fields;

  for (const key of Object.keys(aFields)) {
    const left = aFields[key];
    const right = bFields[key];
    merged[key] = right ? unifySchemas(left, right) : markOptional(left);
  }

  for (const key of Object.keys(bFields)) {
    if (!(key in aFields)) {
      merged[key] = markOptional(bFields[key]);
    }
  }

  return { type: 'object', fields: merged };
}

function markOptional(schema: JsonSchema): JsonSchema {
  return { ...schema, optional: true };
}

function parseFormUrlEncoded(body: string): Record<string, unknown> | null {
  if (body.length === 0) {
    return null;
  }

  const pairs = body.split('&');
  const result: Record<string, unknown> = {};

  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    const key = decodeURIComponentSafe(eq === -1 ? pair : pair.slice(0, eq));
    const value = decodeURIComponentSafe(eq === -1 ? '' : pair.slice(eq + 1));

    if (key.length > 0) {
      result[key] = coerceFormValue(value);
    }
  }

  return result;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function coerceFormValue(value: string): string | number | boolean | null {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (value === 'null') {
    return null;
  }
  if (/^-?\d+$/.test(value) && value.length < 16) {
    const asInt = Number(value);
    if (Number.isFinite(asInt)) {
      return asInt;
    }
  }
  if (/^-?\d+\.\d+$/.test(value) && value.length < 20) {
    const asFloat = Number(value);
    if (Number.isFinite(asFloat)) {
      return asFloat;
    }
  }
  return value;
}

function isJsonContentType(contentType: string | null | undefined): boolean {
  if (typeof contentType !== 'string') {
    return false;
  }

  const lower = contentType.toLowerCase();
  return lower.includes('json') || lower.includes('graphql');
}

function isFormContentType(contentType: string | null | undefined): boolean {
  if (typeof contentType !== 'string') {
    return false;
  }

  return contentType.toLowerCase().includes('x-www-form-urlencoded');
}

function detectBodyContentType(
  body: string,
  contentType: string | null | undefined,
): 'json' | 'form' | 'unknown' {
  if (isJsonContentType(contentType)) {
    return 'json';
  }
  if (isFormContentType(contentType)) {
    return 'form';
  }

  if (body.length > 0) {
    const trimmed = body.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return 'json';
    }
    if (trimmed.includes('=') && !trimmed.includes('<')) {
      return 'form';
    }
  }

  return 'unknown';
}

export function inferBodySchema(
  body: string | null | undefined,
  contentType: string | null | undefined,
): BodySchema | null {
  if (typeof body !== 'string' || body.trim().length === 0) {
    return null;
  }

  const detectedType = detectBodyContentType(body, contentType);

  if (detectedType === 'json') {
    try {
      const parsed = JSON.parse(body) as unknown;
      return { contentType: 'json', schema: inferJsonSchema(parsed) };
    } catch (error) {
      const parseError = error instanceof Error ? error.message : String(error);
      return { contentType: 'json', parseError, schema: null };
    }
  }

  if (detectedType === 'form') {
    const formData = parseFormUrlEncoded(body);
    if (formData && Object.keys(formData).length > 0) {
      return { contentType: 'form', schema: inferJsonSchema(formData) };
    }
    return null;
  }

  return { contentType: 'opaque', schema: null };
}

function getContentTypeFromHeaders(headers: readonly HeaderLike[] | null | undefined): string | null {
  if (!Array.isArray(headers)) {
    return null;
  }

  for (const header of headers) {
    if (header && header.name.toLowerCase() === 'content-type') {
      return typeof header.value === 'string' ? header.value : null;
    }
  }

  return null;
}

export function inferSchema(entry: SchemaInferenceEntry | null | undefined): SchemaObservation | null {
  if (!entry) {
    return null;
  }

  const request = entry.request ?? {};
  const response = entry.response ?? {};

  const requestContentType = getContentTypeFromHeaders(request.headers) ?? response.contentType ?? null;
  const responseContentType =
    getContentTypeFromHeaders(response.headers) ?? response.contentType ?? null;

  return {
    request: {
      headers: inferHeadersSchema(request.headers),
      body: inferBodySchema(request.body, requestContentType),
    },
    response: {
      headers: inferHeadersSchema(response.headers),
      body: inferBodySchema(response.body, responseContentType),
    },
  };
}
