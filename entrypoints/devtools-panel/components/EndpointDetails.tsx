import type { SchemaObservation } from '@/core';
import {
  buildHeaderValuesMap,
  getDisplayMethod,
  getMethodClass,
  isGraphQLGroup,
  type PanelEndpointGroup,
} from '../panel-utils';
import { BodySchemaView, HeadersSchemaTable } from './SchemaView';

function EmptyDetailsState() {
  return (
    <div className="empty-state">
      Select an endpoint to inspect its schema, headers, and auth.
    </div>
  );
}

export function EndpointDetails({
  group,
  mergedSchema,
}: {
  group: PanelEndpointGroup | null;
  mergedSchema: SchemaObservation | null;
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
  const apiTypeLabel = isGraphQLGroup(group) ? 'GraphQL' : 'REST';
  const apiTypeClass = isGraphQLGroup(group) ? 'meta-chip-graphql' : 'meta-chip-rest';

  const requestHeaderValues = buildHeaderValuesMap(group.entries, 'request');
  const responseHeaderValues = buildHeaderValuesMap(group.entries, 'response');

  const requestHeaderFields = mergedSchema?.request.headers.fields ?? [];
  const responseHeaderFields = mergedSchema?.response.headers.fields ?? [];
  const hasAuthHeaders = requestHeaderFields.some((field) => field.isAuth);
  const hasRequestHeaders = requestHeaderFields.length > 0;
  const hasResponseHeaders = responseHeaderFields.length > 0;
  const hasRequestBody = mergedSchema?.request.body != null;
  const hasResponseBody = mergedSchema?.response.body != null;
  const hasAnySection =
    hasAuthHeaders || hasRequestHeaders || hasRequestBody || hasResponseHeaders || hasResponseBody;

  return (
    <section className="detail-block" aria-label="Endpoint details">
      <header className="pane-header">
        <h2>Endpoint Details</h2>
      </header>
      <div className="endpoint-details">
        <section className="detail-summary">
          <div className="summary-meta">
            <span className={`meta-chip ${getMethodClass(method)}`}>{method}</span>
            <span className="meta-chip">
              {observationCount} observation{observationCount !== 1 ? 's' : ''}
            </span>
            <span className={`meta-chip ${apiTypeClass}`}>{apiTypeLabel}</span>
          </div>
          <p className="summary-url">{displayUrl}</p>
        </section>

        {!mergedSchema || !hasAnySection ? (
          <div className="empty-state">No endpoint schema details available yet.</div>
        ) : (
          <>
            {hasAuthHeaders ? (
              <section className="detail-section">
                <h3>Authentication</h3>
                <div className="section-body">
                  <HeadersSchemaTable
                    headersSchema={mergedSchema.request.headers}
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
                    headersSchema={mergedSchema.request.headers}
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
                    headersSchema={mergedSchema.response.headers}
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
