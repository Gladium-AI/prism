import { formatCookieFlags } from '../panel-utils';

interface CookieSectionProps {
  isSnapshot: boolean;
  isCapturingCookies: boolean;
  snapshotCookies: Browser.cookies.Cookie[];
  snapshotCookieDomain: string | null;
  snapshotCookieError: string | null;
}

export function CookieSection({
  isSnapshot,
  isCapturingCookies,
  snapshotCookies,
  snapshotCookieDomain,
  snapshotCookieError,
}: CookieSectionProps) {
  const cookieCount = isSnapshot ? snapshotCookies.length : 0;

  return (
    <section className="detail-block cookie-block" aria-label="Snapshot cookies">
      <header className="pane-header">
        <h2>Snapshot Cookies</h2>
        <span className="count-pill">{cookieCount}</span>
      </header>
      <div className="cookie-list">
        {!isSnapshot ? (
          <div className="empty-state">
            Take a snapshot to capture cookies for the active tab domain.
          </div>
        ) : isCapturingCookies ? (
          <div className="empty-state">Capturing cookies for the active tab domain...</div>
        ) : snapshotCookieError ? (
          <div className="empty-state">Unable to capture cookies: {snapshotCookieError}</div>
        ) : snapshotCookies.length === 0 ? (
          <div className="empty-state">
            No cookies found for the active tab domain
            {snapshotCookieDomain ? ` (${snapshotCookieDomain})` : ''}.
          </div>
        ) : (
          snapshotCookies.map((cookie) => {
            const name = cookie.name?.length ? cookie.name : '(unnamed)';
            const value = cookie.value?.length ? cookie.value : '(empty)';
            const domain = cookie.domain?.length ? cookie.domain : '(unknown domain)';
            const flags = formatCookieFlags(cookie);

            return (
              <article
                className="cookie-row"
                key={`${cookie.name}|${cookie.domain}|${cookie.path}|${cookie.storeId}|${JSON.stringify(
                  cookie.partitionKey ?? null,
                )}`}
              >
                <p className="cookie-name">{name}</p>
                <p className="cookie-value">{value}</p>
                <p className="cookie-meta">Domain: {domain}</p>
                <p className="cookie-meta">Flags: {flags}</p>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
