(function initPanel(globalScope) {
  const POLL_INTERVAL_MS = 400;

  const elements = {
    snapshotButton: document.getElementById("snapshot-toggle"),
    exportButton: document.getElementById("snapshot-export"),
    liveIndicator: document.getElementById("live-indicator"),
    requestCount: document.getElementById("request-count"),
    endpointCount: document.getElementById("endpoint-count"),
    requestList: document.getElementById("request-list"),
    requestDetails: document.getElementById("request-details"),
    cookieCount: document.getElementById("cookie-count"),
    cookieList: document.getElementById("cookie-list"),
  };

  const state = {
    isSnapshot: false,
    snapshotTime: null,
    selectedId: null,
    liveEntries: [],
    snapshotEntries: [],
    snapshotCookies: [],
    snapshotCookieDomain: null,
    snapshotCookieError: null,
    isCapturingCookies: false,
    snapshotCaptureId: 0,
    lastListSignature: "",
  };

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function getScore(entry) {
    return entry && entry.score && typeof entry.score.total === "number"
      ? entry.score.total
      : 0;
  }

  function getStatus(entry) {
    return entry && entry.response && typeof entry.response.status === "number"
      ? entry.response.status
      : null;
  }

  function getMethod(entry) {
    if (!entry || !entry.request || typeof entry.request.method !== "string") {
      return "-";
    }

    return entry.request.method.toUpperCase();
  }

  function getContentType(entry) {
    const type =
      entry && entry.response && typeof entry.response.contentType === "string"
        ? entry.response.contentType
        : "";

    if (!type) {
      return "unknown";
    }

    return type;
  }

  function sortByScore(entries) {
    return entries.slice().sort((left, right) => {
      const scoreDifference = getScore(right) - getScore(left);
      if (scoreDifference !== 0) {
        return scoreDifference;
      }

      return (right.id || 0) - (left.id || 0);
    });
  }

  function getListSignature(entries) {
    if (!entries.length) {
      return "empty";
    }

    const top = entries[0];
    const last = entries[entries.length - 1];
    return `${entries.length}:${top.id}:${last.id}:${getScore(top)}`;
  }

  function getDisplayEntries() {
    return state.isSnapshot ? state.snapshotEntries : state.liveEntries;
  }

  function ensureValidSelection(entries) {
    if (!entries.length) {
      state.selectedId = null;
      return;
    }

    const selectionExists = entries.some((entry) => entry.id === state.selectedId);
    if (!selectionExists) {
      state.selectedId = entries[0].id;
    }
  }

  function formatForList(url) {
    if (typeof url !== "string" || url.length === 0) {
      return "(no URL)";
    }

    try {
      const parsed = new URL(url);
      const query = parsed.search.length > 48
        ? `${parsed.search.slice(0, 48)}...`
        : parsed.search;

      return `${parsed.host}${parsed.pathname}${query}`;
    } catch {
      if (url.length > 96) {
        return `${url.slice(0, 96)}...`;
      }
      return url;
    }
  }

  function formatAsPrettyJson(value) {
    if (typeof value !== "string" || value.trim().length === 0) {
      return "(empty)";
    }

    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return value;
    }
  }

  function formatHeaders(headers) {
    if (!Array.isArray(headers) || headers.length === 0) {
      return "(none)";
    }

    return headers
      .map((header) => {
        const name = header && typeof header.name === "string" ? header.name : "(unknown)";
        const value = header && header.value !== undefined ? String(header.value) : "";
        return `${name}: ${value}`;
      })
      .join("\n");
  }

  function normalizeHeaders(headers) {
    if (!Array.isArray(headers)) {
      return [];
    }

    return headers
      .map((header) => {
        if (!header || typeof header.name !== "string") {
          return null;
        }

        return {
          name: header.name,
          value: header.value !== undefined ? String(header.value) : "",
        };
      })
      .filter(Boolean);
  }

  function serializeScore(score) {
    return {
      total: score && typeof score.total === "number" ? score.total : 0,
      normalized: score && typeof score.normalized === "number" ? score.normalized : null,
      reasons: score && Array.isArray(score.reasons) ? score.reasons : [],
    };
  }

  function getEndpointKey(entry) {
    const normalizer = globalScope.GladiumUrlNormalizer;
    if (!normalizer || typeof normalizer.endpointKey !== "function") {
      return null;
    }

    const request = entry && entry.request ? entry.request : {};
    return normalizer.endpointKey(request.method, request.url);
  }

  function getEntrySchema(entry) {
    const inferrer = globalScope.GladiumSchemaInferrer;
    if (!inferrer || typeof inferrer.inferSchema !== "function") {
      return null;
    }

    return inferrer.inferSchema(entry);
  }

  function serializeRequestForExport(entry) {
    const request = entry && entry.request ? entry.request : {};
    const response = entry && entry.response ? entry.response : {};
    const timing = entry && entry.timing ? entry.timing : {};

    return {
      id: entry && typeof entry.id === "number" ? entry.id : null,
      capturedAt: entry && typeof entry.capturedAt === "string" ? entry.capturedAt : null,
      endpointKey: getEndpointKey(entry),
      schema: getEntrySchema(entry),
      score: serializeScore(entry ? entry.score : null),
      request: {
        url: typeof request.url === "string" ? request.url : null,
        method: typeof request.method === "string" ? request.method.toUpperCase() : null,
        headers: normalizeHeaders(request.headers),
        body: typeof request.body === "string" ? request.body : null,
      },
      response: {
        status: typeof response.status === "number" ? response.status : null,
        statusText: typeof response.statusText === "string" ? response.statusText : null,
        headers: normalizeHeaders(response.headers),
        body: typeof response.body === "string" ? response.body : null,
        contentType: typeof response.contentType === "string" ? response.contentType : null,
        encoding: typeof response.encoding === "string" ? response.encoding : null,
        bodyCaptureError: typeof response.bodyCaptureError === "string"
          ? response.bodyCaptureError
          : null,
      },
      timing: {
        startedDateTime: typeof timing.startedDateTime === "string" ? timing.startedDateTime : null,
        durationMs: typeof timing.durationMs === "number" ? timing.durationMs : null,
      },
    };
  }

  function serializeCookieForExport(cookie) {
    const result = {
      name: cookie && typeof cookie.name === "string" ? cookie.name : "",
      value: cookie && typeof cookie.value === "string" ? cookie.value : "",
      domain: cookie && typeof cookie.domain === "string" ? cookie.domain : "",
      path: cookie && typeof cookie.path === "string" ? cookie.path : "",
      secure: Boolean(cookie && cookie.secure),
      httpOnly: Boolean(cookie && cookie.httpOnly),
      sameSite: cookie && typeof cookie.sameSite === "string" ? cookie.sameSite : "unspecified",
      session: Boolean(cookie && cookie.session),
      hostOnly: Boolean(cookie && cookie.hostOnly),
      storeId: cookie && typeof cookie.storeId === "string" ? cookie.storeId : "",
      expirationDate:
        cookie && typeof cookie.expirationDate === "number" ? cookie.expirationDate : null,
      partitionKey: cookie && cookie.partitionKey ? cookie.partitionKey : null,
    };

    if (typeof result.expirationDate === "number") {
      result.expiresAt = new Date(result.expirationDate * 1000).toISOString();
    } else {
      result.expiresAt = null;
    }

    return result;
  }

  function getSnapshotTimestamp(snapshotTime) {
    return snapshotTime instanceof Date ? snapshotTime.toISOString() : null;
  }

  function formatNumberForFilename(value) {
    return String(value).padStart(2, "0");
  }

  function buildSnapshotFilename(snapshotTime) {
    const date = snapshotTime instanceof Date ? snapshotTime : new Date();
    const yyyy = date.getFullYear();
    const mm = formatNumberForFilename(date.getMonth() + 1);
    const dd = formatNumberForFilename(date.getDate());
    const hh = formatNumberForFilename(date.getHours());
    const min = formatNumberForFilename(date.getMinutes());
    const ss = formatNumberForFilename(date.getSeconds());

    return `gladium-snapshot-${yyyy}${mm}${dd}-${hh}${min}${ss}.json`;
  }

  function getMergedEndpointSchema(group) {
    const merger = globalScope.GladiumSchemaMerger;
    if (!merger || typeof merger.mergeEndpointGroup !== "function") {
      return null;
    }

    const result = merger.mergeEndpointGroup(group);
    return result ? result.schema : null;
  }

  function buildEndpointsSummary(entries) {
    const normalizer = globalScope.GladiumUrlNormalizer;
    if (!normalizer || typeof normalizer.deduplicateEntries !== "function") {
      return [];
    }

    const groups = normalizer.deduplicateEntries(entries);
    return groups.map(function (group) {
      const scores = group.entries.map(getScore);
      const maxScore = Math.max.apply(null, scores.length ? scores : [0]);

      return {
        endpointKey: group.endpointKey,
        normalizedUrl: group.normalizedUrl,
        method: group.method,
        observationCount: group.entries.length,
        maxScore: maxScore,
        mergedSchema: getMergedEndpointSchema(group),
        requestIds: group.entries.map(function (entry) {
          return entry && typeof entry.id === "number" ? entry.id : null;
        }),
      };
    });
  }

  function buildSnapshotExportPayload() {
    const endpoints = buildEndpointsSummary(state.snapshotEntries);

    return {
      format: "gladium-snapshot-v1",
      exportedAt: new Date().toISOString(),
      snapshot: {
        capturedAt: getSnapshotTimestamp(state.snapshotTime),
        requestCount: state.snapshotEntries.length,
        endpointCount: endpoints.length,
        cookieCount: state.snapshotCookies.length,
        cookieDomain: state.snapshotCookieDomain,
        cookieCaptureError: state.snapshotCookieError,
      },
      endpoints: endpoints,
      requests: state.snapshotEntries.map(serializeRequestForExport),
      cookies: state.snapshotCookies.map(serializeCookieForExport),
    };
  }

  function downloadTextFile(fileName, content) {
    const blob = new Blob([content], {
      type: "application/json;charset=utf-8",
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = objectUrl;
    link.download = fileName;
    link.style.display = "none";

    document.body.appendChild(link);
    link.click();
    link.remove();

    globalScope.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 0);
  }

  function getHostnameFromUrl(url) {
    if (typeof url !== "string" || url.length === 0) {
      return null;
    }

    try {
      return new URL(url).hostname || null;
    } catch {
      return null;
    }
  }

  function getHttpUrl(url) {
    if (typeof url !== "string" || url.length === 0) {
      return null;
    }

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }

      return parsed.toString();
    } catch {
      return null;
    }
  }

  function getUrlFromEntries(entries) {
    for (const entry of entries) {
      const candidate = getHttpUrl(entry && entry.request ? entry.request.url : null);
      if (candidate) {
        return candidate;
      }
    }
    return null;
  }

  function getDomainFromEntries(entries) {
    for (const entry of entries) {
      const domain = getHostnameFromUrl(entry && entry.request ? entry.request.url : null);
      if (domain) {
        return domain;
      }
    }
    return null;
  }

  function evaluateInInspectedWindow(expression) {
    return new Promise((resolve) => {
      if (
        typeof chrome === "undefined" ||
        !chrome.devtools ||
        !chrome.devtools.inspectedWindow ||
        typeof chrome.devtools.inspectedWindow.eval !== "function"
      ) {
        resolve({ value: null, error: "inspectedWindow API unavailable" });
        return;
      }

      try {
        chrome.devtools.inspectedWindow.eval(expression, (value, exceptionInfo) => {
          if (exceptionInfo && exceptionInfo.isException) {
            resolve({
              value: null,
              error: exceptionInfo.value || "inspectedWindow eval failed",
            });
            return;
          }

          const runtimeError = chrome.runtime && chrome.runtime.lastError
            ? chrome.runtime.lastError.message
            : null;
          resolve({
            value: runtimeError ? null : value,
            error: runtimeError,
          });
        });
      } catch (error) {
        resolve({
          value: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  async function getActiveTabCookieScope() {
    const evalResult = await evaluateInInspectedWindow("window.location.href");
    const inspectedUrl = getHttpUrl(evalResult.value);
    if (inspectedUrl) {
      return {
        domain: getHostnameFromUrl(inspectedUrl),
        url: inspectedUrl,
      };
    }

    const fallbackUrl = getUrlFromEntries(state.liveEntries);
    return {
      domain: fallbackUrl ? getHostnameFromUrl(fallbackUrl) : getDomainFromEntries(state.liveEntries),
      url: fallbackUrl,
    };
  }

  function getCookiesByFilter(filter) {
    return new Promise((resolve) => {
      if (
        typeof chrome === "undefined" ||
        !chrome.cookies ||
        typeof chrome.cookies.getAll !== "function"
      ) {
        resolve({ cookies: [], error: "cookies API unavailable" });
        return;
      }

      try {
        chrome.cookies.getAll(filter, (cookies) => {
          const runtimeError = chrome.runtime && chrome.runtime.lastError
            ? chrome.runtime.lastError.message
            : null;
          if (runtimeError) {
            resolve({ cookies: [], error: runtimeError });
            return;
          }

          resolve({
            cookies: Array.isArray(cookies) ? cookies : [],
            error: null,
          });
        });
      } catch (error) {
        resolve({
          cookies: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  async function getCookiesForScope(scope) {
    const filters = [];
    if (scope && typeof scope.domain === "string" && scope.domain.length > 0) {
      filters.push({ domain: scope.domain });
    }
    if (scope && typeof scope.url === "string" && scope.url.length > 0) {
      filters.push({ url: scope.url });
    }

    if (!filters.length) {
      return { cookies: [], error: "active tab domain unavailable" };
    }

    const seen = new Set();
    const mergedCookies = [];
    let firstError = null;
    let hasSuccessfulQuery = false;

    for (const filter of filters) {
      const result = await getCookiesByFilter(filter);
      if (result.error) {
        if (!firstError) {
          firstError = result.error;
        }
        continue;
      }

      hasSuccessfulQuery = true;

      for (const cookie of result.cookies) {
        const partitionKey =
          cookie && cookie.partitionKey ? JSON.stringify(cookie.partitionKey) : "";
        const key = [
          cookie && cookie.name ? cookie.name : "",
          cookie && cookie.domain ? cookie.domain : "",
          cookie && cookie.path ? cookie.path : "",
          cookie && cookie.storeId ? cookie.storeId : "",
          partitionKey,
        ].join("|");
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        mergedCookies.push(cookie);
      }
    }

    return {
      cookies: mergedCookies,
      error: hasSuccessfulQuery ? null : firstError,
    };
  }

  function sortCookies(cookies) {
    return cookies.slice().sort((left, right) => {
      const leftName = left && typeof left.name === "string" ? left.name : "";
      const rightName = right && typeof right.name === "string" ? right.name : "";
      const nameOrder = leftName.localeCompare(rightName);
      if (nameOrder !== 0) {
        return nameOrder;
      }

      const leftDomain = left && typeof left.domain === "string" ? left.domain : "";
      const rightDomain = right && typeof right.domain === "string" ? right.domain : "";
      return leftDomain.localeCompare(rightDomain);
    });
  }

  function formatCookieFlags(cookie) {
    const flags = [];

    if (cookie && cookie.secure) {
      flags.push("Secure");
    }

    if (cookie && cookie.httpOnly) {
      flags.push("HttpOnly");
    }

    if (cookie && cookie.session) {
      flags.push("Session");
    }

    if (cookie && cookie.hostOnly) {
      flags.push("HostOnly");
    }

    if (cookie && typeof cookie.sameSite === "string" && cookie.sameSite !== "unspecified") {
      flags.push(`SameSite=${cookie.sameSite}`);
    }

    if (cookie && cookie.partitionKey) {
      flags.push("Partitioned");
    }

    if (!flags.length) {
      return "None";
    }

    return flags.join(", ");
  }

  function formatStatusText(status, statusText) {
    if (typeof status !== "number") {
      return "-";
    }

    if (typeof statusText === "string" && statusText.length > 0) {
      return `${status} ${statusText}`;
    }

    return String(status);
  }

  function formatSnapshotTime(snapshotTime) {
    if (!(snapshotTime instanceof Date)) {
      return "";
    }

    return snapshotTime.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function formatCapturedAt(capturedAt) {
    if (typeof capturedAt !== "string" || capturedAt.length === 0) {
      return "unknown";
    }

    const date = new Date(capturedAt);
    if (Number.isNaN(date.getTime())) {
      return capturedAt;
    }

    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function formatDuration(durationMs) {
    if (typeof durationMs !== "number" || Number.isNaN(durationMs)) {
      return "unknown";
    }

    if (durationMs < 1) {
      return "<1 ms";
    }

    return `${Math.round(durationMs)} ms`;
  }

  function getMethodClass(method) {
    if (method === "GET") {
      return "method-get";
    }

    if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
      return "method-write";
    }

    return "method-other";
  }

  function getStatusClass(status) {
    if (typeof status !== "number") {
      return "status-unknown";
    }

    if (status >= 500) {
      return "status-server";
    }

    if (status >= 400) {
      return "status-client";
    }

    if (status >= 300) {
      return "status-redirect";
    }

    if (status >= 200) {
      return "status-success";
    }

    return "status-unknown";
  }

  function countEndpoints(entries) {
    const normalizer = globalScope.GladiumUrlNormalizer;
    if (!normalizer || typeof normalizer.deduplicateEntries !== "function") {
      return entries.length;
    }

    return normalizer.deduplicateEntries(entries).length;
  }

  function renderToolbar(entries) {
    elements.requestCount.textContent = String(entries.length);

    if (elements.endpointCount) {
      elements.endpointCount.textContent = String(countEndpoints(entries));
    }

    if (elements.exportButton) {
      elements.exportButton.disabled = !state.isSnapshot || state.isCapturingCookies;
    }

    if (state.isSnapshot) {
      const snapshotTime = formatSnapshotTime(state.snapshotTime);
      const snapshotSuffix = snapshotTime ? ` at ${snapshotTime}` : "";
      elements.snapshotButton.textContent = "Resume Live";
      elements.snapshotButton.classList.add("snapshot-active");
      elements.liveIndicator.textContent = `Snapshot frozen${snapshotSuffix}`;
      return;
    }

    elements.snapshotButton.textContent = "Take Snapshot";
    elements.snapshotButton.classList.remove("snapshot-active");
    elements.liveIndicator.textContent = "Live updates enabled";
  }

  function renderList(entries) {
    elements.requestList.innerHTML = "";

    if (!entries.length) {
      elements.requestList.innerHTML =
        '<div class="empty-state">No requests captured yet. Trigger network activity to populate the list.</div>';
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const entry of entries) {
      const method = getMethod(entry);
      const status = getStatus(entry);
      const contentType = getContentType(entry);
      const score = getScore(entry);

      const row = document.createElement("button");
      row.type = "button";
      row.className = "request-row";
      row.setAttribute("role", "option");
      row.dataset.requestId = String(entry.id);
      row.setAttribute("aria-selected", state.selectedId === entry.id ? "true" : "false");

      if (state.selectedId === entry.id) {
        row.classList.add("active");
      }

      row.innerHTML = [
        '<div class="row-top">',
        `  <span class="method-chip ${getMethodClass(method)}">${escapeHtml(method)}</span>`,
        `  <span class="status-chip ${getStatusClass(status)}">${escapeHtml(formatStatusText(status, ""))}</span>`,
        `  <span class="content-type" title="${escapeHtml(contentType)}">${escapeHtml(contentType)}</span>`,
        `  <span class="score-chip">Score ${escapeHtml(score)}</span>`,
        "</div>",
        `  <p class="request-url" title="${escapeHtml(entry.request && entry.request.url ? entry.request.url : "")}">${escapeHtml(
          formatForList(entry.request && entry.request.url ? entry.request.url : "")
        )}</p>`,
      ].join("\n");

      row.addEventListener("click", () => {
        state.selectedId = entry.id;
        render();
      });

      fragment.appendChild(row);
    }

    elements.requestList.appendChild(fragment);
  }

  function renderDetails(entries) {
    const selectedEntry = entries.find((entry) => entry.id === state.selectedId) || null;

    if (!selectedEntry) {
      elements.requestDetails.innerHTML =
        '<div class="empty-state">Select a request to inspect headers, request body, and response body.</div>';
      return;
    }

    const requestUrl =
      selectedEntry.request && typeof selectedEntry.request.url === "string"
        ? selectedEntry.request.url
        : "(no URL)";

    const epKey = getEndpointKey(selectedEntry);

    const method = getMethod(selectedEntry);
    const status = getStatus(selectedEntry);
    const contentType = getContentType(selectedEntry);
    const score = getScore(selectedEntry);

    const responseBody =
      selectedEntry.response && typeof selectedEntry.response.body === "string"
        ? formatAsPrettyJson(selectedEntry.response.body)
        : selectedEntry.response && selectedEntry.response.bodyCaptureError
          ? `Unable to capture body: ${selectedEntry.response.bodyCaptureError}`
          : "(empty)";

    const requestBody =
      selectedEntry.request && typeof selectedEntry.request.body === "string"
        ? formatAsPrettyJson(selectedEntry.request.body)
        : "(empty)";

    const requestHeaders = formatHeaders(
      selectedEntry.request && Array.isArray(selectedEntry.request.headers)
        ? selectedEntry.request.headers
        : []
    );

    const responseHeaders = formatHeaders(
      selectedEntry.response && Array.isArray(selectedEntry.response.headers)
        ? selectedEntry.response.headers
        : []
    );

    const statusLabel =
      selectedEntry.response && typeof selectedEntry.response.statusText === "string"
        ? selectedEntry.response.statusText
        : "";

    const capturedAt = formatCapturedAt(selectedEntry.capturedAt);
    const durationMs =
      selectedEntry.timing && typeof selectedEntry.timing.durationMs === "number"
        ? selectedEntry.timing.durationMs
        : null;

    const entrySchema = getEntrySchema(selectedEntry);
    const schemaJson = entrySchema
      ? JSON.stringify(entrySchema, null, 2)
      : "(schema unavailable)";

    elements.requestDetails.innerHTML = [
      '<section class="detail-summary">',
      `  <p class="summary-url">${escapeHtml(requestUrl)}</p>`,
      epKey ? `  <p class="summary-endpoint" title="Normalized endpoint key">${escapeHtml(epKey)}</p>` : "",
      '  <div class="summary-meta">',
      `    <span class="meta-chip">${escapeHtml(method)}</span>`,
      `    <span class="meta-chip">${escapeHtml(formatStatusText(status, statusLabel))}</span>`,
      `    <span class="meta-chip">${escapeHtml(contentType)}</span>`,
      `    <span class="meta-chip">Score ${escapeHtml(score)}</span>`,
      `    <span class="meta-chip">Captured ${escapeHtml(capturedAt)}</span>`,
      `    <span class="meta-chip">Duration ${escapeHtml(formatDuration(durationMs))}</span>`,
      "  </div>",
      "</section>",
      '<section class="detail-section">',
      "  <h3>Request Headers</h3>",
      `  <pre>${escapeHtml(requestHeaders)}</pre>`,
      "</section>",
      '<section class="detail-section">',
      "  <h3>Request Body</h3>",
      `  <pre>${escapeHtml(requestBody)}</pre>`,
      "</section>",
      '<section class="detail-section">',
      "  <h3>Response Headers</h3>",
      `  <pre>${escapeHtml(responseHeaders)}</pre>`,
      "</section>",
      '<section class="detail-section">',
      "  <h3>Response Body</h3>",
      `  <pre>${escapeHtml(responseBody)}</pre>`,
      "</section>",
      '<section class="detail-section">',
      "  <h3>Inferred Schema</h3>",
      `  <pre>${escapeHtml(schemaJson)}</pre>`,
      "</section>",
    ].join("\n");
  }

  function renderCookies() {
    if (!elements.cookieCount || !elements.cookieList) {
      return;
    }

    if (!state.isSnapshot) {
      elements.cookieCount.textContent = "0";
      elements.cookieList.innerHTML =
        '<div class="empty-state">Take a snapshot to capture cookies for the active tab domain.</div>';
      return;
    }

    elements.cookieCount.textContent = String(state.snapshotCookies.length);

    if (state.isCapturingCookies) {
      elements.cookieList.innerHTML =
        '<div class="empty-state">Capturing cookies for the active tab domain...</div>';
      return;
    }

    if (state.snapshotCookieError) {
      elements.cookieList.innerHTML = `<div class="empty-state">Unable to capture cookies: ${escapeHtml(
        state.snapshotCookieError
      )}</div>`;
      return;
    }

    if (!state.snapshotCookies.length) {
      const domainSuffix = state.snapshotCookieDomain
        ? ` (${escapeHtml(state.snapshotCookieDomain)})`
        : "";
      elements.cookieList.innerHTML = `<div class="empty-state">No cookies found for the active tab domain${domainSuffix}.</div>`;
      return;
    }

    const rows = state.snapshotCookies.map((cookie) => {
      const name = cookie && typeof cookie.name === "string" && cookie.name.length > 0
        ? cookie.name
        : "(unnamed)";
      const value = cookie && typeof cookie.value === "string" && cookie.value.length > 0
        ? cookie.value
        : "(empty)";
      const domain = cookie && typeof cookie.domain === "string" && cookie.domain.length > 0
        ? cookie.domain
        : "(unknown domain)";
      const flags = formatCookieFlags(cookie);

      return [
        '<article class="cookie-row">',
        `  <p class="cookie-name">${escapeHtml(name)}</p>`,
        `  <p class="cookie-value">${escapeHtml(value)}</p>`,
        `  <p class="cookie-meta">Domain: ${escapeHtml(domain)}</p>`,
        `  <p class="cookie-meta">Flags: ${escapeHtml(flags)}</p>`,
        "</article>",
      ].join("\n");
    });

    elements.cookieList.innerHTML = rows.join("\n");
  }

  async function captureSnapshotCookies(captureId) {
    const scope = await getActiveTabCookieScope();
    if (!state.isSnapshot || captureId !== state.snapshotCaptureId) {
      return;
    }

    if (!scope || (!scope.domain && !scope.url)) {
      state.snapshotCookieDomain = null;
      state.snapshotCookieError = "active tab domain unavailable";
      state.snapshotCookies = [];
      state.isCapturingCookies = false;
      render();
      return;
    }

    const cookieResult = await getCookiesForScope(scope);
    if (!state.isSnapshot || captureId !== state.snapshotCaptureId) {
      return;
    }

    state.snapshotCookieDomain = scope.domain;
    state.snapshotCookies = sortCookies(cookieResult.cookies);
    state.snapshotCookieError = cookieResult.error;
    state.isCapturingCookies = false;
    render();
  }

  function onExportSnapshotClick() {
    if (!state.isSnapshot || state.isCapturingCookies) {
      return;
    }

    const payload = buildSnapshotExportPayload();
    const json = JSON.stringify(payload, null, 2);
    const fileName = buildSnapshotFilename(state.snapshotTime);

    try {
      downloadTextFile(fileName, json);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      elements.liveIndicator.textContent = `Export failed: ${errorMessage}`;
    }
  }

  function render() {
    const entries = getDisplayEntries();
    ensureValidSelection(entries);
    renderToolbar(entries);
    renderList(entries);
    renderDetails(entries);
    renderCookies();
  }

  function loadEntriesFromRecorder() {
    const recorder = globalScope.GladiumRequestRecorder;
    if (!recorder || typeof recorder.getEntries !== "function") {
      return;
    }

    state.liveEntries = sortByScore(recorder.getEntries());

    if (state.isSnapshot) {
      return;
    }

    const signature = getListSignature(state.liveEntries);
    if (signature === state.lastListSignature) {
      return;
    }

    state.lastListSignature = signature;
    render();
  }

  function onSnapshotToggleClick() {
    if (state.isSnapshot) {
      state.isSnapshot = false;
      state.snapshotEntries = [];
      state.snapshotCookies = [];
      state.snapshotCookieDomain = null;
      state.snapshotCookieError = null;
      state.isCapturingCookies = false;
      state.snapshotCaptureId += 1;
      state.snapshotTime = null;
      state.lastListSignature = "";
      render();
      return;
    }

    const captureId = state.snapshotCaptureId + 1;
    state.snapshotCaptureId = captureId;
    state.isSnapshot = true;
    state.snapshotTime = new Date();
    state.snapshotEntries = state.liveEntries.slice();
    state.snapshotCookies = [];
    state.snapshotCookieDomain = null;
    state.snapshotCookieError = null;
    state.isCapturingCookies = true;
    render();
    captureSnapshotCookies(captureId);
  }

  function startPolling() {
    loadEntriesFromRecorder();
    render();

    globalScope.setInterval(() => {
      loadEntriesFromRecorder();
    }, POLL_INTERVAL_MS);
  }

  function init() {
    if (!elements.snapshotButton) {
      return;
    }

    elements.snapshotButton.addEventListener("click", onSnapshotToggleClick);

    if (elements.exportButton) {
      elements.exportButton.addEventListener("click", onExportSnapshotClick);
    }

    if (!globalScope.GladiumRequestRecorder) {
      elements.liveIndicator.textContent = "Recorder unavailable in this context.";
    }

    startPolling();
  }

  init();
})(window);
