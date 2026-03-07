import type { EndpointEntryLike, EndpointGroup } from './types';
import { parseGraphQLOperation } from './graphql-operation';
import { endpointPathKey, normalizeUrl, normalizeUrlPathOnly } from './url-normalizer';

export function deduplicateEntries<TEntry extends EndpointEntryLike>(
  entries: readonly TEntry[],
): EndpointGroup<TEntry>[] {
  const groups: Record<string, EndpointGroup<TEntry>> = Object.create(null) as Record<
    string,
    EndpointGroup<TEntry>
  >;
  const order: string[] = [];

  for (const entry of entries) {
    const request = entry.request ?? {};
    const graphQLOperation = parseGraphQLOperation(request);
    const key = graphQLOperation
      ? graphQLOperation.operationKey
      : endpointPathKey(request.method, request.url);
    const normalizedUrl =
      typeof request.url === 'string'
        ? graphQLOperation
          ? normalizeUrl(request.url)
          : normalizeUrlPathOnly(request.url)
        : null;

    if (!(key in groups)) {
      groups[key] = {
        endpointKey: key,
        normalizedUrl,
        method: typeof request.method === 'string' ? request.method.toUpperCase() : 'GET',
        entries: [],
      };
      order.push(key);
    }

    if (!groups[key].normalizedUrl && normalizedUrl) {
      groups[key].normalizedUrl = normalizedUrl;
    }

    groups[key].entries.push(entry);
  }

  return order.map((key) => groups[key]);
}
