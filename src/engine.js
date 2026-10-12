import Ajv2020 from 'ajv/dist/2020.js';
import AjvDraft07 from 'ajv';
import addFormats from 'ajv-formats';

export { baselineSchema, candidateSchema, samplePayload } from './samples.js';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const pointer = (base, key) => `${base}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => JSON.stringify(value, (_key, item) => {
  if (!record(item)) return item;
  return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
});
const equal = (left, right) => canonical(left) === canonical(right);

/**
 * Compile synchronously, without loadSchema or compileAsync: unresolved remote
 * references fail, never fetch. Absent $schema defaults to 2020-12. Draft-07 is
 * also supported. Known ajv-formats formats are enforced; unknown custom formats
 * are ignored under strict:false. A fresh compiler avoids stale mutated schemas
 * and shared $id collisions. Async schemas are intentionally unsupported.
 */
function compile(schema) {
  if (typeof schema !== 'boolean' && !record(schema)) {
    throw new Error('Schema must be a JSON object or boolean.');
  }
  const dialect = typeof schema === 'object' ? schema.$schema : undefined;
  let Constructor = Ajv2020;
  let compilationSchema = schema;
  if (dialect !== undefined) {
    if (typeof dialect !== 'string') throw new Error('$schema must be a string.');
    const normalized = dialect.replace(/^http:/, 'https:').replace(/#$/, '');
    if (normalized === 'https://json-schema.org/draft-07/schema') Constructor = AjvDraft07;
    else if (normalized !== 'https://json-schema.org/draft/2020-12/schema') {
      throw new Error('Unsupported dialect: use JSON Schema 2020-12 or draft-07.');
    }
    // Ajv registers the official meta-schema URI only. Normalize aliases on a
    // shallow copy, leaving the caller's schema and reference identities intact.
    compilationSchema = { ...schema, $schema: Constructor === AjvDraft07 ? 'http://json-schema.org/draft-07/schema#' : 'https://json-schema.org/draft/2020-12/schema' };
  }
  const ajv = new Constructor({
    allErrors: true,
    validateFormats: true,
    strict: false,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
    ownProperties: true,
    logger: false,
  });
  addFormats(ajv);
  const validator = ajv.compile(compilationSchema);
  if (validator.$async) throw new Error('Async schemas are not supported by the local validator.');
  return validator;
}

/**
 * Pure, synchronous validation. Invalid schemas, unsupported dialects, and
 * unresolved references return {valid:false, errors:[], error:string}, not throw.
 * Payload/schema objects are not mutated. Error paths are JSON Pointers; required
 * and additional-property errors include the offending property. Root is '/'.
 */
export function validate(schema, payload) {
  try {
    const validator = compile(schema);
    const valid = validator(payload);
    const errors = (validator.errors || []).map(error => {
      let path = error.instancePath;
      if (error.keyword === 'required') path = pointer(path, error.params.missingProperty);
      if (error.keyword === 'additionalProperties') path = pointer(path, error.params.additionalProperty);
      return { path: path || '/', message: error.message || 'Validation failed', keyword: error.keyword };
    });
    return { valid, errors };
  } catch (error) {
    return { valid: false, errors: [], error: error instanceof Error ? error.message : String(error) };
  }
}

const annotations = new Set([
  'title', 'description', '$comment', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly',
]);
const handled = new Set([
  'type', 'enum', 'properties', 'required', 'additionalProperties',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties',
  'uniqueItems', 'pattern', 'format',
]);
const lowerBounds = ['minimum', 'exclusiveMinimum', 'minLength', 'minItems', 'minProperties'];
const upperBounds = ['maximum', 'exclusiveMaximum', 'maxLength', 'maxItems', 'maxProperties'];
const typeSet = schema => schema.type === undefined ? null : new Set(
  (Array.isArray(schema.type) ? schema.type : [schema.type]).flatMap(type => type === 'number' ? ['number', 'integer'] : [type]),
);
const subset = (left, right) => [...left].every(value => right.has(value));
const emptySchema = value => value === true || (record(value) && Object.keys(value).every(key => annotations.has(key)));

/**
 * Conservative accepted-input change review, NOT a full API compatibility proof.
 * Paths point into the schema (JSON Pointer). Counts count findings, not fields.
 * Property removal is breaking when extras are forbidden, otherwise review (it
 * may remove a producer contract); optional additions are compatible unless they
 * constrain formerly unrestricted additional properties, in which case review.
 * Added required fields are breaking. An unchanged advanced constraint can still
 * interact with changed simple constraints: labels are local heuristics only.
 * $ref/$defs, combinators, conditionals, dependencies, items/prefixItems, const,
 * patternProperties and other unsupported changes are review, not resolved.
 * Annotation-only changes are ignored. Invalid input schemas throw Error.
 */
export function compare(before, after) {
  compile(before);
  compile(after);
  const changes = [];
  const add = (path, severity, kind, message) => changes.push({ path: path || '/', severity, kind, message });

  function walk(oldSchema, newSchema, path, depth = 0) {
    if (depth > 80) throw new Error('Schema comparison exceeds the supported nesting depth (80).');
    if (equal(oldSchema, newSchema)) return;
    if (typeof oldSchema === 'boolean' || typeof newSchema === 'boolean') {
      if (emptySchema(oldSchema) && emptySchema(newSchema)) return;
      const objectSchema = record(oldSchema) ? oldSchema : record(newSchema) ? newSchema : null;
      const hasAdvanced = objectSchema && Object.keys(objectSchema).some(key => !annotations.has(key) && !handled.has(key));
      const severity = hasAdvanced ? 'review' : oldSchema === false || emptySchema(newSchema) ? 'compatible' : 'breaking';
      add(path, severity, 'boolean-schema', severity === 'review' ? 'Boolean/object schema transition includes advanced keywords; review the accepted inputs.' : severity === 'breaking' ? 'Accepted input is restricted by the new schema.' : 'Accepted input is widened by the new schema.');
      return;
    }

    const oldTypes = typeSet(oldSchema);
    const newTypes = typeSet(newSchema);
    if (!equal(oldTypes && [...oldTypes].sort(), newTypes && [...newTypes].sort())) {
      const severity = !oldTypes ? 'breaking' : !newTypes ? 'compatible' : subset(newTypes, oldTypes) ? 'breaking' : subset(oldTypes, newTypes) ? 'compatible' : 'review';
      add(pointer(path, 'type'), severity, 'type', severity === 'breaking' ? 'Allowed types narrowed.' : severity === 'compatible' ? 'Allowed types widened.' : 'Allowed types changed without a subset relationship.');
    }

    const oldEnum = oldSchema.enum === undefined ? null : new Set(oldSchema.enum.map(canonical));
    const newEnum = newSchema.enum === undefined ? null : new Set(newSchema.enum.map(canonical));
    if ((oldEnum === null) !== (newEnum === null) || (oldEnum && newEnum && (!subset(oldEnum, newEnum) || !subset(newEnum, oldEnum)))) {
      const severity = !oldEnum ? 'breaking' : !newEnum ? 'compatible' : subset(newEnum, oldEnum) ? 'breaking' : subset(oldEnum, newEnum) ? 'compatible' : 'review';
      add(pointer(path, 'enum'), severity, 'enum', severity === 'breaking' ? 'Allowed enum values narrowed.' : severity === 'compatible' ? 'Allowed enum values widened.' : 'Enum values were both added and removed.');
    }

    const oldRequired = new Set(oldSchema.required || []);
    const newRequired = new Set(newSchema.required || []);
    for (const name of newRequired) {
      if (!oldRequired.has(name)) add(pointer(pointer(path, 'required'), name), 'breaking', 'required-added', `Property ${JSON.stringify(name)} is now required.`);
    }
    for (const name of oldRequired) {
      if (!newRequired.has(name)) add(pointer(pointer(path, 'required'), name), 'compatible', 'required-removed', `Property ${JSON.stringify(name)} is no longer required.`);
    }

    const oldProps = oldSchema.properties || {};
    const newProps = newSchema.properties || {};
    const oldAdditional = oldSchema.additionalProperties ?? true;
    const newAdditional = newSchema.additionalProperties ?? true;
    for (const name of Object.keys(oldProps)) {
      const propPath = pointer(pointer(path, 'properties'), name);
      if (!own(newProps, name)) {
        const severity = newAdditional === false ? 'breaking' : 'review';
        add(propPath, severity, 'property-removed', severity === 'breaking' ? `Property ${JSON.stringify(name)} was removed and is now forbidden as an extra property.` : `Property ${JSON.stringify(name)} was removed; review consumer and producer expectations.`);
      } else walk(oldProps[name], newProps[name], propPath, depth + 1);
    }
    for (const name of Object.keys(newProps)) {
      if (!own(oldProps, name)) {
        // An optional field schema can reject previously accepted arbitrary data.
        const severity = oldAdditional === false || emptySchema(newProps[name]) ? 'compatible' : 'review';
        add(pointer(pointer(path, 'properties'), name), severity, 'property-added', severity === 'compatible' ? `Property ${JSON.stringify(name)} was added.` : `Property ${JSON.stringify(name)} was added; its constraints may reject previously allowed extra-property values.`);
      }
    }

    if (!equal(oldAdditional, newAdditional)) {
      const apPath = pointer(path, 'additionalProperties');
      if (record(oldAdditional) && record(newAdditional)) walk(oldAdditional, newAdditional, apPath, depth + 1);
      else if (!(emptySchema(oldAdditional) && emptySchema(newAdditional))) {
        const severity = oldAdditional === false || emptySchema(newAdditional) ? 'compatible' : 'breaking';
        add(apPath, severity, 'additional-properties', severity === 'breaking' ? 'Additional properties are now more restricted.' : 'Additional properties are now less restricted.');
      }
    }

    for (const key of [...lowerBounds, ...upperBounds]) {
      if (oldSchema[key] === newSchema[key]) continue;
      const tightening = oldSchema[key] === undefined ? true : newSchema[key] === undefined ? false : lowerBounds.includes(key) ? newSchema[key] > oldSchema[key] : newSchema[key] < oldSchema[key];
      add(pointer(path, key), tightening ? 'breaking' : 'compatible', 'constraint', `${key} was ${tightening ? 'tightened' : 'relaxed'}.`);
    }
    if ((oldSchema.uniqueItems === true) !== (newSchema.uniqueItems === true)) {
      const tightening = newSchema.uniqueItems === true;
      add(pointer(path, 'uniqueItems'), tightening ? 'breaking' : 'compatible', 'constraint', tightening ? 'Array items must now be unique.' : 'Duplicate array items are now allowed.');
    }
    if (oldSchema.multipleOf !== newSchema.multipleOf) {
      const oldValue = oldSchema.multipleOf;
      const newValue = newSchema.multipleOf;
      let severity = 'review';
      if (oldValue === undefined) severity = 'breaking';
      else if (newValue === undefined) severity = 'compatible';
      else if (Number.isInteger(newValue / oldValue)) severity = 'breaking';
      else if (Number.isInteger(oldValue / newValue)) severity = 'compatible';
      add(pointer(path, 'multipleOf'), severity, 'constraint', `multipleOf changed${severity === 'review' ? '; divisibility relationship needs review' : severity === 'breaking' ? '; accepted values narrowed' : '; accepted values widened'}.`);
    }
    for (const key of ['pattern', 'format']) {
      if (oldSchema[key] === newSchema[key]) continue;
      // Unknown formats are ignored by Ajv under strict:false, so do not infer.
      const severity = key === 'format' ? 'review' : oldSchema[key] === undefined ? 'breaking' : newSchema[key] === undefined ? 'compatible' : 'review';
      add(pointer(path, key), severity, 'constraint', `${key} changed${severity === 'review' ? '; review its accepted values' : severity === 'breaking' ? '; a restriction was added' : '; a restriction was removed'}.`);
    }

    const keys = new Set([...Object.keys(oldSchema), ...Object.keys(newSchema)]);
    for (const key of keys) {
      if (annotations.has(key) || handled.has(key) || equal(oldSchema[key], newSchema[key])) continue;
      add(pointer(path, key), 'review', 'advanced-keyword', `${key} changed; this keyword is not semantically resolved by the compatibility checker.`);
    }
  }

  walk(before, after, '');
  return {
    changes,
    breaking: changes.filter(change => change.severity === 'breaking').length,
    review: changes.filter(change => change.severity === 'review').length,
    compatible: changes.filter(change => change.severity === 'compatible').length,
  };
}
