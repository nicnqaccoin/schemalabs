/** SAMPLE data only: fictional purchase schemas, not customer data. */
export const baselineSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Sample Purchase',
  type: 'object',
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'paid', 'refunded'] },
    total: { type: 'number', minimum: 0 },
    currency: { type: 'string', enum: ['USD', 'VND'] },
  },
  required: ['id', 'total'],
};

export const candidateSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Sample Purchase',
  type: 'object',
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'paid'] },
    total: { type: 'integer', minimum: 1 },
    currency: { type: 'string', enum: ['USD', 'VND'] },
  },
  required: ['id', 'total', 'currency'],
};

export const samplePayload = {
  id: 'sample-purchase-001',
  status: 'refunded',
  total: 0.5,
};
