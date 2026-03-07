import { Badge, type BadgeVariant } from '@/src/design-system';
import type {
  GraphQLSelectionField,
  HeaderField,
  MergedGraphQLOperation,
  MergedRestEndpoint,
  SchemaObservation,
} from '@/core';
import {
  buildHeaderValuesMap,
  getDisplayMethod,
  getMethodClass,
  type PanelEndpointGroup,
} from '../panel-utils';
import { BodySchemaView, HeadersSchemaTable, JsonSchemaTree } from './SchemaView';

const methodBadgeVariantByClass: Record<'method-get' | 'method-write' | 'method-other', BadgeVariant> = {
  'method-get': 'methodGet',
  'method-write': 'methodWrite',
  'method-other': 'methodOther',
};

function EmptyDetailsState() {
  return <div className="empty-state">Select an endpoint to inspect its schema, headers, and auth.</div>;
}

function getEntryStatusLabel(entry: PanelEndpointGroup['entries'][number]): string {
  const status = entry.response?.status;
  return typeof status === 'number' ? String(status) : 'unknown';
}

function RestParametersList({
  title,
  fields,
}: {
  title: string;
  fields: Array<{ name: string; type: string; role?: string; optional?: boolean; seenCount?: number }>;
}) {
  return (
    <section className="rest-params-block">
      <h4>{title}</h4>
      {!fields.length ? (
        <div className="schema-note">None</div>
      ) : (
        <div className="rest-params-list">
          {fields.map((field) => (
            <div key={field.name} className="rest-param-row">
              <span className="rest-param-name">{field.name}</span>
              <span className="rest-param-type">{field.type}</span>
              {field.role ? <span className="rest-param-role">{field.role}</span> : null}
              {field.optional ? (
                <Badge className="schema-optional" variant="subtle" size="xs" uppercase={false}>
                  optional
                </Badge>
              ) : null}
              {typeof field.seenCount === 'number' ? (
                <Badge className="seen-count" variant="counter" size="xs" uppercase={false}>
                  {field.seenCount}
                </Badge>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function GraphQLSelectionTree({
  fields,
  parentSeenCount,
}: {
  fields: readonly GraphQLSelectionField[];
  parentSeenCount: number;
}) {
  if (!fields.length) {
    return <div className="schema-note">No fields detected</div>;
  }

  return (
    <ul className="graphql-selection-list">
      {fields.map((field) => {
        const nestedFields = Array.isArray(field.fields) ? field.fields : [];
        const seenCount = typeof field.seenCount === 'number' ? field.seenCount : null;
        const showSeenCount = seenCount != null && seenCount !== parentSeenCount;

        return (
          <li key={field.name}>
            <div className="graphql-selection-field">
              <span className="graphql-selection-name">{field.name}</span>
              {field.optional ? (
                <Badge className="schema-optional" variant="subtle" size="xs" uppercase={false}>
                  optional
                </Badge>
              ) : null}
              {showSeenCount ? (
                <Badge className="seen-count" variant="counter" size="xs" uppercase={false}>
                  {seenCount}
                </Badge>
              ) : null}
            </div>
            {nestedFields.length > 0 ? (
              <GraphQLSelectionTree
                fields={nestedFields}
                parentSeenCount={seenCount != null ? seenCount : parentSeenCount}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function EndpointDetails({
  group,
  mergedSchema,
  graphQLOperation,
  restEndpoint,
}: {
  group: PanelEndpointGroup | null;
  mergedSchema: SchemaObservation | null;
  graphQLOperation: MergedGraphQLOperation | null;
  restEndpoint: MergedRestEndpoint | null;
}) {
  if (!group) {
    return (
      <section className="detail-block" aria-label="Endpoint details">
        <header className="pane-header">
          <h2>Endpoint Details</h2>
        </header>
        <div className="endpoint-details">
          <EmptyDetailsState />
        </div>
      </section>
    );
  }

  const method = getDisplayMethod(group.method);
  const observationCount = group.entries.length;
  const displayUrl = group.normalizedUrl || group.endpointKey;
  const isGraphQL = graphQLOperation != null;
  const isRest = !isGraphQL && restEndpoint != null;
  const apiTypeLabel = isGraphQL ? 'GraphQL' : 'REST';
  const apiTypeVariant: BadgeVariant = isGraphQL ? 'apiGraphql' : 'apiRest';

  const requestHeaderValues = buildHeaderValuesMap(group.entries, 'request');
  const responseHeaderValues = buildHeaderValuesMap(group.entries, 'response');

  const requestHeadersSchema = mergedSchema?.request.headers ?? { fields: [] };
  const responseHeadersSchema = mergedSchema?.response.headers ?? { fields: [] };
  const requestHeaderFields = requestHeadersSchema.fields;
  const responseHeaderFields = responseHeadersSchema.fields;
  const hasAuthHeaders = requestHeaderFields.some((field) => field.isAuth);
  const hasRequestHeaders = requestHeaderFields.length > 0;
  const hasResponseHeaders = responseHeaderFields.length > 0;
  const hasRequestBody = mergedSchema?.request.body != null;
  const hasResponseBody = mergedSchema?.response.body != null;
  const hasGraphQLSelectionSet =
    Array.isArray(graphQLOperation?.selectionSet) && graphQLOperation.selectionSet.length > 0;
  const hasGraphQLRawQueries =
    Array.isArray(graphQLOperation?.rawQueries) && graphQLOperation.rawQueries.length > 0;
  const hasGraphQLVariables = graphQLOperation?.variablesSchema != null;
  const statusHeaderValuesByLabel: Record<string, Record<string, string[]>> = {};
  if (isRest && restEndpoint?.statusSchemas.length) {
    for (const statusSchema of restEndpoint.statusSchemas) {
      const entriesForStatus = group.entries.filter((entry) => getEntryStatusLabel(entry) === statusSchema.statusLabel);
      statusHeaderValuesByLabel[statusSchema.statusLabel] = buildHeaderValuesMap(entriesForStatus, 'response');
    }
  }

  const requestCustomHeaders: HeaderField[] = isRest ? restEndpoint?.requestHeaders.custom ?? [] : [];
  const requestStandardHeaders: HeaderField[] = isRest ? restEndpoint?.requestHeaders.standard ?? [] : [];

  const hasAnySection =
    isGraphQL ||
    isRest ||
    hasAuthHeaders ||
    hasRequestHeaders ||
    hasRequestBody ||
    hasResponseHeaders ||
    hasResponseBody;

  return (
    <section className="detail-block" aria-label="Endpoint details">
      <header className="pane-header">
        <h2>Endpoint Details</h2>
      </header>
      <div className="endpoint-details">
        <section className="detail-summary">
          <div className="summary-meta">
            <Badge variant={methodBadgeVariantByClass[getMethodClass(method)]}>{method}</Badge>
            {graphQLOperation ? (
              <Badge variant="info" uppercase={false}>
                {graphQLOperation.operationType}
              </Badge>
            ) : null}
            <Badge variant="count" uppercase={false}>
              {observationCount} observation{observationCount !== 1 ? 's' : ''}
            </Badge>
            <Badge variant={apiTypeVariant} uppercase={false}>
              {apiTypeLabel}
            </Badge>
          </div>
          <p className="summary-url">{graphQLOperation?.operationName ?? displayUrl}</p>
          {graphQLOperation ? <p className="summary-suburl">{displayUrl}</p> : null}
        </section>

        {!hasAnySection ? (
          <div className="empty-state">No endpoint schema details available yet.</div>
        ) : (
          <>
            {graphQLOperation ? (
              <section className="detail-section">
                <h3>GraphQL Operation</h3>
                <div className="section-body">
                  <div className="graphql-operation-head">
                    <Badge variant="apiGraphql" uppercase={false}>
                      {graphQLOperation.operationType}
                    </Badge>
                    <span className="graphql-operation-name">
                      {graphQLOperation.operationName ?? graphQLOperation.operationKey}
                    </span>
                  </div>
                </div>
              </section>
            ) : null}

            {graphQLOperation ? (
              <section className="detail-section">
                <h3>Variables</h3>
                <div className="section-body">
                  {hasGraphQLVariables ? (
                    <JsonSchemaTree schema={graphQLOperation.variablesSchema} />
                  ) : (
                    <div className="schema-note">No variables detected</div>
                  )}
                </div>
              </section>
            ) : null}

            {graphQLOperation ? (
              <section className="detail-section">
                <h3>Selection Set</h3>
                <div className="section-body">
                  {hasGraphQLSelectionSet ? (
                    <GraphQLSelectionTree
                      fields={graphQLOperation.selectionSet ?? []}
                      parentSeenCount={observationCount}
                    />
                  ) : (
                    <div className="schema-note">No selection set detected</div>
                  )}
                </div>
              </section>
            ) : null}

            {graphQLOperation ? (
              <section className="detail-section">
                <h3>Raw GraphQL</h3>
                <div className="section-body">
                  {hasGraphQLRawQueries ? (
                    <details className="graphql-raw-details">
                      <summary>Show raw query text</summary>
                      <div className="graphql-raw-stack">
                        {graphQLOperation.rawQueries.map((query, index) => (
                          <pre key={`graphql-raw-${index}`} className="graphql-raw-query">
                            {query}
                          </pre>
                        ))}
                      </div>
                    </details>
                  ) : (
                    <div className="schema-note">Raw query unavailable for this operation</div>
                  )}
                </div>
              </section>
            ) : null}

            {hasAuthHeaders ? (
              <section className="detail-section">
                <h3>Authentication</h3>
                <div className="section-body">
                  <HeadersSchemaTable
                    headersSchema={requestHeadersSchema}
                    showAuthOnly={true}
                    headerValues={requestHeaderValues}
                  />
                </div>
              </section>
            ) : null}

            {isRest ? (
              <section className="detail-section">
                <h3>URL Anatomy</h3>
                <div className="section-body">
                  <div className="rest-url-template">
                    <span className="rest-url-label">Path template:</span>
                    <span className="rest-url-value">{restEndpoint.pathTemplate ?? '(unknown)'}</span>
                  </div>
                  <RestParametersList
                    title="Path Parameters"
                    fields={restEndpoint.pathParameters.map((field) => ({
                      name: field.placeholder,
                      type: field.type,
                      role: field.role,
                      optional: field.optional,
                      seenCount: field.seenCount,
                    }))}
                  />
                  <RestParametersList
                    title="Query Parameters"
                    fields={restEndpoint.queryParameters.map((field) => ({
                      name: field.name,
                      type: field.type,
                      optional: field.optional,
                      seenCount: field.seenCount,
                    }))}
                  />
                </div>
              </section>
            ) : null}

            {isRest ? (
              <section className="detail-section">
                <h3>Request</h3>
                <div className="section-body rest-request-stack">
                  <section className="rest-params-block">
                    <h4>Custom Headers</h4>
                    {requestCustomHeaders.length ? (
                      <HeadersSchemaTable
                        headersSchema={{ fields: requestCustomHeaders }}
                        showAuthOnly={false}
                        headerValues={requestHeaderValues}
                      />
                    ) : (
                      <div className="schema-note">No custom headers</div>
                    )}
                  </section>

                  <section className="rest-params-block">
                    <h4>Body</h4>
                    <BodySchemaView bodySchema={restEndpoint.requestBody} />
                  </section>

                  <details className="raw-headers-details">
                    <summary>Show raw request headers</summary>
                    <div className="rest-raw-headers-stack">
                      {requestStandardHeaders.length ? (
                        <section className="rest-params-block">
                          <h4>Standard Headers</h4>
                          <HeadersSchemaTable
                            headersSchema={{ fields: requestStandardHeaders }}
                            showAuthOnly={false}
                            headerValues={requestHeaderValues}
                          />
                        </section>
                      ) : null}

                      <section className="rest-params-block">
                        <h4>All Request Headers</h4>
                        <HeadersSchemaTable
                          headersSchema={requestHeadersSchema}
                          showAuthOnly={false}
                          headerValues={requestHeaderValues}
                        />
                      </section>
                    </div>
                  </details>
                </div>
              </section>
            ) : null}

            {isRest ? (
              <section className="detail-section">
                <h3>Responses By Status</h3>
                <div className="section-body rest-response-stack">
                  <div className="status-code-list">
                    {restEndpoint.statusCodes.map((statusCode) => (
                      <Badge key={`status-code-${statusCode}`} variant="info" uppercase={false}>
                        {statusCode}
                      </Badge>
                    ))}
                  </div>

                  {!restEndpoint.statusSchemas.length ? (
                    <div className="schema-note">No response observations detected</div>
                  ) : (
                    restEndpoint.statusSchemas.map((statusSchema) => (
                      <article key={`rest-status-${statusSchema.statusLabel}`} className="rest-status-card">
                        <header className="rest-status-header">
                          <Badge variant="apiRest" uppercase={false}>
                            {statusSchema.statusLabel}
                          </Badge>
                          <Badge variant="count" uppercase={false}>
                            {statusSchema.observationCount} observation
                            {statusSchema.observationCount !== 1 ? 's' : ''}
                          </Badge>
                        </header>
                        <div className="rest-status-content">
                          <section className="rest-params-block">
                            <h4>Body</h4>
                            <BodySchemaView bodySchema={statusSchema.response.body} />
                          </section>
                          <details className="raw-headers-details">
                            <summary>Show raw response headers</summary>
                            <HeadersSchemaTable
                              headersSchema={statusSchema.response.headers}
                              showAuthOnly={false}
                              headerValues={statusHeaderValuesByLabel[statusSchema.statusLabel]}
                            />
                          </details>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>
            ) : null}

            {!isRest && hasRequestHeaders ? (
              <section className="detail-section">
                <h3>Request Headers</h3>
                <div className="section-body">
                  <HeadersSchemaTable
                    headersSchema={requestHeadersSchema}
                    showAuthOnly={false}
                    headerValues={requestHeaderValues}
                  />
                </div>
              </section>
            ) : null}

            {!isRest && hasRequestBody ? (
              <section className="detail-section">
                <h3>Request Body</h3>
                <div className="section-body">
                  <BodySchemaView bodySchema={mergedSchema.request.body} />
                </div>
              </section>
            ) : null}

            {!isRest && hasResponseHeaders ? (
              <section className="detail-section">
                <h3>Response Headers</h3>
                <div className="section-body">
                  <HeadersSchemaTable
                    headersSchema={responseHeadersSchema}
                    showAuthOnly={false}
                    headerValues={responseHeaderValues}
                  />
                </div>
              </section>
            ) : null}

            {!isRest && hasResponseBody ? (
              <section className="detail-section">
                <h3>Response Body</h3>
                <div className="section-body">
                  <BodySchemaView bodySchema={mergedSchema.response.body} />
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
