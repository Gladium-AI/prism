(function initPanel(globalScope) {
  const POLL_INTERVAL_MS = 400;

  const elements = {
    snapshotButton: document.getElementById("snapshot-toggle"),
    liveIndicator: document.getElementById("live-indicator"),
    requestCount: document.getElementById("request-count"),
    requestList: document.getElementById("request-list"),
    requestDetails: document.getElementById("request-details"),
  };

  const state = {
    isSnapshot: false,
    snapshotTime: null,
    selectedId: null,
    liveEntries: [],
    snapshotEntries: [],
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

  function renderToolbar(entries) {
    elements.requestCount.textContent = String(entries.length);

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

    elements.requestDetails.innerHTML = [
      '<section class="detail-summary">',
      `  <p class="summary-url">${escapeHtml(requestUrl)}</p>`,
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
    ].join("\n");
  }

  function render() {
    const entries = getDisplayEntries();
    ensureValidSelection(entries);
    renderToolbar(entries);
    renderList(entries);
    renderDetails(entries);
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
      state.snapshotTime = null;
      state.lastListSignature = "";
      render();
      return;
    }

    state.isSnapshot = true;
    state.snapshotTime = new Date();
    state.snapshotEntries = state.liveEntries.slice();
    render();
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

    if (!globalScope.GladiumRequestRecorder) {
      elements.liveIndicator.textContent = "Recorder unavailable in this context.";
    }

    startPolling();
  }

  init();
})(window);
