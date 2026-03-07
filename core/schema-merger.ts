import type {
  BodySchema,
  EndpointGroup,
  HeaderField,
  HeadersSchema,
  MergedEndpointSchema,
  SchemaInferenceEntry,
  SchemaObservation,
} from './types';
import { inferSchema, unifySchemas } from './schema-inferrer';

export function mergeHeadersSchemas(schemaList: readonly HeadersSchema[]): HeadersSchema {
  const fieldMap: Record<
    string,
    {
      name: string;
      valueTypes: Set<string>;
      isAuth: boolean;
      seenCount: number;
    }
  > = Object.create(null) as Record<
    string,
    {
      name: string;
      valueTypes: Set<string>;
      isAuth: boolean;
      seenCount: number;
    }
  >;
  const fieldOrder: string[] = [];
  const totalObservations = schemaList.length;

  for (const headerSchema of schemaList) {
    if (!headerSchema || !Array.isArray(headerSchema.fields)) {
      continue;
    }

    for (const field of headerSchema.fields) {
      if (!field || typeof field.name !== 'string') {
        continue;
      }

      const lowerName = field.name.toLowerCase();
      if (!(lowerName in fieldMap)) {
        fieldMap[lowerName] = {
          name: field.name,
          valueTypes: new Set<string>(),
          isAuth: false,
          seenCount: 0,
        };
        fieldOrder.push(lowerName);
      }

      const entry = fieldMap[lowerName];
      entry.seenCount += 1;

      if (field.valueType) {
        entry.valueTypes.add(field.valueType);
      }

      if (field.isAuth) {
        entry.isAuth = true;
      }
    }
  }

  const mergedFields: HeaderField[] = [];
  for (const key of fieldOrder) {
    const merged = fieldMap[key];
    const typeKeys = Array.from(merged.valueTypes);
    const valueType =
      typeKeys.length === 1 ? typeKeys[0] : typeKeys.length > 1 ? typeKeys.join(' | ') : 'unknown';

    mergedFields.push({
      name: merged.name,
      valueType,
      isAuth: merged.isAuth,
      optional: merged.seenCount < totalObservations,
      seenCount: merged.seenCount,
    });
  }

  return { fields: mergedFields };
}

export function mergeBodySchemas(bodyList: readonly (BodySchema | null | undefined)[]): BodySchema | null {
  const nonNull = bodyList.filter((body): body is BodySchema => body != null);
  if (nonNull.length === 0) {
    return null;
  }

  let contentType = nonNull[0].contentType;
  let mergedSchema = nonNull[0].schema;

  for (let index = 1; index < nonNull.length; index += 1) {
    const current = nonNull[index];

    if (current.contentType !== contentType) {
      contentType = 'mixed';
    }

    if (current.schema !== null) {
      if (mergedSchema === null) {
        mergedSchema = current.schema;
      } else {
        mergedSchema = unifySchemas(mergedSchema, current.schema);
      }
    }
  }

  return {
    contentType,
    schema: mergedSchema,
  };
}

export function mergeFullSchemas(
  schemaList: readonly (SchemaObservation | null | undefined)[],
): SchemaObservation {
  const requestHeaders: (HeadersSchema | null)[] = [];
  const requestBodies: (BodySchema | null)[] = [];
  const responseHeaders: (HeadersSchema | null)[] = [];
  const responseBodies: (BodySchema | null)[] = [];

  for (const schema of schemaList) {
    if (!schema) {
      continue;
    }

    requestHeaders.push(schema.request.headers ?? null);
    requestBodies.push(schema.request.body ?? null);
    responseHeaders.push(schema.response.headers ?? null);
    responseBodies.push(schema.response.body ?? null);
  }

  const validRequestHeaders = requestHeaders.filter(
    (headers): headers is HeadersSchema => headers != null,
  );
  const validResponseHeaders = responseHeaders.filter(
    (headers): headers is HeadersSchema => headers != null,
  );

  return {
    request: {
      headers:
        validRequestHeaders.length > 0 ? mergeHeadersSchemas(validRequestHeaders) : { fields: [] },
      body: mergeBodySchemas(requestBodies),
    },
    response: {
      headers:
        validResponseHeaders.length > 0 ? mergeHeadersSchemas(validResponseHeaders) : { fields: [] },
      body: mergeBodySchemas(responseBodies),
    },
  };
}

export function mergeEndpointGroup<TEntry extends SchemaInferenceEntry>(
  group: EndpointGroup<TEntry> | null | undefined,
): MergedEndpointSchema | null {
  const entries = group?.entries ?? [];
  if (entries.length === 0) {
    return null;
  }

  const schemas = entries
    .map((entry) => inferSchema(entry))
    .filter((schema): schema is SchemaObservation => schema != null);
  if (schemas.length === 0) {
    return null;
  }

  return {
    endpointKey: group?.endpointKey ?? null,
    normalizedUrl: group?.normalizedUrl ?? null,
    method: group?.method ?? null,
    observationCount: entries.length,
    schema: mergeFullSchemas(schemas),
  };
}

export function mergeAllEndpoints<TEntry extends SchemaInferenceEntry>(
  endpointGroups: readonly EndpointGroup<TEntry>[],
): MergedEndpointSchema[] {
  return endpointGroups
    .map((group) => mergeEndpointGroup(group))
    .filter((merged): merged is MergedEndpointSchema => merged != null);
}
