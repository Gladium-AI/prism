(function initPanel(globalScope) {
  var POLL_INTERVAL_MS = 400;
  var STORAGE_KEY_MEDIA_FILTER = "gladium_hideMediaEndpoints";

  function loadMediaFilterPreference() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY_MEDIA_FILTER);
      if (stored === null) {
        return true;
      }
      return stored !== "false";
    } catch (e) {
      return true;
    }
  }

  function saveMediaFilterPreference(value) {
    try {
      localStorage.setItem(STORAGE_KEY_MEDIA_FILTER, String(value));
    } catch (e) {
      // silently ignore storage errors
    }
  }

  var elements = {
    snapshotButton: document.getElementById("snapshot-toggle"),
    exportButton: document.getElementById("snapshot-export"),
    mapExportButton: document.getElementById("map-export"),
    mediaFilterButton: document.getElementById("media-filter"),
    selectAllButton: document.getElementById("select-all"),
    selectNoneButton: document.getElementById("select-none"),
    liveIndicator: document.getElementById("live-indicator"),
    requestCount: document.getElementById("request-count"),
    endpointCount: document.getElementById("endpoint-count"),
    endpointList: document.getElementById("endpoint-list"),
    endpointDetails: document.getElementById("endpoint-details"),
    cookieCount: document.getElementById("cookie-count"),
    cookieList: document.getElementById("cookie-list"),
  };

  var state = {
    isSnapshot: false,
    snapshotTime: null,
    selectedEndpointKey: null,
    checkedEndpointKeys: {},
    hideMediaEndpoints: loadMediaFilterPreference(),
    liveEntries: [],
    snapshotEntries: [],
    snapshotCookies: [],
    snapshotCookieDomain: null,
    snapshotCookieError: null,
    isCapturingCookies: false,
    snapshotCaptureId: 0,
    lastListSignature: "",
  };

  // ── Utility ──────────────────────────────────────────────

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

  function sortByScore(entries) {
    return entries.slice().sort(function (left, right) {
      var scoreDifference = getScore(right) - getScore(left);
      if (scoreDifference !== 0) {
        return scoreDifference;
      }
      return (right.id || 0) - (left.id || 0);
    });
  }

  function getMethodClass(method) {
    if (method === "GET") {
      return "method-get";
    }
    if (
      method === "POST" ||
      method === "PUT" ||
      method === "PATCH" ||
      method === "DELETE"
    ) {
      return "method-write";
    }
    return "method-other";
  }

  function getDisplayEntries() {
    return state.isSnapshot ? state.snapshotEntries : state.liveEntries;
  }

  // ── Media filtering ────────────────────────────────────────

  var MEDIA_CONTENT_TYPE_PREFIXES = ["image/", "video/", "audio/", "font/"];

  var MEDIA_URL_EXTENSIONS = [
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp",
    ".tiff", ".tif", ".avif", ".heic", ".heif", ".cur",
    ".mp4", ".webm", ".ogg", ".avi", ".mov", ".mkv",
    ".mp3", ".wav", ".flac", ".aac", ".m4a",
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ];

  function isMediaContentType(contentType) {
    if (typeof contentType !== "string" || contentType.length === 0) {
      return false;
    }
    var lower = contentType.toLowerCase().split(";")[0].trim();
    for (var i = 0; i < MEDIA_CONTENT_TYPE_PREFIXES.length; i++) {
      if (lower.indexOf(MEDIA_CONTENT_TYPE_PREFIXES[i]) === 0) {
        return true;
      }
    }
    return false;
  }

  function getUrlExtension(url) {
    if (typeof url !== "string") {
      return "";
    }
    try {
      var pathname = new URL(url).pathname;
      var lastDot = pathname.lastIndexOf(".");
      if (lastDot === -1) {
        return "";
      }
      return pathname.substring(lastDot).toLowerCase();
    } catch (e) {
      return "";
    }
  }

  function isMediaEntry(entry) {
    var response = entry && entry.response ? entry.response : {};
    if (isMediaContentType(response.contentType)) {
      return true;
    }
    var request = entry && entry.request ? entry.request : {};
    var ext = getUrlExtension(request.url);
    if (ext) {
      for (var i = 0; i < MEDIA_URL_EXTENSIONS.length; i++) {
        if (ext === MEDIA_URL_EXTENSIONS[i]) {
          return true;
        }
      }
    }
    return false;
  }

  function filterMediaEntries(entries) {
    if (!state.hideMediaEndpoints) {
      return entries;
    }
    var filtered = [];
    for (var i = 0; i < entries.length; i++) {
      if (!isMediaEntry(entries[i])) {
        filtered.push(entries[i]);
      }
    }
    return filtered;
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

  // ── Endpoint grouping ────────────────────────────────────

  function getEndpointGroups(entries) {
    var normalizer = globalScope.GladiumUrlNormalizer;
    if (!normalizer || typeof normalizer.deduplicateEntries !== "function") {
      return [];
    }
    return normalizer.deduplicateEntries(entries);
  }

  function sortGroups(groups) {
    return groups.slice().sort(function (a, b) {
      var aMax = 0;
      var bMax = 0;
      for (var i = 0; i < a.entries.length; i++) {
        var s = getScore(a.entries[i]);
        if (s > aMax) { aMax = s; }
      }
      for (var j = 0; j < b.entries.length; j++) {
        var t = getScore(b.entries[j]);
        if (t > bMax) { bMax = t; }
      }
      if (bMax !== aMax) { return bMax - aMax; }
      if (b.entries.length !== a.entries.length) {
        return b.entries.length - a.entries.length;
      }
      return 0;
    });
  }

  function getMergedEndpointSchema(group) {
    var merger = globalScope.GladiumSchemaMerger;
    if (!merger || typeof merger.mergeEndpointGroup !== "function") {
      return null;
    }
    var result = merger.mergeEndpointGroup(group);
    return result ? result.schema : null;
  }

  function getCompactPath(normalizedUrl) {
    if (typeof normalizedUrl !== "string") {
      return "(unknown)";
    }
    try {
      var parsed = new URL(normalizedUrl);
      return parsed.pathname + parsed.search;
    } catch (e) {
      return normalizedUrl;
    }
  }

  // ── Schema rendering ─────────────────────────────────────

  function renderSchemaType(schema) {
    if (!schema) {
      return escapeHtml("unknown");
    }

    if (schema.type === "mixed" && Array.isArray(schema.variants)) {
      var parts = [];
      for (var i = 0; i < schema.variants.length; i++) {
        parts.push(escapeHtml(schema.variants[i]));
      }
      return parts.join('<span class="schema-punct"> | </span>');
    }

    if (schema.type === "array") {
      if (schema.items) {
        return (
          escapeHtml("array") +
          '<span class="schema-punct">&lt;</span>' +
          renderSchemaType(schema.items) +
          '<span class="schema-punct">&gt;</span>'
        );
      }
      return escapeHtml("array");
    }

    return '<span class="schema-type-name">' + escapeHtml(schema.type) + "</span>";
  }

  function renderSchemaFields(schema, depth) {
    if (!schema || schema.type !== "object" || !schema.fields) {
      return "";
    }

    if (depth > 4) {
      return '<div class="schema-field schema-depth-limit">...</div>';
    }

    var keys = Object.keys(schema.fields);
    if (keys.length === 0) {
      return '<div class="schema-field schema-empty">(empty object)</div>';
    }

    var html = [];
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var field = schema.fields[key];
      var isOptional = field && field.optional;

      var line = '<div class="schema-field">';
      line += '<span class="schema-key">' + escapeHtml(key) + "</span>";
      line += '<span class="schema-punct">: </span>';
      line += '<span class="schema-type">' + renderSchemaType(field) + "</span>";
      if (isOptional) {
        line += ' <span class="schema-optional">optional</span>';
      }
      line += "</div>";
      html.push(line);

      if (field && field.type === "object" && field.fields) {
        html.push(
          '<div class="schema-indent">' +
            renderSchemaFields(field, depth + 1) +
            "</div>"
        );
      }

      if (
        field &&
        field.type === "array" &&
        field.items &&
        field.items.type === "object" &&
        field.items.fields
      ) {
        html.push(
          '<div class="schema-indent">' +
            renderSchemaFields(field.items, depth + 1) +
            "</div>"
        );
      }
    }

    return html.join("\n");
  }

  function renderBodySchema(bodySchema) {
    if (!bodySchema) {
      return '<div class="schema-note">No body detected</div>';
    }

    var contentLabel = bodySchema.contentType || "unknown";
    var html =
      '<div class="schema-content-type">' + escapeHtml(contentLabel) + "</div>";

    if (!bodySchema.schema) {
      if (bodySchema.parseError) {
        html +=
          '<div class="schema-error">Parse error: ' +
          escapeHtml(bodySchema.parseError) +
          "</div>";
      } else if (bodySchema.contentType === "opaque") {
        html += '<div class="schema-note">Non-structured body</div>';
      }
      return html;
    }

    var schema = bodySchema.schema;

    if (schema.type === "object" && schema.fields) {
      html +=
        '<div class="schema-tree">' + renderSchemaFields(schema, 0) + "</div>";
    } else if (schema.type === "array") {
      html += '<div class="schema-tree">';
      html +=
        '<div class="schema-field"><span class="schema-type">' +
        renderSchemaType(schema) +
        "</span></div>";
      if (
        schema.items &&
        schema.items.type === "object" &&
        schema.items.fields
      ) {
        html +=
          '<div class="schema-indent">' +
          renderSchemaFields(schema.items, 1) +
          "</div>";
      }
      html += "</div>";
    } else {
      html +=
        '<div class="schema-tree"><div class="schema-field"><span class="schema-type">' +
        renderSchemaType(schema) +
        "</span></div></div>";
    }

    return html;
  }

  function renderHeadersSchema(headersSchema, showAuthOnly) {
    if (
      !headersSchema ||
      !Array.isArray(headersSchema.fields) ||
      headersSchema.fields.length === 0
    ) {
      return showAuthOnly ? "" : '<div class="schema-note">No headers</div>';
    }

    var fields = headersSchema.fields;

    if (showAuthOnly) {
      var authFields = [];
      for (var f = 0; f < fields.length; f++) {
        if (fields[f].isAuth) {
          authFields.push(fields[f]);
        }
      }
      fields = authFields;
      if (fields.length === 0) {
        return "";
      }
    }

    var html = ['<table class="headers-table">'];
    html.push("<thead><tr><th>Header</th><th>Type</th><th></th></tr></thead>");
    html.push("<tbody>");

    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      var rowClass = field.isAuth ? "auth-row" : "";

      html.push('<tr class="' + rowClass + '">');
      html.push('<td class="header-name">' + escapeHtml(field.name));
      if (field.isAuth) {
        html.push(' <span class="auth-badge">AUTH</span>');
      }
      html.push("</td>");
      html.push(
        '<td class="header-type">' +
          escapeHtml(field.valueType || "unknown") +
          "</td>"
      );
      html.push('<td class="header-meta">');
      if (field.optional) {
        html.push('<span class="schema-optional">optional</span>');
      }
      if (typeof field.seenCount === "number") {
        html.push(
          ' <span class="seen-count">' + field.seenCount + "&times;</span>"
        );
      }
      html.push("</td>");
      html.push("</tr>");
    }

    html.push("</tbody></table>");
    return html.join("\n");
  }

  // ── Selection ────────────────────────────────────────────

  function ensureValidSelection(groups) {
    if (!groups.length) {
      state.selectedEndpointKey = null;
      return;
    }

    var exists = false;
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].endpointKey === state.selectedEndpointKey) {
        exists = true;
        break;
      }
    }

    if (!exists) {
      state.selectedEndpointKey = groups[0].endpointKey;
    }
  }

  function getListSignature(groups, totalEntries) {
    if (!groups.length) {
      return "empty";
    }
    return groups.length + ":" + totalEntries + ":" + groups[0].endpointKey;
  }

  function syncCheckedKeys(groups) {
    // Auto-check any new endpoint keys, keep existing checked state
    for (var i = 0; i < groups.length; i++) {
      var key = groups[i].endpointKey;
      if (!(key in state.checkedEndpointKeys)) {
        state.checkedEndpointKeys[key] = true;
      }
    }
    // Remove stale keys no longer present
    var validKeys = {};
    for (var j = 0; j < groups.length; j++) {
      validKeys[groups[j].endpointKey] = true;
    }
    var allKeys = Object.keys(state.checkedEndpointKeys);
    for (var k = 0; k < allKeys.length; k++) {
      if (!validKeys[allKeys[k]]) {
        delete state.checkedEndpointKeys[allKeys[k]];
      }
    }
  }

  function getCheckedCount() {
    var keys = Object.keys(state.checkedEndpointKeys);
    var count = 0;
    for (var i = 0; i < keys.length; i++) {
      if (state.checkedEndpointKeys[keys[i]]) {
        count++;
      }
    }
    return count;
  }

  function setAllChecked(value) {
    var keys = Object.keys(state.checkedEndpointKeys);
    for (var i = 0; i < keys.length; i++) {
      state.checkedEndpointKeys[keys[i]] = value;
    }
  }

  // ── Render: Toolbar ──────────────────────────────────────

  function renderToolbar(entries, groups) {
    elements.requestCount.textContent = entries.length + " obs";

    if (elements.endpointCount) {
      elements.endpointCount.textContent = String(groups.length);
    }

    if (elements.exportButton) {
      elements.exportButton.disabled =
        !state.isSnapshot || state.isCapturingCookies;
    }

    if (elements.mapExportButton) {
      elements.mapExportButton.disabled = getCheckedCount() === 0;
    }

    if (elements.mediaFilterButton) {
      if (state.hideMediaEndpoints) {
        elements.mediaFilterButton.textContent = "Hide Media";
        elements.mediaFilterButton.classList.add("media-filter-active");
      } else {
        elements.mediaFilterButton.textContent = "Show Media";
        elements.mediaFilterButton.classList.remove("media-filter-active");
      }
    }

    if (state.isSnapshot) {
      var snapshotTime = formatSnapshotTime(state.snapshotTime);
      var snapshotSuffix = snapshotTime ? " at " + snapshotTime : "";
      elements.snapshotButton.textContent = "Resume Live";
      elements.snapshotButton.classList.add("snapshot-active");
      elements.liveIndicator.textContent = "Snapshot frozen" + snapshotSuffix;
      return;
    }

    elements.snapshotButton.textContent = "Take Snapshot";
    elements.snapshotButton.classList.remove("snapshot-active");
    elements.liveIndicator.textContent = "Live updates enabled";
  }

  // ── Render: Endpoint List ────────────────────────────────

  function renderEndpointList(groups) {
    elements.endpointList.innerHTML = "";

    if (!groups.length) {
      elements.endpointList.innerHTML =
        '<div class="empty-state">No endpoints discovered yet. Trigger network activity to populate the map.</div>';
      return;
    }

    var fragment = document.createDocumentFragment();

    for (var i = 0; i < groups.length; i++) {
      var group = groups[i];
      var method = group.method || "GET";
      var path = getCompactPath(group.normalizedUrl);
      var obsCount = group.entries.length;
      var isSelected = state.selectedEndpointKey === group.endpointKey;
      var isChecked = state.checkedEndpointKeys[group.endpointKey] === true;

      var row = document.createElement("div");
      row.className = "endpoint-row" + (isSelected ? " active" : "");
      row.setAttribute("role", "option");
      row.dataset.endpointKey = group.endpointKey;
      row.setAttribute("aria-selected", isSelected ? "true" : "false");

      var mergedSchema = getMergedEndpointSchema(group);
      var hasAuth = false;
      if (
        mergedSchema &&
        mergedSchema.request &&
        mergedSchema.request.headers
      ) {
        var reqFields = mergedSchema.request.headers.fields || [];
        for (var j = 0; j < reqFields.length; j++) {
          if (reqFields[j].isAuth) {
            hasAuth = true;
            break;
          }
        }
      }

      var authIcon = hasAuth
        ? ' <span class="auth-indicator" title="Uses authentication">\uD83D\uDD11</span>'
        : "";

      row.innerHTML = [
        '<div class="row-top">',
        '  <input type="checkbox" class="endpoint-checkbox"' +
          (isChecked ? " checked" : "") +
          ' title="Include in export" />',
        '  <span class="method-chip ' +
          getMethodClass(method) +
          '">' +
          escapeHtml(method) +
          "</span>",
        '  <span class="endpoint-path" title="' +
          escapeHtml(group.endpointKey) +
          '">' +
          escapeHtml(path) +
          authIcon +
          "</span>",
        '  <span class="obs-chip">' + obsCount + "</span>",
        "</div>",
      ].join("\n");

      (function (key) {
        var checkbox = row.querySelector(".endpoint-checkbox");
        checkbox.addEventListener("click", function (e) {
          e.stopPropagation();
          state.checkedEndpointKeys[key] = checkbox.checked;
          render();
        });
        row.addEventListener("click", function (e) {
          if (e.target === checkbox) {
            return;
          }
          state.selectedEndpointKey = key;
          render();
        });
      })(group.endpointKey);

      fragment.appendChild(row);
    }

    elements.endpointList.appendChild(fragment);
  }

  // ── Render: Endpoint Details ─────────────────────────────

  function renderEndpointDetails(groups) {
    var group = null;
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].endpointKey === state.selectedEndpointKey) {
        group = groups[i];
        break;
      }
    }

    if (!group) {
      elements.endpointDetails.innerHTML =
        '<div class="empty-state">Select an endpoint to inspect its schema, headers, and auth.</div>';
      return;
    }

    var method = group.method || "GET";
    var mergedSchema = getMergedEndpointSchema(group);
    var obsCount = group.entries.length;
    var displayUrl = group.normalizedUrl || group.endpointKey;

    var sections = [];

    // Summary banner
    sections.push('<section class="detail-summary">');
    sections.push('  <div class="summary-meta">');
    sections.push(
      '    <span class="meta-chip ' +
        getMethodClass(method) +
        '">' +
        escapeHtml(method) +
        "</span>"
    );
    sections.push(
      '    <span class="meta-chip">' +
        obsCount +
        " observation" +
        (obsCount !== 1 ? "s" : "") +
        "</span>"
    );
    sections.push("  </div>");
    sections.push(
      '  <p class="summary-url">' + escapeHtml(displayUrl) + "</p>"
    );
    sections.push("</section>");

    if (mergedSchema) {
      // Auth headers
      var authHtml = renderHeadersSchema(mergedSchema.request.headers, true);
      if (authHtml) {
        sections.push('<section class="detail-section">');
        sections.push("  <h3>Authentication</h3>");
        sections.push('  <div class="section-body">' + authHtml + "</div>");
        sections.push("</section>");
      }

      // Request headers
      var reqHeadersHtml = renderHeadersSchema(
        mergedSchema.request.headers,
        false
      );
      sections.push('<section class="detail-section">');
      sections.push("  <h3>Request Headers</h3>");
      sections.push(
        '  <div class="section-body">' + reqHeadersHtml + "</div>"
      );
      sections.push("</section>");

      // Request body schema
      sections.push('<section class="detail-section">');
      sections.push("  <h3>Request Body</h3>");
      sections.push(
        '  <div class="section-body">' +
          renderBodySchema(mergedSchema.request.body) +
          "</div>"
      );
      sections.push("</section>");

      // Response headers
      var resHeadersHtml = renderHeadersSchema(
        mergedSchema.response.headers,
        false
      );
      sections.push('<section class="detail-section">');
      sections.push("  <h3>Response Headers</h3>");
      sections.push(
        '  <div class="section-body">' + resHeadersHtml + "</div>"
      );
      sections.push("</section>");

      // Response body schema
      sections.push('<section class="detail-section">');
      sections.push("  <h3>Response Body</h3>");
      sections.push(
        '  <div class="section-body">' +
          renderBodySchema(mergedSchema.response.body) +
          "</div>"
      );
      sections.push("</section>");
    } else {
      sections.push(
        '<div class="empty-state">Schema inference unavailable</div>'
      );
    }

    elements.endpointDetails.innerHTML = sections.join("\n");
  }

  // ── Cookies ──────────────────────────────────────────────

  function formatCookieFlags(cookie) {
    var flags = [];

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
    if (
      cookie &&
      typeof cookie.sameSite === "string" &&
      cookie.sameSite !== "unspecified"
    ) {
      flags.push("SameSite=" + cookie.sameSite);
    }
    if (cookie && cookie.partitionKey) {
      flags.push("Partitioned");
    }

    if (!flags.length) {
      return "None";
    }

    return flags.join(", ");
  }

  function sortCookies(cookies) {
    return cookies.slice().sort(function (left, right) {
      var leftName =
        left && typeof left.name === "string" ? left.name : "";
      var rightName =
        right && typeof right.name === "string" ? right.name : "";
      var nameOrder = leftName.localeCompare(rightName);
      if (nameOrder !== 0) {
        return nameOrder;
      }
      var leftDomain =
        left && typeof left.domain === "string" ? left.domain : "";
      var rightDomain =
        right && typeof right.domain === "string" ? right.domain : "";
      return leftDomain.localeCompare(rightDomain);
    });
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
      elements.cookieList.innerHTML =
        '<div class="empty-state">Unable to capture cookies: ' +
        escapeHtml(state.snapshotCookieError) +
        "</div>";
      return;
    }

    if (!state.snapshotCookies.length) {
      var domainSuffix = state.snapshotCookieDomain
        ? " (" + escapeHtml(state.snapshotCookieDomain) + ")"
        : "";
      elements.cookieList.innerHTML =
        '<div class="empty-state">No cookies found for the active tab domain' +
        domainSuffix +
        ".</div>";
      return;
    }

    var rows = [];
    for (var i = 0; i < state.snapshotCookies.length; i++) {
      var cookie = state.snapshotCookies[i];
      var name =
        cookie && typeof cookie.name === "string" && cookie.name.length > 0
          ? cookie.name
          : "(unnamed)";
      var value =
        cookie && typeof cookie.value === "string" && cookie.value.length > 0
          ? cookie.value
          : "(empty)";
      var domain =
        cookie &&
        typeof cookie.domain === "string" &&
        cookie.domain.length > 0
          ? cookie.domain
          : "(unknown domain)";
      var flags = formatCookieFlags(cookie);

      rows.push(
        [
          '<article class="cookie-row">',
          '  <p class="cookie-name">' + escapeHtml(name) + "</p>",
          '  <p class="cookie-value">' + escapeHtml(value) + "</p>",
          '  <p class="cookie-meta">Domain: ' + escapeHtml(domain) + "</p>",
          '  <p class="cookie-meta">Flags: ' + escapeHtml(flags) + "</p>",
          "</article>",
        ].join("\n")
      );
    }

    elements.cookieList.innerHTML = rows.join("\n");
  }

  // ── Cookie capture ───────────────────────────────────────

  function getHostnameFromUrl(url) {
    if (typeof url !== "string" || url.length === 0) {
      return null;
    }
    try {
      return new URL(url).hostname || null;
    } catch (e) {
      return null;
    }
  }

  function getHttpUrl(url) {
    if (typeof url !== "string" || url.length === 0) {
      return null;
    }
    try {
      var parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }
      return parsed.toString();
    } catch (e) {
      return null;
    }
  }

  function getUrlFromEntries(entries) {
    for (var i = 0; i < entries.length; i++) {
      var candidate = getHttpUrl(
        entries[i] && entries[i].request ? entries[i].request.url : null
      );
      if (candidate) {
        return candidate;
      }
    }
    return null;
  }

  function getDomainFromEntries(entries) {
    for (var i = 0; i < entries.length; i++) {
      var domain = getHostnameFromUrl(
        entries[i] && entries[i].request ? entries[i].request.url : null
      );
      if (domain) {
        return domain;
      }
    }
    return null;
  }

  function evaluateInInspectedWindow(expression) {
    return new Promise(function (resolve) {
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
        chrome.devtools.inspectedWindow.eval(
          expression,
          function (value, exceptionInfo) {
            if (exceptionInfo && exceptionInfo.isException) {
              resolve({
                value: null,
                error:
                  exceptionInfo.value || "inspectedWindow eval failed",
              });
              return;
            }

            var runtimeError =
              chrome.runtime && chrome.runtime.lastError
                ? chrome.runtime.lastError.message
                : null;
            resolve({
              value: runtimeError ? null : value,
              error: runtimeError,
            });
          }
        );
      } catch (error) {
        resolve({
          value: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  function getActiveTabCookieScope() {
    return evaluateInInspectedWindow("window.location.href").then(
      function (evalResult) {
        var inspectedUrl = getHttpUrl(evalResult.value);
        if (inspectedUrl) {
          return {
            domain: getHostnameFromUrl(inspectedUrl),
            url: inspectedUrl,
          };
        }

        var fallbackUrl = getUrlFromEntries(state.liveEntries);
        return {
          domain: fallbackUrl
            ? getHostnameFromUrl(fallbackUrl)
            : getDomainFromEntries(state.liveEntries),
          url: fallbackUrl,
        };
      }
    );
  }

  function getCookiesByFilter(filter) {
    return new Promise(function (resolve) {
      if (
        typeof chrome === "undefined" ||
        !chrome.cookies ||
        typeof chrome.cookies.getAll !== "function"
      ) {
        resolve({ cookies: [], error: "cookies API unavailable" });
        return;
      }

      try {
        chrome.cookies.getAll(filter, function (cookies) {
          var runtimeError =
            chrome.runtime && chrome.runtime.lastError
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

  function getCookiesForScope(scope) {
    var filters = [];
    if (
      scope &&
      typeof scope.domain === "string" &&
      scope.domain.length > 0
    ) {
      filters.push({ domain: scope.domain });
    }
    if (scope && typeof scope.url === "string" && scope.url.length > 0) {
      filters.push({ url: scope.url });
    }

    if (!filters.length) {
      return Promise.resolve({
        cookies: [],
        error: "active tab domain unavailable",
      });
    }

    var seen = {};
    var mergedCookies = [];
    var firstError = null;
    var hasSuccessfulQuery = false;

    function processFilter(index) {
      if (index >= filters.length) {
        return Promise.resolve({
          cookies: mergedCookies,
          error: hasSuccessfulQuery ? null : firstError,
        });
      }

      return getCookiesByFilter(filters[index]).then(function (result) {
        if (result.error) {
          if (!firstError) {
            firstError = result.error;
          }
        } else {
          hasSuccessfulQuery = true;
          for (var c = 0; c < result.cookies.length; c++) {
            var cookie = result.cookies[c];
            var partitionKey =
              cookie && cookie.partitionKey
                ? JSON.stringify(cookie.partitionKey)
                : "";
            var key = [
              cookie && cookie.name ? cookie.name : "",
              cookie && cookie.domain ? cookie.domain : "",
              cookie && cookie.path ? cookie.path : "",
              cookie && cookie.storeId ? cookie.storeId : "",
              partitionKey,
            ].join("|");
            if (!seen[key]) {
              seen[key] = true;
              mergedCookies.push(cookie);
            }
          }
        }
        return processFilter(index + 1);
      });
    }

    return processFilter(0);
  }

  function captureSnapshotCookies(captureId) {
    getActiveTabCookieScope().then(function (scope) {
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

      getCookiesForScope(scope).then(function (cookieResult) {
        if (!state.isSnapshot || captureId !== state.snapshotCaptureId) {
          return;
        }

        state.snapshotCookieDomain = scope.domain;
        state.snapshotCookies = sortCookies(cookieResult.cookies);
        state.snapshotCookieError = cookieResult.error;
        state.isCapturingCookies = false;
        render();
      });
    });
  }

  // ── Export ────────────────────────────────────────────────

  function normalizeHeaders(headers) {
    if (!Array.isArray(headers)) {
      return [];
    }
    var result = [];
    for (var i = 0; i < headers.length; i++) {
      var header = headers[i];
      if (!header || typeof header.name !== "string") {
        continue;
      }
      result.push({
        name: header.name,
        value: header.value !== undefined ? String(header.value) : "",
      });
    }
    return result;
  }

  function serializeScore(score) {
    return {
      total: score && typeof score.total === "number" ? score.total : 0,
      normalized:
        score && typeof score.normalized === "number"
          ? score.normalized
          : null,
      reasons: score && Array.isArray(score.reasons) ? score.reasons : [],
    };
  }

  function getEndpointKey(entry) {
    var normalizer = globalScope.GladiumUrlNormalizer;
    if (!normalizer || typeof normalizer.endpointKey !== "function") {
      return null;
    }
    var request = entry && entry.request ? entry.request : {};
    return normalizer.endpointKey(request.method, request.url);
  }

  function getEntrySchema(entry) {
    var inferrer = globalScope.GladiumSchemaInferrer;
    if (!inferrer || typeof inferrer.inferSchema !== "function") {
      return null;
    }
    return inferrer.inferSchema(entry);
  }

  function serializeRequestForExport(entry) {
    var request = entry && entry.request ? entry.request : {};
    var response = entry && entry.response ? entry.response : {};
    var timing = entry && entry.timing ? entry.timing : {};

    return {
      id: entry && typeof entry.id === "number" ? entry.id : null,
      capturedAt:
        entry && typeof entry.capturedAt === "string"
          ? entry.capturedAt
          : null,
      endpointKey: getEndpointKey(entry),
      schema: getEntrySchema(entry),
      score: serializeScore(entry ? entry.score : null),
      request: {
        url: typeof request.url === "string" ? request.url : null,
        method:
          typeof request.method === "string"
            ? request.method.toUpperCase()
            : null,
        headers: normalizeHeaders(request.headers),
        body: typeof request.body === "string" ? request.body : null,
      },
      response: {
        status:
          typeof response.status === "number" ? response.status : null,
        statusText:
          typeof response.statusText === "string"
            ? response.statusText
            : null,
        headers: normalizeHeaders(response.headers),
        body: typeof response.body === "string" ? response.body : null,
        contentType:
          typeof response.contentType === "string"
            ? response.contentType
            : null,
        encoding:
          typeof response.encoding === "string" ? response.encoding : null,
        bodyCaptureError:
          typeof response.bodyCaptureError === "string"
            ? response.bodyCaptureError
            : null,
      },
      timing: {
        startedDateTime:
          typeof timing.startedDateTime === "string"
            ? timing.startedDateTime
            : null,
        durationMs:
          typeof timing.durationMs === "number" ? timing.durationMs : null,
      },
    };
  }

  function serializeCookieForExport(cookie) {
    var result = {
      name:
        cookie && typeof cookie.name === "string" ? cookie.name : "",
      value:
        cookie && typeof cookie.value === "string" ? cookie.value : "",
      domain:
        cookie && typeof cookie.domain === "string" ? cookie.domain : "",
      path:
        cookie && typeof cookie.path === "string" ? cookie.path : "",
      secure: Boolean(cookie && cookie.secure),
      httpOnly: Boolean(cookie && cookie.httpOnly),
      sameSite:
        cookie && typeof cookie.sameSite === "string"
          ? cookie.sameSite
          : "unspecified",
      session: Boolean(cookie && cookie.session),
      hostOnly: Boolean(cookie && cookie.hostOnly),
      storeId:
        cookie && typeof cookie.storeId === "string"
          ? cookie.storeId
          : "",
      expirationDate:
        cookie && typeof cookie.expirationDate === "number"
          ? cookie.expirationDate
          : null,
      partitionKey:
        cookie && cookie.partitionKey ? cookie.partitionKey : null,
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
    var date = snapshotTime instanceof Date ? snapshotTime : new Date();
    var yyyy = date.getFullYear();
    var mm = formatNumberForFilename(date.getMonth() + 1);
    var dd = formatNumberForFilename(date.getDate());
    var hh = formatNumberForFilename(date.getHours());
    var min = formatNumberForFilename(date.getMinutes());
    var ss = formatNumberForFilename(date.getSeconds());

    return (
      "gladium-snapshot-" + yyyy + mm + dd + "-" + hh + min + ss + ".json"
    );
  }

  function buildEndpointsSummary(entries) {
    var normalizer = globalScope.GladiumUrlNormalizer;
    if (!normalizer || typeof normalizer.deduplicateEntries !== "function") {
      return [];
    }

    var groups = normalizer.deduplicateEntries(entries);
    var summaries = [];

    for (var i = 0; i < groups.length; i++) {
      var group = groups[i];
      var scores = [];
      var requestIds = [];

      for (var j = 0; j < group.entries.length; j++) {
        scores.push(getScore(group.entries[j]));
        requestIds.push(
          group.entries[j] && typeof group.entries[j].id === "number"
            ? group.entries[j].id
            : null
        );
      }

      var maxScore = 0;
      for (var k = 0; k < scores.length; k++) {
        if (scores[k] > maxScore) {
          maxScore = scores[k];
        }
      }

      summaries.push({
        endpointKey: group.endpointKey,
        normalizedUrl: group.normalizedUrl,
        method: group.method,
        observationCount: group.entries.length,
        maxScore: maxScore,
        mergedSchema: getMergedEndpointSchema(group),
        requestIds: requestIds,
      });
    }

    return summaries;
  }

  function buildSnapshotExportPayload() {
    var endpoints = buildEndpointsSummary(state.snapshotEntries);

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
    var blob = new Blob([content], {
      type: "application/json;charset=utf-8",
    });
    var objectUrl = URL.createObjectURL(blob);
    var link = document.createElement("a");

    link.href = objectUrl;
    link.download = fileName;
    link.style.display = "none";

    document.body.appendChild(link);
    link.click();
    link.remove();

    globalScope.setTimeout(function () {
      URL.revokeObjectURL(objectUrl);
    }, 0);
  }

  function onExportSnapshotClick() {
    if (!state.isSnapshot || state.isCapturingCookies) {
      return;
    }

    var payload = buildSnapshotExportPayload();
    var json = JSON.stringify(payload, null, 2);
    var fileName = buildSnapshotFilename(state.snapshotTime);

    try {
      downloadTextFile(fileName, json);
    } catch (error) {
      var errorMessage =
        error instanceof Error ? error.message : String(error);
      elements.liveIndicator.textContent = "Export failed: " + errorMessage;
    }
  }

  // ── API Map export ───────────────────────────────────────

  function serializeHeaderForMap(field) {
    var entry = {
      name: field.name,
      type: field.valueType || "unknown",
    };
    if (field.optional) {
      entry.optional = true;
    }
    if (field.isAuth) {
      entry.authentication = true;
    }
    return entry;
  }

  function serializeSchemaForMap(schema) {
    if (!schema) {
      return null;
    }

    if (schema.type === "mixed" && Array.isArray(schema.variants)) {
      return { type: "mixed", variants: schema.variants };
    }

    if (schema.type === "array") {
      var arr = { type: "array" };
      if (schema.items) {
        arr.items = serializeSchemaForMap(schema.items);
      }
      return arr;
    }

    if (schema.type === "object" && schema.fields) {
      var fields = {};
      var keys = Object.keys(schema.fields);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var child = schema.fields[key];
        var serialized = serializeSchemaForMap(child);
        if (child && child.optional) {
          serialized.optional = true;
        }
        fields[key] = serialized;
      }
      return { type: "object", fields: fields };
    }

    return { type: schema.type || "unknown" };
  }

  function serializeBodyForMap(bodySchema) {
    if (!bodySchema) {
      return null;
    }

    var entry = {
      contentType: bodySchema.contentType || "unknown",
    };

    if (bodySchema.schema) {
      entry.schema = serializeSchemaForMap(bodySchema.schema);
    }

    return entry;
  }

  function buildMapExportPayload() {
    var entries = filterMediaEntries(getDisplayEntries());
    var groups = sortGroups(getEndpointGroups(entries));
    var endpoints = [];

    for (var i = 0; i < groups.length; i++) {
      var group = groups[i];
      if (!state.checkedEndpointKeys[group.endpointKey]) {
        continue;
      }
      var mergedSchema = getMergedEndpointSchema(group);
      var method = group.method || "GET";
      var url = group.normalizedUrl || group.endpointKey;

      var endpoint = {
        method: method,
        url: url,
        observations: group.entries.length,
      };

      if (mergedSchema) {
        // Auth headers
        var authHeaders = [];
        var reqFields =
          mergedSchema.request &&
          mergedSchema.request.headers &&
          Array.isArray(mergedSchema.request.headers.fields)
            ? mergedSchema.request.headers.fields
            : [];
        for (var a = 0; a < reqFields.length; a++) {
          if (reqFields[a].isAuth) {
            authHeaders.push({
              header: reqFields[a].name,
              type: reqFields[a].valueType || "string",
            });
          }
        }
        if (authHeaders.length > 0) {
          endpoint.authentication = authHeaders;
        }

        // Request
        var reqHeaders = [];
        for (var r = 0; r < reqFields.length; r++) {
          reqHeaders.push(serializeHeaderForMap(reqFields[r]));
        }

        endpoint.request = {
          headers: reqHeaders.length > 0 ? reqHeaders : null,
          body: serializeBodyForMap(mergedSchema.request.body),
        };

        // Response
        var resFields =
          mergedSchema.response &&
          mergedSchema.response.headers &&
          Array.isArray(mergedSchema.response.headers.fields)
            ? mergedSchema.response.headers.fields
            : [];
        var resHeaders = [];
        for (var s = 0; s < resFields.length; s++) {
          resHeaders.push(serializeHeaderForMap(resFields[s]));
        }

        endpoint.response = {
          headers: resHeaders.length > 0 ? resHeaders : null,
          body: serializeBodyForMap(mergedSchema.response.body),
        };
      }

      endpoints.push(endpoint);
    }

    return {
      format: "gladium-api-map-v1",
      exportedAt: new Date().toISOString(),
      endpointCount: endpoints.length,
      endpoints: endpoints,
    };
  }

  function buildMapFilename() {
    var date = new Date();
    var yyyy = date.getFullYear();
    var mm = formatNumberForFilename(date.getMonth() + 1);
    var dd = formatNumberForFilename(date.getDate());
    var hh = formatNumberForFilename(date.getHours());
    var min = formatNumberForFilename(date.getMinutes());
    var ss = formatNumberForFilename(date.getSeconds());

    return (
      "gladium-api-map-" + yyyy + mm + dd + "-" + hh + min + ss + ".json"
    );
  }

  function onMapExportClick() {
    var entries = getDisplayEntries();
    if (!entries.length) {
      return;
    }

    var payload = buildMapExportPayload();
    var json = JSON.stringify(payload, null, 2);
    var fileName = buildMapFilename();

    try {
      downloadTextFile(fileName, json);
    } catch (error) {
      var errorMessage =
        error instanceof Error ? error.message : String(error);
      elements.liveIndicator.textContent =
        "Map export failed: " + errorMessage;
    }
  }

  // ── Main render ──────────────────────────────────────────

  function render() {
    var entries = filterMediaEntries(getDisplayEntries());
    var groups = sortGroups(getEndpointGroups(entries));
    syncCheckedKeys(groups);
    ensureValidSelection(groups);
    renderToolbar(entries, groups);
    renderEndpointList(groups);
    renderEndpointDetails(groups);
    renderCookies();
  }

  // ── Polling + snapshot ───────────────────────────────────

  function loadEntriesFromRecorder() {
    var recorder = globalScope.GladiumRequestRecorder;
    if (!recorder || typeof recorder.getEntries !== "function") {
      return;
    }

    state.liveEntries = sortByScore(recorder.getEntries());

    if (state.isSnapshot) {
      return;
    }

    var filtered = filterMediaEntries(state.liveEntries);
    var groups = getEndpointGroups(filtered);
    var signature = getListSignature(groups, filtered.length);
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

    var captureId = state.snapshotCaptureId + 1;
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

    globalScope.setInterval(function () {
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

    if (elements.mapExportButton) {
      elements.mapExportButton.addEventListener("click", onMapExportClick);
    }

    if (elements.mediaFilterButton) {
      elements.mediaFilterButton.addEventListener("click", function () {
        state.hideMediaEndpoints = !state.hideMediaEndpoints;
        saveMediaFilterPreference(state.hideMediaEndpoints);
        state.lastListSignature = "";
        render();
      });
    }

    if (elements.selectAllButton) {
      elements.selectAllButton.addEventListener("click", function () {
        setAllChecked(true);
        render();
      });
    }

    if (elements.selectNoneButton) {
      elements.selectNoneButton.addEventListener("click", function () {
        setAllChecked(false);
        render();
      });
    }

    if (!globalScope.GladiumRequestRecorder) {
      elements.liveIndicator.textContent =
        "Recorder unavailable in this context.";
    }

    startPolling();
  }

  init();
})(window);
