import { streamObject } from 'ai';
import { z } from 'zod';
import {
  getAPIKeyForProvider,
  getProviderLabel,
  getProviderModelId,
  type AIEnrichmentSettings,
} from './ai-settings';

export interface AIProgressUpdate {
  completed: number;
  total: number;
}

export interface EndpointForAIEnrichment {
  endpointKey: string;
  method: string;
  url: string;
  apiType: 'graphql' | 'rest';
  observations: number;
  authHeaders: Array<{
    name: string;
    type: string;
  }>;
  requestSchema: unknown;
  responseSchema: unknown;
}

export interface ResponseFieldAnnotation {
  fieldPath: string;
  meaning: string;
}

export interface EndpointAIEnrichment {
  description: string;
  authExplanation: string;
  semanticGroup: string;
  responseFieldAnnotations: ResponseFieldAnnotation[];
}

export interface AIEnrichmentBatchResult {
  capabilitiesSummary: string;
  endpointEnrichmentByKey: Record<string, EndpointAIEnrichment>;
}

const responseFieldAnnotationSchema = z
  .object({
    fieldPath: z.preprocess((value) => (typeof value === 'string' ? value : String(value ?? '')), z.string()),
    meaning: z.preprocess((value) => (typeof value === 'string' ? value : String(value ?? '')), z.string()),
  })
  .strict();

const endpointEnrichmentSchema = z
  .object({
    endpointKey: z.preprocess((value) => (typeof value === 'string' ? value : String(value ?? '')), z.string()),
    description: z.preprocess((value) => (typeof value === 'string' ? value : String(value ?? '')), z.string()),
    authExplanation: z.preprocess((value) => (typeof value === 'string' ? value : String(value ?? '')), z.string()),
    semanticGroup: z.preprocess((value) => (typeof value === 'string' ? value : String(value ?? '')), z.string()),
    responseFieldAnnotations: z.preprocess(
      (value) => (Array.isArray(value) ? value : []),
      z.array(responseFieldAnnotationSchema),
    ),
  })
  .strict();

const enrichmentBatchSchema = z
  .object({
    capabilitiesSummary: z.preprocess((value) => (typeof value === 'string' ? value : String(value ?? '')), z.string()),
    endpointEnrichments: z.preprocess(
      (value) => (Array.isArray(value) ? value : []),
      z.array(endpointEnrichmentSchema),
    ),
  })
  .strict();

async function createProviderModel(settings: AIEnrichmentSettings) {
  const modelId = getProviderModelId(settings.provider);
  const apiKey = getAPIKeyForProvider(settings, settings.provider);

  if (settings.provider === 'openai') {
    const { createOpenAI } = await import('@ai-sdk/openai');
    return createOpenAI({ apiKey })(modelId);
  }

  if (settings.provider === 'gemini') {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
    return createGoogleGenerativeAI({ apiKey })(modelId);
  }

  const { createAnthropic } = await import('@ai-sdk/anthropic');
  return createAnthropic({ apiKey })(modelId);
}

function collectSchemaFieldPaths(
  schemaNode: unknown,
  currentPath: string,
  output: string[],
  depth: number,
  maxFields: number,
): void {
  if (!schemaNode || typeof schemaNode !== 'object' || depth > 4 || output.length >= maxFields) {
    return;
  }

  const node = schemaNode as Record<string, unknown>;
  const nodeType = typeof node.type === 'string' ? node.type : null;

  if (nodeType === 'object' && node.fields && typeof node.fields === 'object') {
    for (const [fieldName, childNode] of Object.entries(node.fields as Record<string, unknown>)) {
      if (output.length >= maxFields) {
        return;
      }
      const nextPath = currentPath ? `${currentPath}.${fieldName}` : fieldName;
      output.push(nextPath);
      collectSchemaFieldPaths(childNode, nextPath, output, depth + 1, maxFields);
    }
    return;
  }

  if (nodeType === 'array') {
    const arrayPath = currentPath ? `${currentPath}[]` : 'items[]';
    output.push(arrayPath);
    collectSchemaFieldPaths(node.items, arrayPath, output, depth + 1, maxFields);
  }
}

function getFallbackFieldAnnotations(responseSchema: unknown): ResponseFieldAnnotation[] {
  const payload =
    responseSchema &&
    typeof responseSchema === 'object' &&
    (responseSchema as Record<string, unknown>).payload &&
    typeof (responseSchema as Record<string, unknown>).payload === 'object'
      ? (responseSchema as Record<string, unknown>).payload
      : null;

  const schemaNode =
    payload &&
    typeof payload === 'object' &&
    (payload as Record<string, unknown>).schema &&
    typeof (payload as Record<string, unknown>).schema === 'object'
      ? (payload as Record<string, unknown>).schema
      : null;

  const fieldPaths: string[] = [];
  collectSchemaFieldPaths(schemaNode, '', fieldPaths, 0, 8);

  return fieldPaths.slice(0, 8).map((fieldPath) => ({
    fieldPath,
    meaning: 'Response field used by the client flow captured in this export.',
  }));
}

function buildFallbackAuthExplanation(endpoint: EndpointForAIEnrichment): string {
  if (!endpoint.authHeaders.length) {
    return 'No mandatory auth header was consistently observed for this endpoint. It may still rely on session cookies or implicit browser auth context.';
  }

  const headerNames = endpoint.authHeaders.map((header) => header.name).join(', ');
  return `Requires auth headers such as ${headerNames}. Missing these headers typically causes unauthorized responses or incomplete data.`;
}

function normalizeFieldAnnotations(value: unknown): ResponseFieldAnnotation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const dedupe = new Set<string>();
  const normalized: ResponseFieldAnnotation[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const record = item as Record<string, unknown>;
    const fieldPath = typeof record.fieldPath === 'string' ? record.fieldPath.trim() : '';
    const meaning = typeof record.meaning === 'string' ? record.meaning.trim() : '';

    if (!fieldPath || !meaning) {
      continue;
    }

    if (dedupe.has(fieldPath)) {
      continue;
    }

    dedupe.add(fieldPath);
    normalized.push({ fieldPath, meaning });

    if (normalized.length >= 16) {
      break;
    }
  }

  return normalized;
}

function fallbackCapabilitiesSummary(endpoints: readonly EndpointForAIEnrichment[]): string {
  return `This API map captures ${endpoints.length} endpoint${endpoints.length === 1 ? '' : 's'} and provides enough request/response structure to scaffold authenticated data collection, automation scripts, and integration code against the target site.`;
}

function buildEnrichmentPrompt(endpoints: readonly EndpointForAIEnrichment[]): string {
  return [
    'Enrich this API map for non-technical users who will hand it to a coding agent.',
    'Return only JSON that matches the provided schema.',
    'Rules:',
    '- Include one endpointEnrichments item per endpointKey.',
    '- Keep description and authExplanation concrete and concise.',
    '- Use semanticGroup labels like Authentication, Timeline, User Profile, Media, Search, Settings, Billing, Notifications.',
    '- responseFieldAnnotations should use dot-notation paths (example: user.id, items[].title).',
    '- Annotate only high-value response fields (max 8 preferred).',
    '- If auth headers are empty, explain likely cookie/session auth behavior.',
    '',
    `Endpoints JSON:\n${JSON.stringify(endpoints)}`,
  ].join('\n');
}

export async function enrichEndpointsWithAI(args: {
  settings: AIEnrichmentSettings;
  endpoints: readonly EndpointForAIEnrichment[];
  onProgress?: (progress: AIProgressUpdate) => void;
}): Promise<AIEnrichmentBatchResult> {
  if (!args.endpoints.length) {
    return {
      capabilitiesSummary: fallbackCapabilitiesSummary(args.endpoints),
      endpointEnrichmentByKey: {},
    };
  }

  const apiKey = getAPIKeyForProvider(args.settings, args.settings.provider);
  if (!apiKey) {
    throw new Error(`Missing ${getProviderLabel(args.settings.provider)} API key`);
  }

  args.onProgress?.({ completed: 0, total: args.endpoints.length });

  const stream = streamObject({
    model: await createProviderModel(args.settings),
    schema: enrichmentBatchSchema,
    maxRetries: 2,
    temperature: 0,
    system:
      'You are a senior API engineer. Produce reliable API annotations for coding agents. Avoid speculation and keep descriptions grounded in the observed schema.',
    prompt: buildEnrichmentPrompt(args.endpoints),
  });

  let lastReportedCount = 0;
  let latestPartial: unknown = null;

  for await (const partial of stream.partialObjectStream) {
    latestPartial = partial;
    const nextCount = Array.isArray(partial.endpointEnrichments)
      ? Math.min(partial.endpointEnrichments.length, args.endpoints.length)
      : 0;

    if (nextCount > lastReportedCount) {
      lastReportedCount = nextCount;
      args.onProgress?.({
        completed: nextCount,
        total: args.endpoints.length,
      });
    }
  }

  let result: {
    capabilitiesSummary: string;
    endpointEnrichments: Array<{
      endpointKey: string;
      description: string;
      authExplanation: string;
      semanticGroup: string;
      responseFieldAnnotations: Array<{
        fieldPath: string;
        meaning: string;
      }>;
    }>;
  };

  try {
    result = await stream.object;
  } catch (error) {
    const partialObject = latestPartial as Record<string, unknown> | null;
    const partialEndpointEnrichments = Array.isArray(partialObject?.endpointEnrichments)
      ? partialObject.endpointEnrichments
      : [];
    const partialSummary = typeof partialObject?.capabilitiesSummary === 'string' ? partialObject.capabilitiesSummary : '';

    if (!partialSummary && partialEndpointEnrichments.length === 0) {
      throw error;
    }

    result = {
      capabilitiesSummary: partialSummary,
      endpointEnrichments: partialEndpointEnrichments.map((item) => ({
        endpointKey: typeof item?.endpointKey === 'string' ? item.endpointKey : '',
        description: typeof item?.description === 'string' ? item.description : '',
        authExplanation: typeof item?.authExplanation === 'string' ? item.authExplanation : '',
        semanticGroup: typeof item?.semanticGroup === 'string' ? item.semanticGroup : '',
        responseFieldAnnotations: Array.isArray(item?.responseFieldAnnotations)
          ? item.responseFieldAnnotations
              .map((annotation: unknown) => {
                const annotationRecord = annotation as Record<string, unknown> | null;
                return {
                  fieldPath: typeof annotationRecord?.fieldPath === 'string' ? annotationRecord.fieldPath : '',
                  meaning: typeof annotationRecord?.meaning === 'string' ? annotationRecord.meaning : '',
                };
              })
              .filter((annotation: { fieldPath: string; meaning: string }) => annotation.fieldPath || annotation.meaning)
          : [],
      })),
    };
  }

  const endpointEnrichmentByKey: Record<string, EndpointAIEnrichment> = {};

  for (const endpoint of result.endpointEnrichments) {
    const key = endpoint.endpointKey.trim();
    if (!key || endpointEnrichmentByKey[key]) {
      continue;
    }

    endpointEnrichmentByKey[key] = {
      description: endpoint.description.trim(),
      authExplanation: endpoint.authExplanation.trim(),
      semanticGroup: endpoint.semanticGroup.trim(),
      responseFieldAnnotations: normalizeFieldAnnotations(endpoint.responseFieldAnnotations),
    };
  }

  for (const endpoint of args.endpoints) {
    if (endpointEnrichmentByKey[endpoint.endpointKey]) {
      continue;
    }

    endpointEnrichmentByKey[endpoint.endpointKey] = {
      description: `Handles ${endpoint.method} ${endpoint.url} for the captured client workflow.`,
      authExplanation: buildFallbackAuthExplanation(endpoint),
      semanticGroup: endpoint.apiType === 'graphql' ? 'GraphQL Operations' : 'REST Endpoints',
      responseFieldAnnotations: getFallbackFieldAnnotations(endpoint.responseSchema),
    };
  }

  args.onProgress?.({
    completed: args.endpoints.length,
    total: args.endpoints.length,
  });

  return {
    capabilitiesSummary: result.capabilitiesSummary.trim() || fallbackCapabilitiesSummary(args.endpoints),
    endpointEnrichmentByKey,
  };
}
