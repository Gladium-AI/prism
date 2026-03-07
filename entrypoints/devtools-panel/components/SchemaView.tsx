import type { BodySchema, HeaderField, HeadersSchema, JsonSchema } from '@/core';

function SchemaTypeLabel({ schema }: { schema: JsonSchema | null | undefined }) {
  if (!schema) {
    return <span>unknown</span>;
  }

  if (schema.type === 'mixed' && Array.isArray(schema.variants)) {
    return (
      <>
        {schema.variants.map((variant, index) => (
          <span key={`${variant}-${index}`}>
            {index > 0 ? <span className="schema-punct"> | </span> : null}
            {variant}
          </span>
        ))}
      </>
    );
  }

  if (schema.type === 'array') {
    if (!schema.items) {
      return <span>array</span>;
    }
    return (
      <>
        array<span className="schema-punct">&lt;</span>
        <SchemaTypeLabel schema={schema.items} />
        <span className="schema-punct">&gt;</span>
      </>
    );
  }

  return <span className="schema-type-name">{schema.type}</span>;
}

function SchemaFields({ schema, depth }: { schema: JsonSchema; depth: number }) {
  if (schema.type !== 'object' || !schema.fields) {
    return null;
  }

  if (depth > 4) {
    return <div className="schema-field schema-depth-limit">...</div>;
  }

  const keys = Object.keys(schema.fields);
  if (keys.length === 0) {
    return <div className="schema-field schema-empty">(empty object)</div>;
  }

  return (
    <>
      {keys.map((key) => {
        const field = schema.fields[key];
        const showNestedObject = field?.type === 'object' && !!field.fields;
        const showNestedArrayObject =
          field?.type === 'array' && field.items?.type === 'object' && !!field.items.fields;

        return (
          <div key={key}>
            <div className="schema-field">
              <span className="schema-key">{key}</span>
              <span className="schema-punct">: </span>
              <span className="schema-type">
                <SchemaTypeLabel schema={field} />
              </span>
              {field?.optional ? <span className="schema-optional">optional</span> : null}
            </div>
            {showNestedObject ? (
              <div className="schema-indent">
                <SchemaFields schema={field} depth={depth + 1} />
              </div>
            ) : null}
            {showNestedArrayObject ? (
              <div className="schema-indent">
                <SchemaFields schema={field.items!} depth={depth + 1} />
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export function BodySchemaView({ bodySchema }: { bodySchema: BodySchema | null | undefined }) {
  if (!bodySchema) {
    return <div className="schema-note">No body detected</div>;
  }

  return (
    <>
      <div className="schema-content-type">{bodySchema.contentType || 'unknown'}</div>
      {!bodySchema.schema ? (
        bodySchema.parseError ? (
          <div className="schema-error">Parse error: {bodySchema.parseError}</div>
        ) : bodySchema.contentType === 'opaque' ? (
          <div className="schema-note">Non-structured body</div>
        ) : null
      ) : bodySchema.schema.type === 'object' ? (
        <div className="schema-tree">
          <SchemaFields schema={bodySchema.schema} depth={0} />
        </div>
      ) : bodySchema.schema.type === 'array' ? (
        <div className="schema-tree">
          <div className="schema-field">
            <span className="schema-type">
              <SchemaTypeLabel schema={bodySchema.schema} />
            </span>
          </div>
          {bodySchema.schema.items &&
          bodySchema.schema.items.type === 'object' &&
          bodySchema.schema.items.fields ? (
            <div className="schema-indent">
              <SchemaFields schema={bodySchema.schema.items} depth={1} />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="schema-tree">
          <div className="schema-field">
            <span className="schema-type">
              <SchemaTypeLabel schema={bodySchema.schema} />
            </span>
          </div>
        </div>
      )}
    </>
  );
}

function HeaderRow({ field, values }: { field: HeaderField; values: string[] }) {
  const displayValues = values.length > 0 ? values : [''];

  return (
    <tr className={field.isAuth ? 'auth-row' : ''}>
      <td className="header-name">
        {field.name}
        {field.isAuth ? <span className="auth-badge">AUTH</span> : null}
      </td>
      <td className="header-value">
        <div className="header-values">
          {displayValues.map((value, index) => (
            <div
              className="header-value-item"
              key={`${field.name}-value-${index}`}
              title={value.length > 0 ? value : '(empty)'}
            >
              {value.length > 0 ? value : '(empty)'}
            </div>
          ))}
        </div>
      </td>
      <td className="header-type">{field.valueType || 'unknown'}</td>
      <td className="header-meta">
        {field.optional ? <span className="schema-optional">optional</span> : null}
        {typeof field.seenCount === 'number' ? (
          <span className="seen-count">{field.seenCount}x</span>
        ) : null}
      </td>
    </tr>
  );
}

export function HeadersSchemaTable({
  headersSchema,
  showAuthOnly,
  headerValues,
}: {
  headersSchema: HeadersSchema | null | undefined;
  showAuthOnly: boolean;
  headerValues?: Record<string, string[]>;
}) {
  if (!headersSchema || !Array.isArray(headersSchema.fields) || headersSchema.fields.length === 0) {
    return showAuthOnly ? null : <div className="schema-note">No headers</div>;
  }

  const fields = showAuthOnly
    ? headersSchema.fields.filter((field) => field.isAuth)
    : headersSchema.fields;

  if (showAuthOnly && fields.length === 0) {
    return null;
  }

  return (
    <table className="headers-table">
      <thead>
        <tr>
          <th>Header</th>
          <th>Values</th>
          <th>Type</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {fields.map((field) => {
          const values = headerValues?.[field.name.toLowerCase()] ?? [];
          return <HeaderRow key={field.name} field={field} values={values} />;
        })}
      </tbody>
    </table>
  );
}
