export interface HeaderLike {
  name: string;
  value?: unknown;
}

export interface CookieLike {
  name: string;
  value?: unknown;
  domain?: string;
  path?: string;
  expires?: number | string | null;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string | null;
}

export interface RequestLike {
  method?: string | null;
  url?: string | null;
  headers?: readonly HeaderLike[] | null;
  body?: string | null;
}

export interface EndpointEntryLike {
  request?: RequestLike | null;
}

export interface EndpointGroup<TEntry extends EndpointEntryLike = EndpointEntryLike> {
  endpointKey: string;
  normalizedUrl: string | null;
  method: string;
  entries: TEntry[];
}

export type HeaderValueType =
  | 'unknown'
  | 'empty'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'string';

export interface HeaderField {
  name: string;
  valueType: HeaderValueType | string;
  isAuth: boolean;
  optional?: boolean;
  seenCount?: number;
}

export interface HeadersSchema {
  fields: HeaderField[];
}

export type PrimitiveSchemaType =
  | 'null'
  | 'string'
  | 'number'
  | 'boolean'
  | 'undefined'
  | 'bigint'
  | 'symbol'
  | 'function';

export interface PrimitiveSchema {
  type: PrimitiveSchemaType;
  optional?: boolean;
}

export interface ObjectSchema {
  type: 'object';
  fields: Record<string, JsonSchema>;
  optional?: boolean;
}

export interface ArraySchema {
  type: 'array';
  items: JsonSchema | null;
  optional?: boolean;
}

export interface MixedSchema {
  type: 'mixed';
  variants: string[];
  optional?: boolean;
}

export type JsonSchema = PrimitiveSchema | ObjectSchema | ArraySchema | MixedSchema;

export type BodyContentType = 'json' | 'form' | 'opaque' | 'unknown' | 'mixed';

export interface BodySchema {
  contentType: BodyContentType;
  schema: JsonSchema | null;
  parseError?: string;
}

export interface SchemaObservationSide {
  headers: HeadersSchema;
  body: BodySchema | null;
}

export interface SchemaObservation {
  request: SchemaObservationSide;
  response: SchemaObservationSide;
}

export interface SchemaInferenceRequest {
  headers?: readonly HeaderLike[] | null;
  body?: string | null;
}

export interface SchemaInferenceResponse {
  headers?: readonly HeaderLike[] | null;
  body?: string | null;
  contentType?: string | null;
}

export interface SchemaInferenceEntry {
  request?: SchemaInferenceRequest | null;
  response?: SchemaInferenceResponse | null;
}

export interface MergedEndpointSchema {
  endpointKey: string | null;
  normalizedUrl: string | null;
  method: string | null;
  observationCount: number;
  schema: SchemaObservation;
}

export interface DevtoolsPostDataLike {
  mimeType?: string;
  text?: string;
  params?: readonly unknown[] | null;
}

export interface DevtoolsRequestLike extends RequestLike {
  postData?: DevtoolsPostDataLike | null;
  cookies?: readonly CookieLike[] | null;
}

export interface DevtoolsResponseLike {
  status?: number;
  statusText?: string | null;
  headers?: readonly HeaderLike[] | null;
  cookies?: readonly CookieLike[] | null;
  bodySize?: number | null;
  content?: {
    mimeType?: string;
    size?: number | null;
    text?: string | null;
  } | null;
}

export interface DevtoolsNetworkRequestEntryLike {
  request?: DevtoolsRequestLike | null;
  response?: DevtoolsResponseLike | null;
  startedDateTime?: string | null;
  time?: number | null;
  _resourceType?: string | null;
  getContent?: (callback: (body?: string | null, encoding?: string) => void) => void;
}

export type ScoreRule =
  | 'content-type'
  | 'method'
  | 'url-pattern'
  | 'request-body'
  | 'auth-header';

export interface ScoreReason {
  rule: ScoreRule;
  points: number;
  detail?: string;
}

export interface RequestScore {
  total: number;
  reasons: ScoreReason[];
  normalized: number;
}

export type NoiseFilterCategoryKey =
  | 'media'
  | 'staticAssets'
  | 'analyticsTracking'
  | 'prefetchPreload'
  | 'healthChecksPings'
  | 'browserInternals';

export interface NoiseFilterCategorySettings {
  media: boolean;
  staticAssets: boolean;
  analyticsTracking: boolean;
  prefetchPreload: boolean;
  healthChecksPings: boolean;
  browserInternals: boolean;
}

export interface NoiseFilterSettings {
  enabled: boolean;
  categories: NoiseFilterCategorySettings;
  customUrlPatterns: string[];
  customDomains: string[];
}

export interface RecordedRequest {
  method: string | null;
  url: string | null;
  headers: HeaderLike[];
  cookies: Array<{
    name: string;
    value: string;
    domain: string | null;
    path: string | null;
    expires: string | null;
    httpOnly: boolean | null;
    secure: boolean | null;
    sameSite: string | null;
  }>;
  body: string | null;
}

export interface RecordedResponse {
  status: number | null;
  statusText: string | null;
  headers: HeaderLike[];
  cookies: Array<{
    name: string;
    value: string;
    domain: string | null;
    path: string | null;
    expires: string | null;
    httpOnly: boolean | null;
    secure: boolean | null;
    sameSite: string | null;
  }>;
  contentType: string | null;
  body: string | null;
  encoding: string | null;
  bodyCaptureError: string | null;
}

export interface RecordedTiming {
  startedDateTime: string | null;
  durationMs: number | null;
}

export interface RecordedNetworkEntry {
  id: number;
  capturedAt: string;
  score: RequestScore;
  request: RecordedRequest;
  response: RecordedResponse;
  timing: RecordedTiming;
}

export interface BrowserLike {
  devtools?: {
    network?: {
      onRequestFinished?: {
        addListener(
          callback: (entry: DevtoolsNetworkRequestEntryLike) => void | Promise<void>,
        ): void;
        removeListener(
          callback: (entry: DevtoolsNetworkRequestEntryLike) => void | Promise<void>,
        ): void;
      };
    };
  };
}
