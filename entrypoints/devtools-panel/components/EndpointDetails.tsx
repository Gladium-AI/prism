import { Badge, type BadgeVariant } from '@/src/design-system';
import type { GraphQLSelectionField, MergedGraphQLOperation, SchemaObservation } from '@/core';
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
}: {
  group: PanelEndpointGroup | null;
  mergedSchema: SchemaObservation | null;
  graphQLOperation: MergedGraphQLOperation | null;
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
  const hasAnySection =
    isGraphQL ||
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

            {hasRequestHeaders ? (
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

            {hasRequestBody ? (
              <section className="detail-section">
                <h3>Request Body</h3>
                <div className="section-body">
                  <BodySchemaView bodySchema={mergedSchema.request.body} />
                </div>
              </section>
            ) : null}

            {hasResponseHeaders ? (
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

            {hasResponseBody ? (
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
