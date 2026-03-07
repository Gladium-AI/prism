import { Kind, parse } from 'graphql';
import type { FragmentDefinitionNode, OperationDefinitionNode, SelectionSetNode } from 'graphql';
import { inferJsonSchema, unifySchemas } from './schema-inferrer';
import type { EndpointEntryLike, JsonSchema, RequestLike } from './types';

export type GraphQLOperationType = 'query' | 'mutation' | 'subscription';

export interface GraphQLSelectionField {
  name: string;
  optional?: boolean;
  seenCount?: number;
  fields?: GraphQLSelectionField[];
}

export interface GraphQLOperationObservation {
  operationType: GraphQLOperationType | 'unknown';
  operationName: string | null;
  operationKey: string;
  variablesSchema: JsonSchema | null;
  selectionSet: GraphQLSelectionField[] | null;
  rawQuery: string | null;
}

export interface MergedGraphQLOperation {
  operationType: GraphQLOperationType | 'unknown';
  operationName: string | null;
  operationKey: string;
  variablesSchema: JsonSchema | null;
  selectionSet: GraphQLSelectionField[] | null;
  rawQueries: string[];
  observationCount: number;
}

interface GraphQLRequestPayload {
  query: string | null;
  operationName: string | null;
  variablesValue: unknown;
  hasVariables: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseJsonSafely(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function parseVariablesValue(value: unknown): { hasVariables: boolean; variablesValue: unknown } {
  if (value === undefined || value === null) {
    return { hasVariables: false, variablesValue: null };
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return { hasVariables: true, variablesValue: {} };
    }
    const parsed = parseJsonSafely(trimmed);
    if (parsed !== undefined) {
      return { hasVariables: true, variablesValue: parsed };
    }
    return { hasVariables: true, variablesValue: value };
  }

  return { hasVariables: true, variablesValue: value };
}

function payloadFromRecord(record: Record<string, unknown>): GraphQLRequestPayload {
  const query = normalizeString(record.query);
  const operationName = normalizeString(record.operationName);
  const variables = parseVariablesValue(record.variables);

  return {
    query,
    operationName,
    variablesValue: variables.variablesValue,
    hasVariables: variables.hasVariables,
  };
}

function payloadFromBody(body: string): GraphQLRequestPayload {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return {
      query: null,
      operationName: null,
      variablesValue: null,
      hasVariables: false,
    };
  }

  const parsed = parseJsonSafely(trimmed);
  if (parsed !== undefined) {
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const record = asRecord(item);
        if (record) {
          return payloadFromRecord(record);
        }
      }
      return {
        query: null,
        operationName: null,
        variablesValue: null,
        hasVariables: false,
      };
    }

    const record = asRecord(parsed);
    if (record) {
      return payloadFromRecord(record);
    }
  }

  const bodyParams = new URLSearchParams(trimmed);
  if (bodyParams.has('query') || bodyParams.has('operationName') || bodyParams.has('variables')) {
    const variables = parseVariablesValue(bodyParams.get('variables'));
    return {
      query: normalizeString(bodyParams.get('query')),
      operationName: normalizeString(bodyParams.get('operationName')),
      variablesValue: variables.variablesValue,
      hasVariables: variables.hasVariables,
    };
  }

  return {
    query: trimmed,
    operationName: null,
    variablesValue: null,
    hasVariables: false,
  };
}

function payloadFromUrl(url: string | null | undefined): GraphQLRequestPayload {
  if (typeof url !== 'string' || url.length === 0) {
    return {
      query: null,
      operationName: null,
      variablesValue: null,
      hasVariables: false,
    };
  }

  try {
    const parsed = new URL(url);
    const variables = parseVariablesValue(parsed.searchParams.get('variables'));
    return {
      query: normalizeString(parsed.searchParams.get('query')),
      operationName: normalizeString(parsed.searchParams.get('operationName')),
      variablesValue: variables.variablesValue,
      hasVariables: variables.hasVariables,
    };
  } catch {
    return {
      query: null,
      operationName: null,
      variablesValue: null,
      hasVariables: false,
    };
  }
}

function isGraphQLPath(url: string | null | undefined): boolean {
  if (typeof url !== 'string' || url.length === 0) {
    return false;
  }

  try {
    return new URL(url).pathname.toLowerCase().includes('/graphql');
  } catch {
    return url.toLowerCase().includes('/graphql');
  }
}

function combinePayload(primary: GraphQLRequestPayload, secondary: GraphQLRequestPayload): GraphQLRequestPayload {
  return {
    query: primary.query ?? secondary.query,
    operationName: primary.operationName ?? secondary.operationName,
    hasVariables: primary.hasVariables || secondary.hasVariables,
    variablesValue: primary.hasVariables ? primary.variablesValue : secondary.variablesValue,
  };
}

function getPayloadFromRequest(request: RequestLike): GraphQLRequestPayload {
  const bodyPayload =
    typeof request.body === 'string'
      ? payloadFromBody(request.body)
      : {
          query: null,
          operationName: null,
          variablesValue: null,
          hasVariables: false,
        };
  const urlPayload = payloadFromUrl(request.url);
  return combinePayload(bodyPayload, urlPayload);
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function normalizeOperationName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed === ':id') {
    return null;
  }

  return trimmed;
}

function looksLikePersistedQueryId(segment: string): boolean {
  return /^[A-Za-z0-9_-]{12,}$/.test(segment);
}

function extractOperationNameFromUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || url.length === 0) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const segments = parsed.pathname
      .split('/')
      .filter((segment) => segment.length > 0)
      .map((segment) => decodePathSegment(segment));
    const graphqlIndex = segments.findIndex((segment) => segment.toLowerCase() === 'graphql');

    if (graphqlIndex === -1) {
      return null;
    }

    const tail = segments.slice(graphqlIndex + 1);
    if (tail.length === 0) {
      return null;
    }

    let candidate: string | null = null;

    if (tail.length >= 2 && looksLikePersistedQueryId(tail[0])) {
      candidate = tail[1];
    } else if (!looksLikePersistedQueryId(tail[0])) {
      candidate = tail[0];
    } else if (tail.length >= 2) {
      candidate = tail[1];
    }

    return normalizeOperationName(candidate);
  } catch {
    return null;
  }
}

function looksLikeGraphQLQuery(query: string | null): boolean {
  if (!query) {
    return false;
  }

  const trimmed = query.trimStart();
  if (trimmed.length === 0) {
    return false;
  }

  if (trimmed.startsWith('{')) {
    return true;
  }

  return /^(query|mutation|subscription|fragment)\b/i.test(trimmed);
}

function hasGraphQLSignal(payload: GraphQLRequestPayload, url: string | null | undefined): boolean {
  if (isGraphQLPath(url)) {
    return true;
  }

  if (payload.operationName !== null) {
    return true;
  }

  return looksLikeGraphQLQuery(payload.query);
}

function inferOperationTypeFromMethod(method: string | null | undefined): GraphQLOperationType | 'unknown' {
  if (typeof method !== 'string') {
    return 'unknown';
  }

  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === 'GET') {
    return 'query';
  }

  return 'unknown';
}

interface MutableSelectionField {
  name: string;
  fields: Map<string, MutableSelectionField>;
}

function collectSelectionSet(
  selectionSet: SelectionSetNode,
  fragmentsByName: Map<string, FragmentDefinitionNode>,
  target: Map<string, MutableSelectionField>,
  visitedFragments: Set<string>,
): void {
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      const fieldName = selection.alias?.value ?? selection.name.value;
      let node = target.get(fieldName);
      if (!node) {
        node = { name: fieldName, fields: new Map<string, MutableSelectionField>() };
        target.set(fieldName, node);
      }

      if (selection.selectionSet) {
        collectSelectionSet(selection.selectionSet, fragmentsByName, node.fields, visitedFragments);
      }
      continue;
    }

    if (selection.kind === Kind.INLINE_FRAGMENT) {
      collectSelectionSet(selection.selectionSet, fragmentsByName, target, visitedFragments);
      continue;
    }

    if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const fragmentName = selection.name.value;
      if (visitedFragments.has(fragmentName)) {
        continue;
      }

      const fragment = fragmentsByName.get(fragmentName);
      if (!fragment) {
        continue;
      }

      const nextVisited = new Set(visitedFragments);
      nextVisited.add(fragmentName);
      collectSelectionSet(fragment.selectionSet, fragmentsByName, target, nextVisited);
    }
  }
}

function toSelectionFields(fields: Map<string, MutableSelectionField>): GraphQLSelectionField[] {
  const result: GraphQLSelectionField[] = [];

  for (const field of fields.values()) {
    const nested = toSelectionFields(field.fields);
    result.push(
      nested.length > 0
        ? {
            name: field.name,
            fields: nested,
          }
        : {
            name: field.name,
          },
    );
  }

  return result;
}

function inferOperationTypeFromQuery(query: string | null): GraphQLOperationType | 'unknown' {
  if (!query) {
    return 'unknown';
  }

  const trimmed = query.trimStart();
  if (trimmed.startsWith('{')) {
    return 'query';
  }

  const match = trimmed.match(/^(query|mutation|subscription)\b/i);
  if (!match) {
    return 'unknown';
  }

  const keyword = match[1].toLowerCase();
  if (keyword === 'query' || keyword === 'mutation' || keyword === 'subscription') {
    return keyword;
  }

  return 'unknown';
}

function selectOperationDefinition(
  operations: readonly OperationDefinitionNode[],
  operationName: string | null,
): OperationDefinitionNode | null {
  if (operations.length === 0) {
    return null;
  }

  if (operationName) {
    const namedMatch = operations.find((operation) => operation.name?.value === operationName);
    if (namedMatch) {
      return namedMatch;
    }
  }

  if (operations.length === 1) {
    return operations[0];
  }

  const firstNamed = operations.find((operation) => operation.name?.value);
  return firstNamed ?? operations[0];
}

function parseSelectionSetFromQuery(query: string, operationName: string | null): {
  operationType: GraphQLOperationType | 'unknown';
  operationName: string | null;
  selectionSet: GraphQLSelectionField[] | null;
} {
  const document = parse(query);
  const fragmentsByName = new Map<string, FragmentDefinitionNode>();
  const operations: OperationDefinitionNode[] = [];

  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      fragmentsByName.set(definition.name.value, definition);
      continue;
    }
    if (definition.kind === Kind.OPERATION_DEFINITION) {
      operations.push(definition);
    }
  }

  const selectedOperation = selectOperationDefinition(operations, operationName);
  if (!selectedOperation) {
    return {
      operationType: inferOperationTypeFromQuery(query),
      operationName,
      selectionSet: null,
    };
  }

  const fields = new Map<string, MutableSelectionField>();
  collectSelectionSet(selectedOperation.selectionSet, fragmentsByName, fields, new Set<string>());

  return {
    operationType: selectedOperation.operation,
    operationName: selectedOperation.name?.value ?? operationName,
    selectionSet: toSelectionFields(fields),
  };
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function buildOperationKey(args: {
  operationName: string | null;
  operationType: GraphQLOperationType | 'unknown';
  query: string | null;
  url: string | null | undefined;
}): string {
  if (args.operationName) {
    return args.operationName;
  }

  const typeLabel =
    args.operationType === 'unknown'
      ? 'Operation'
      : `${args.operationType.slice(0, 1).toUpperCase()}${args.operationType.slice(1)}`;
  const hashSource = args.query ?? args.url ?? '';
  return `Anonymous${typeLabel}#${hashString(hashSource)}`;
}

export function parseGraphQLOperation(
  request: RequestLike | null | undefined,
): GraphQLOperationObservation | null {
  if (!request) {
    return null;
  }

  const payload = getPayloadFromRequest(request);
  if (!hasGraphQLSignal(payload, request.url)) {
    return null;
  }

  let operationType: GraphQLOperationType | 'unknown' = 'unknown';
  let operationName = payload.operationName ?? extractOperationNameFromUrl(request.url);
  let selectionSet: GraphQLSelectionField[] | null = null;

  if (payload.query) {
    try {
      const parsed = parseSelectionSetFromQuery(payload.query, operationName);
      operationType = parsed.operationType;
      operationName = parsed.operationName;
      selectionSet = parsed.selectionSet;
    } catch {
      operationType = inferOperationTypeFromQuery(payload.query);
    }
  } else {
    operationType = inferOperationTypeFromMethod(request.method);
  }

  operationName = operationName ?? extractOperationNameFromUrl(request.url);

  const variablesSchema = payload.hasVariables ? inferJsonSchema(payload.variablesValue) : null;
  const operationKey = buildOperationKey({
    operationName,
    operationType,
    query: payload.query,
    url: request.url,
  });

  return {
    operationType,
    operationName,
    operationKey,
    variablesSchema,
    selectionSet,
    rawQuery: payload.query,
  };
}

export function isGraphQLRequest(request: RequestLike | null | undefined): boolean {
  if (!request) {
    return false;
  }

  const payload = getPayloadFromRequest(request);
  return hasGraphQLSignal(payload, request.url);
}

interface MergedSelectionField {
  name: string;
  seenCount: number;
  fields: Map<string, MergedSelectionField>;
}

function mergeObservedSelectionFields(
  target: Map<string, MergedSelectionField>,
  source: readonly GraphQLSelectionField[],
): void {
  for (const field of source) {
    const fieldName = field.name;
    let targetField = target.get(fieldName);
    if (!targetField) {
      targetField = {
        name: fieldName,
        seenCount: 0,
        fields: new Map<string, MergedSelectionField>(),
      };
      target.set(fieldName, targetField);
    }

    targetField.seenCount += 1;

    if (Array.isArray(field.fields) && field.fields.length > 0) {
      mergeObservedSelectionFields(targetField.fields, field.fields);
    }
  }
}

function finalizeMergedSelectionFields(
  fields: Map<string, MergedSelectionField>,
  totalObservations: number,
): GraphQLSelectionField[] {
  const result: GraphQLSelectionField[] = [];

  for (const field of fields.values()) {
    const nested = finalizeMergedSelectionFields(field.fields, field.seenCount);
    result.push(
      nested.length > 0
        ? {
            name: field.name,
            ...(field.seenCount < totalObservations ? { optional: true } : {}),
            seenCount: field.seenCount,
            fields: nested,
          }
        : {
            name: field.name,
            ...(field.seenCount < totalObservations ? { optional: true } : {}),
            seenCount: field.seenCount,
          },
    );
  }

  return result;
}

function mergeSelectionSetSchemas(
  selectionSets: readonly (GraphQLSelectionField[] | null)[],
): GraphQLSelectionField[] | null {
  const nonEmptySelectionSets = selectionSets.filter(
    (selectionSet): selectionSet is GraphQLSelectionField[] => Array.isArray(selectionSet) && selectionSet.length > 0,
  );
  if (nonEmptySelectionSets.length === 0) {
    return null;
  }

  const mergedRoot = new Map<string, MergedSelectionField>();
  for (const selectionSet of nonEmptySelectionSets) {
    mergeObservedSelectionFields(mergedRoot, selectionSet);
  }

  return finalizeMergedSelectionFields(mergedRoot, nonEmptySelectionSets.length);
}

function mergeVariablesSchemas(
  variablesSchemas: readonly (JsonSchema | null)[],
): JsonSchema | null {
  const nonNullSchemas = variablesSchemas.filter((schema): schema is JsonSchema => schema != null);
  if (nonNullSchemas.length === 0) {
    return null;
  }

  let merged = nonNullSchemas[0];
  for (let index = 1; index < nonNullSchemas.length; index += 1) {
    merged = unifySchemas(merged, nonNullSchemas[index]);
  }

  return merged;
}

function mergeOperationTypes(
  operationTypes: readonly (GraphQLOperationType | 'unknown')[],
): GraphQLOperationType | 'unknown' {
  const counts = new Map<GraphQLOperationType | 'unknown', number>();
  for (const operationType of operationTypes) {
    counts.set(operationType, (counts.get(operationType) ?? 0) + 1);
  }

  let bestType: GraphQLOperationType | 'unknown' = 'unknown';
  let bestCount = -1;
  for (const [operationType, count] of counts.entries()) {
    if (count > bestCount) {
      bestType = operationType;
      bestCount = count;
    }
  }

  return bestType;
}

export function mergeGraphQLOperations(
  observations: readonly GraphQLOperationObservation[],
): MergedGraphQLOperation | null {
  if (observations.length === 0) {
    return null;
  }

  const operationKey = observations[0].operationKey;
  const operationName =
    observations.map((entry) => entry.operationName).find((name): name is string => typeof name === 'string') ??
    null;
  const operationType = mergeOperationTypes(observations.map((entry) => entry.operationType));
  const variablesSchema = mergeVariablesSchemas(observations.map((entry) => entry.variablesSchema));
  const selectionSet = mergeSelectionSetSchemas(observations.map((entry) => entry.selectionSet));
  const rawQueries = Array.from(
    new Set(
      observations
        .map((entry) => (typeof entry.rawQuery === 'string' ? entry.rawQuery : null))
        .filter((query): query is string => query != null),
    ),
  );

  return {
    operationType,
    operationName,
    operationKey,
    variablesSchema,
    selectionSet,
    rawQueries,
    observationCount: observations.length,
  };
}

export function mergeGraphQLOperationsFromEntries<TEntry extends EndpointEntryLike>(
  entries: readonly TEntry[],
): MergedGraphQLOperation | null {
  const observations = entries
    .map((entry) => parseGraphQLOperation(entry.request))
    .filter((entry): entry is GraphQLOperationObservation => entry != null);

  return mergeGraphQLOperations(observations);
}
