import type { EndpointEntryLike, EndpointGroup } from './types';
import { parseGraphQLOperation } from './graphql-operation';
import { endpointKey, normalizeUrl } from './url-normalizer';

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
    const key = graphQLOperation ? graphQLOperation.operationKey : endpointKey(request.method, request.url);

    if (!(key in groups)) {
      groups[key] = {
        endpointKey: key,
        normalizedUrl: typeof request.url === 'string' ? normalizeUrl(request.url) : null,
        method: typeof request.method === 'string' ? request.method.toUpperCase() : 'GET',
        entries: [],
      };
      order.push(key);
    }

    if (!groups[key].normalizedUrl && typeof request.url === 'string') {
      groups[key].normalizedUrl = normalizeUrl(request.url);
    }

    groups[key].entries.push(entry);
  }

  return order.map((key) => groups[key]);
}
