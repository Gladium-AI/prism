import {
  Badge,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
} from '@/src/design-system';
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
              {field?.optional ? (
                <Badge className="schema-optional" variant="subtle" size="xs" uppercase={false}>
                  optional
                </Badge>
              ) : null}
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

export function JsonSchemaTree({ schema }: { schema: JsonSchema | null | undefined }) {
  if (!schema) {
    return <div className="schema-note">No schema detected</div>;
  }

  if (schema.type === 'object') {
    return (
      <div className="schema-tree">
        <SchemaFields schema={schema} depth={0} />
      </div>
    );
  }

  if (schema.type === 'array') {
    return (
      <div className="schema-tree">
        <div className="schema-field">
          <span className="schema-type">
            <SchemaTypeLabel schema={schema} />
          </span>
        </div>
        {schema.items && schema.items.type === 'object' && schema.items.fields ? (
          <div className="schema-indent">
            <SchemaFields schema={schema.items} depth={1} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="schema-tree">
      <div className="schema-field">
        <span className="schema-type">
          <SchemaTypeLabel schema={schema} />
        </span>
      </div>
    </div>
  );
}

export function BodySchemaView({ bodySchema }: { bodySchema: BodySchema | null | undefined }) {
  if (!bodySchema) {
    return <div className="schema-note">No body detected</div>;
  }

  return (
    <>
      <Badge className="schema-content-type" variant="info" uppercase={false}>
        {bodySchema.contentType || 'unknown'}
      </Badge>
      {!bodySchema.schema ? (
        bodySchema.parseError ? (
          <div className="schema-error">Parse error: {bodySchema.parseError}</div>
        ) : bodySchema.contentType === 'opaque' ? (
          <div className="schema-note">Non-structured body</div>
        ) : null
      ) : (
        <JsonSchemaTree schema={bodySchema.schema} />
      )}
    </>
  );
}

function getCollapsedValue(value: string, maxLength = 110): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return `${singleLine.slice(0, Math.max(0, maxLength - 1))}…`;
}

const COLLAPSIBLE_VALUE_THRESHOLD = 120;

function HeaderValueItem({ value }: { value: string }) {
  const normalizedValue = value.length > 0 ? value : '(empty)';
  const singleLineValue = normalizedValue.replace(/\s+/g, ' ').trim();
  const collapsedValue = getCollapsedValue(normalizedValue);
  const shouldCollapse = singleLineValue.length > COLLAPSIBLE_VALUE_THRESHOLD;

  if (!shouldCollapse) {
    return (
      <div className="header-value-plain" title={normalizedValue}>
        {normalizedValue}
      </div>
    );
  }

  return (
    <details className="header-value-collapsible">
      <summary title={normalizedValue}>{collapsedValue}</summary>
      <pre className="header-value-expanded">{normalizedValue}</pre>
    </details>
  );
}

function HeaderRow({ field, values }: { field: HeaderField; values: string[] }) {
  const displayValues = values.length > 0 ? values : [''];

  return (
    <DataTableRow className={field.isAuth ? 'auth-row' : ''}>
      <DataTableCell className="header-name">
        {field.name}
        {field.isAuth ? (
          <Badge className="auth-badge" variant="danger" size="xs">
            AUTH
          </Badge>
        ) : null}
      </DataTableCell>
      <DataTableCell className="header-value">
        <div className="header-values">
          {displayValues.map((value, index) => (
            <HeaderValueItem key={`${field.name}-value-${index}`} value={value} />
          ))}
        </div>
      </DataTableCell>
      <DataTableCell className="header-type">{field.valueType || 'unknown'}</DataTableCell>
      <DataTableCell className="header-meta">
        {field.optional ? (
          <Badge className="schema-optional" variant="subtle" size="xs" uppercase={false}>
            optional
          </Badge>
        ) : null}
        {typeof field.seenCount === 'number' ? (
          <Badge
            className="seen-count"
            variant="counter"
            size="xs"
            uppercase={false}
            title={`${field.seenCount} observations`}
          >
            {field.seenCount}
          </Badge>
        ) : null}
      </DataTableCell>
    </DataTableRow>
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
    <DataTable className="headers-table">
      <DataTableHead>
        <DataTableRow>
          <DataTableHeaderCell>Header</DataTableHeaderCell>
          <DataTableHeaderCell>Values</DataTableHeaderCell>
          <DataTableHeaderCell>Type</DataTableHeaderCell>
          <DataTableHeaderCell></DataTableHeaderCell>
        </DataTableRow>
      </DataTableHead>
      <DataTableBody>
        {fields.map((field) => {
          const values = headerValues?.[field.name.toLowerCase()] ?? [];
          return <HeaderRow key={field.name} field={field} values={values} />;
        })}
      </DataTableBody>
    </DataTable>
  );
}
