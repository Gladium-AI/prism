(function initSchemaMerger(globalScope) {
  if (globalScope.GladiumSchemaMerger) {
    return;
  }

  function getInferrer() {
    return globalScope.GladiumSchemaInferrer || null;
  }

  // ── Header-schema merging ──────────────────────────────────────────

  function mergeHeadersSchemas(schemaList) {
    var fieldMap = Object.create(null);
    var fieldOrder = [];
    var totalObservations = schemaList.length;

    for (var i = 0; i < schemaList.length; i++) {
      var headerSchema = schemaList[i];
      if (!headerSchema || !Array.isArray(headerSchema.fields)) {
        continue;
      }

      var seenInThisObservation = Object.create(null);

      for (var j = 0; j < headerSchema.fields.length; j++) {
        var field = headerSchema.fields[j];
        if (!field || typeof field.name !== "string") {
          continue;
        }

        var lowerName = field.name.toLowerCase();
        seenInThisObservation[lowerName] = true;

        if (!(lowerName in fieldMap)) {
          fieldMap[lowerName] = {
            name: field.name,
            valueTypes: Object.create(null),
            isAuth: false,
            seenCount: 0,
          };
          fieldOrder.push(lowerName);
        }

        var entry = fieldMap[lowerName];
        entry.seenCount += 1;

        if (field.valueType) {
          entry.valueTypes[field.valueType] = true;
        }

        if (field.isAuth) {
          entry.isAuth = true;
        }
      }
    }

    var mergedFields = [];
    for (var k = 0; k < fieldOrder.length; k++) {
      var key = fieldOrder[k];
      var merged = fieldMap[key];
      var typeKeys = Object.keys(merged.valueTypes);
      var valueType = typeKeys.length === 1
        ? typeKeys[0]
        : typeKeys.length > 1
          ? typeKeys.join(" | ")
          : "unknown";

      mergedFields.push({
        name: merged.name,
        valueType: valueType,
        isAuth: merged.isAuth,
        optional: merged.seenCount < totalObservations,
        seenCount: merged.seenCount,
      });
    }

    return { fields: mergedFields };
  }

  // ── Body-schema merging ────────────────────────────────────────────

  function mergeBodySchemas(bodyList) {
    var inferrer = getInferrer();
    if (!inferrer || typeof inferrer.unifySchemas !== "function") {
      return bodyList.length > 0 ? bodyList[0] : null;
    }

    var nonNull = [];
    for (var i = 0; i < bodyList.length; i++) {
      if (bodyList[i] !== null && bodyList[i] !== undefined) {
        nonNull.push(bodyList[i]);
      }
    }

    if (nonNull.length === 0) {
      return null;
    }

    var contentType = nonNull[0].contentType || "unknown";
    var mergedSchema = nonNull[0].schema || null;

    for (var j = 1; j < nonNull.length; j++) {
      var current = nonNull[j];

      if (current.contentType && current.contentType !== contentType) {
        contentType = "mixed";
      }

      if (current.schema !== null && current.schema !== undefined) {
        if (mergedSchema === null) {
          mergedSchema = current.schema;
        } else {
          mergedSchema = inferrer.unifySchemas(mergedSchema, current.schema);
        }
      }
    }

    return {
      contentType: contentType,
      schema: mergedSchema,
    };
  }

  // ── Full request/response schema merging ───────────────────────────

  function mergeFullSchemas(schemaList) {
    var reqHeaders = [];
    var reqBodies = [];
    var resHeaders = [];
    var resBodies = [];

    for (var i = 0; i < schemaList.length; i++) {
      var schema = schemaList[i];
      if (!schema) {
        continue;
      }

      var req = schema.request || {};
      var res = schema.response || {};

      reqHeaders.push(req.headers || null);
      reqBodies.push(req.body || null);
      resHeaders.push(res.headers || null);
      resBodies.push(res.body || null);
    }

    var validReqHeaders = reqHeaders.filter(Boolean);
    var validResHeaders = resHeaders.filter(Boolean);

    return {
      request: {
        headers: validReqHeaders.length > 0
          ? mergeHeadersSchemas(validReqHeaders)
          : { fields: [] },
        body: mergeBodySchemas(reqBodies),
      },
      response: {
        headers: validResHeaders.length > 0
          ? mergeHeadersSchemas(validResHeaders)
          : { fields: [] },
        body: mergeBodySchemas(resBodies),
      },
    };
  }

  // ── Endpoint-level merging ─────────────────────────────────────────

  function mergeEndpointGroup(group) {
    var inferrer = getInferrer();
    if (!inferrer || typeof inferrer.inferSchema !== "function") {
      return null;
    }

    var entries = group && Array.isArray(group.entries) ? group.entries : [];
    if (entries.length === 0) {
      return null;
    }

    var schemas = [];
    for (var i = 0; i < entries.length; i++) {
      var schema = inferrer.inferSchema(entries[i]);
      if (schema) {
        schemas.push(schema);
      }
    }

    if (schemas.length === 0) {
      return null;
    }

    return {
      endpointKey: group.endpointKey || null,
      normalizedUrl: group.normalizedUrl || null,
      method: group.method || null,
      observationCount: entries.length,
      schema: mergeFullSchemas(schemas),
    };
  }

  function mergeAllEndpoints(endpointGroups) {
    var results = [];

    for (var i = 0; i < endpointGroups.length; i++) {
      var merged = mergeEndpointGroup(endpointGroups[i]);
      if (merged) {
        results.push(merged);
      }
    }

    return results;
  }

  globalScope.GladiumSchemaMerger = {
    mergeHeadersSchemas: mergeHeadersSchemas,
    mergeBodySchemas: mergeBodySchemas,
    mergeFullSchemas: mergeFullSchemas,
    mergeEndpointGroup: mergeEndpointGroup,
    mergeAllEndpoints: mergeAllEndpoints,
  };
})(window);
