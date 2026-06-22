/**
 * public-dataset.test.js — TDD tests for planning/public-dataset.js
 *
 * Tests two functions ported from Code.gs:
 *   - discoverPublicDataset    (Code.gs:640-684)
 *   - verifyAndResolveTable    (Code.gs:685-722)
 *
 * vertexClient + bqClient are stubbed — no real network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  discoverPublicDataset,
  verifyAndResolveTable,
} from '../../src/planning/public-dataset.js';

// ---------------------------------------------------------------------------
// Constants (verbatim from source)
// ---------------------------------------------------------------------------

const FALLBACK = 'bigquery-public-data.thelook_ecommerce.orders';
const VALID_ID = 'bigquery-public-data.noaa_gsod.gsod2023';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVertexClient(textOrFn) {
  return {
    generateContent: typeof textOrFn === 'function'
      ? vi.fn(textOrFn)
      : vi.fn().mockResolvedValue(textOrFn),
  };
}

function makeBqClient({ tableGetResult, tablesListResult } = {}) {
  return {
    tableGet: tableGetResult instanceof Error
      ? vi.fn().mockRejectedValue(tableGetResult)
      : vi.fn().mockResolvedValue(tableGetResult ?? {}),
    tablesList: tablesListResult instanceof Error
      ? vi.fn().mockRejectedValue(tablesListResult)
      : vi.fn().mockResolvedValue(tablesListResult ?? { tables: [] }),
  };
}

// ---------------------------------------------------------------------------
// discoverPublicDataset
// ---------------------------------------------------------------------------

describe('discoverPublicDataset', () => {
  it('calls vertexClient.generateContent with search:true (Code.gs:640 callVertexAIWithSearch)', async () => {
    const vertexClient = makeVertexClient(VALID_ID);
    const bqClient = makeBqClient();
    await discoverPublicDataset('optimize supply chain', { vertexClient, bqClient });
    expect(vertexClient.generateContent).toHaveBeenCalledOnce();
    const [, opts] = vertexClient.generateContent.mock.calls[0];
    expect(opts).toMatchObject({ search: true });
  });

  it('includes userGoal in the discovery prompt (Code.gs:643)', async () => {
    const vertexClient = makeVertexClient(VALID_ID);
    const bqClient = makeBqClient();
    await discoverPublicDataset('optimize supply chain for automotive', { vertexClient, bqClient });
    const [prompt] = vertexClient.generateContent.mock.calls[0];
    expect(prompt).toContain('optimize supply chain for automotive');
  });

  it('prompt contains "bigquery-public-data" requirement (Code.gs:648)', async () => {
    const vertexClient = makeVertexClient(VALID_ID);
    const bqClient = makeBqClient();
    await discoverPublicDataset('my goal', { vertexClient, bqClient });
    const [prompt] = vertexClient.generateContent.mock.calls[0];
    expect(prompt).toContain("'bigquery-public-data'");
  });

  it('prompt contains FALLBACK example datasets (Code.gs:655-659)', async () => {
    const vertexClient = makeVertexClient(VALID_ID);
    const bqClient = makeBqClient();
    await discoverPublicDataset('my goal', { vertexClient, bqClient });
    const [prompt] = vertexClient.generateContent.mock.calls[0];
    expect(prompt).toContain('bigquery-public-data.noaa_gsod.gsod2023');
    expect(prompt).toContain('bigquery-public-data.census_bureau_acs.zip_codes_2018_5yr');
  });

  it('prompt instructs returning ONLY the dataset ID (Code.gs:662)', async () => {
    const vertexClient = makeVertexClient(VALID_ID);
    const bqClient = makeBqClient();
    await discoverPublicDataset('my goal', { vertexClient, bqClient });
    const [prompt] = vertexClient.generateContent.mock.calls[0];
    expect(prompt).toContain('Return ONLY the dataset ID, nothing else.');
  });

  it('cleans LLM output: trims, removes backtick/quote chars, takes first line (Code.gs:656)', async () => {
    // LLM returns with quotes and extra newlines
    const vertexClient = makeVertexClient('`bigquery-public-data.noaa_gsod.gsod2023`\nextra line');
    const bqClient = makeBqClient();
    const result = await discoverPublicDataset('weather data', { vertexClient, bqClient });
    // After clean: 'bigquery-public-data.noaa_gsod.gsod2023' → passes checks → bqClient.tableGet called
    expect(bqClient.tableGet).toHaveBeenCalledWith('bigquery-public-data', 'noaa_gsod', 'gsod2023');
  });

  it('returns FALLBACK when LLM returns ID not starting with "bigquery-public-data." (Code.gs:658)', async () => {
    const vertexClient = makeVertexClient('not-a-valid-id.something.table');
    const bqClient = makeBqClient();
    const result = await discoverPublicDataset('my goal', { vertexClient, bqClient });
    expect(result).toBe(FALLBACK);
    expect(bqClient.tableGet).not.toHaveBeenCalled();
  });

  it('returns FALLBACK when LLM returns ID with fewer than 3 parts (Code.gs:658)', async () => {
    const vertexClient = makeVertexClient('bigquery-public-data.only-two-parts');
    const bqClient = makeBqClient();
    const result = await discoverPublicDataset('my goal', { vertexClient, bqClient });
    expect(result).toBe(FALLBACK);
    expect(bqClient.tableGet).not.toHaveBeenCalled();
  });

  it('returns FALLBACK when vertexClient.generateContent throws (Code.gs:664)', async () => {
    const vertexClient = { generateContent: vi.fn().mockRejectedValue(new Error('network error')) };
    const bqClient = makeBqClient();
    const result = await discoverPublicDataset('my goal', { vertexClient, bqClient });
    expect(result).toBe(FALLBACK);
  });

  it('returns verified ID when LLM returns valid ID that passes BQ verification (Code.gs:662-663)', async () => {
    const vertexClient = makeVertexClient(VALID_ID);
    const bqClient = makeBqClient({ tableGetResult: { id: VALID_ID } });
    const result = await discoverPublicDataset('weather for logistics', { vertexClient, bqClient });
    expect(result).toBe(VALID_ID);
  });

  it('returns FALLBACK when verifyAndResolveTable returns null (Code.gs:663)', async () => {
    const vertexClient = makeVertexClient(VALID_ID);
    // tableGet throws, tablesList returns empty
    const bqClient = makeBqClient({
      tableGetResult: new Error('not found'),
      tablesListResult: { tables: [] },
    });
    const result = await discoverPublicDataset('weather for logistics', { vertexClient, bqClient });
    expect(result).toBe(FALLBACK);
  });

  it('returns resolved table from verifyAndResolveTable fallback when tableGet fails (Code.gs:663)', async () => {
    const vertexClient = makeVertexClient('bigquery-public-data.noaa_gsod.gsod2023');
    // tableGet fails but tablesList finds a matching table
    const bqClient = makeBqClient({
      tableGetResult: new Error('not found'),
      tablesListResult: {
        tables: [
          { tableReference: { tableId: 'gsod_trips_2023' } },
          { tableReference: { tableId: 'weather_data' } },
        ],
      },
    });
    const result = await discoverPublicDataset('weather data', { vertexClient, bqClient });
    // 'trips' pattern matches 'gsod_trips_2023'
    expect(result).toBe('bigquery-public-data.noaa_gsod.gsod_trips_2023');
  });
});

// ---------------------------------------------------------------------------
// verifyAndResolveTable
// ---------------------------------------------------------------------------

describe('verifyAndResolveTable', () => {
  it('returns null when candidateId has fewer than 3 parts (Code.gs:689)', async () => {
    const bqClient = makeBqClient();
    const result = await verifyAndResolveTable('bigquery-public-data.only-two', { bqClient });
    expect(result).toBeNull();
    expect(bqClient.tableGet).not.toHaveBeenCalled();
  });

  it('returns null when candidateId has only 1 part (Code.gs:689)', async () => {
    const bqClient = makeBqClient();
    const result = await verifyAndResolveTable('only-one', { bqClient });
    expect(result).toBeNull();
  });

  it('calls bqClient.tableGet with correct projectId, datasetId, tableId (Code.gs:695)', async () => {
    const bqClient = makeBqClient({ tableGetResult: {} });
    await verifyAndResolveTable('bigquery-public-data.noaa_gsod.gsod2023', { bqClient });
    expect(bqClient.tableGet).toHaveBeenCalledWith('bigquery-public-data', 'noaa_gsod', 'gsod2023');
  });

  it('returns candidateId when tableGet succeeds (Code.gs:696)', async () => {
    const bqClient = makeBqClient({ tableGetResult: { id: 'some-table' } });
    const result = await verifyAndResolveTable('bigquery-public-data.noaa_gsod.gsod2023', { bqClient });
    expect(result).toBe('bigquery-public-data.noaa_gsod.gsod2023');
  });

  it('calls bqClient.tablesList with projectId, datasetId, {maxResults:20} when tableGet fails (Code.gs:700-701)', async () => {
    const bqClient = makeBqClient({
      tableGetResult: new Error('not found'),
      tablesListResult: { tables: [] },
    });
    await verifyAndResolveTable('bigquery-public-data.noaa_gsod.gsod2023', { bqClient });
    expect(bqClient.tablesList).toHaveBeenCalledWith('bigquery-public-data', 'noaa_gsod', { maxResults: 20 });
  });

  it('returns null when tableGet fails and tablesList returns empty tables (Code.gs:701-714)', async () => {
    const bqClient = makeBqClient({
      tableGetResult: new Error('not found'),
      tablesListResult: { tables: [] },
    });
    const result = await verifyAndResolveTable('bigquery-public-data.noaa_gsod.gsod2023', { bqClient });
    expect(result).toBeNull();
  });

  it('returns null when tableGet fails and tablesList returns no tables property (Code.gs:702)', async () => {
    const bqClient = makeBqClient({
      tableGetResult: new Error('not found'),
      tablesListResult: {},
    });
    const result = await verifyAndResolveTable('bigquery-public-data.noaa_gsod.gsod2023', { bqClient });
    expect(result).toBeNull();
  });

  it('matches preferredPattern "trips" when table name contains it (Code.gs:703)', async () => {
    const bqClient = makeBqClient({
      tableGetResult: new Error('not found'),
      tablesListResult: {
        tables: [
          { tableReference: { tableId: 'chicago_trips_2022' } },
          { tableReference: { tableId: 'stations' } },
        ],
      },
    });
    const result = await verifyAndResolveTable('bigquery-public-data.chicago_taxi_trips.taxi_trips', { bqClient });
    expect(result).toBe('bigquery-public-data.chicago_taxi_trips.chicago_trips_2022');
  });

  it('matches preferredPattern "orders" when table name contains it (Code.gs:703)', async () => {
    const bqClient = makeBqClient({
      tableGetResult: new Error('not found'),
      tablesListResult: {
        tables: [
          { tableReference: { tableId: 'customers' } },
          { tableReference: { tableId: 'all_orders' } },
        ],
      },
    });
    const result = await verifyAndResolveTable('bigquery-public-data.thelook_ecommerce.order_items', { bqClient });
    expect(result).toBe('bigquery-public-data.thelook_ecommerce.all_orders');
  });

  it('matches preferredPattern "events" when table name contains it (Code.gs:703)', async () => {
    const bqClient = makeBqClient({
      tableGetResult: new Error('not found'),
      tablesListResult: {
        tables: [
          { tableReference: { tableId: 'user_events_2023' } },
        ],
      },
    });
    const result = await verifyAndResolveTable('bigquery-public-data.analytics.sessions', { bqClient });
    expect(result).toBe('bigquery-public-data.analytics.user_events_2023');
  });

  it('matches preferredPattern "data" when table name contains it (Code.gs:703)', async () => {
    const bqClient = makeBqClient({
      tableGetResult: new Error('not found'),
      tablesListResult: {
        tables: [
          { tableReference: { tableId: 'census_data' } },
        ],
      },
    });
    const result = await verifyAndResolveTable('bigquery-public-data.census.unknown_table', { bqClient });
    expect(result).toBe('bigquery-public-data.census.census_data');
  });

  it('matches preferredPattern "stats" when table name contains it (Code.gs:703)', async () => {
    const bqClient = makeBqClient({
      tableGetResult: new Error('not found'),
      tablesListResult: {
        tables: [
          { tableReference: { tableId: 'daily_stats' } },
        ],
      },
    });
    const result = await verifyAndResolveTable('bigquery-public-data.some.dataset', { bqClient });
    expect(result).toBe('bigquery-public-data.some.daily_stats');
  });

  it('matches preferredPattern "records" when table name contains it (Code.gs:703)', async () => {
    const bqClient = makeBqClient({
      tableGetResult: new Error('not found'),
      tablesListResult: {
        tables: [
          { tableReference: { tableId: 'health_records' } },
        ],
      },
    });
    const result = await verifyAndResolveTable('bigquery-public-data.health.missing_table', { bqClient });
    expect(result).toBe('bigquery-public-data.health.health_records');
  });

  it('preferredPattern matching is case-insensitive (Code.gs:706 .toLowerCase())', async () => {
    const bqClient = makeBqClient({
      tableGetResult: new Error('not found'),
      tablesListResult: {
        tables: [
          { tableReference: { tableId: 'ORDERS_2023' } },
        ],
      },
    });
    const result = await verifyAndResolveTable('bigquery-public-data.shop.items', { bqClient });
    expect(result).toBe('bigquery-public-data.shop.ORDERS_2023');
  });

  it('falls back to tables[0] when no preferredPattern matches (Code.gs:709-710)', async () => {
    const bqClient = makeBqClient({
      tableGetResult: new Error('not found'),
      tablesListResult: {
        tables: [
          { tableReference: { tableId: 'first_table' } },
          { tableReference: { tableId: 'second_table' } },
        ],
      },
    });
    const result = await verifyAndResolveTable('bigquery-public-data.mydata.unknown', { bqClient });
    expect(result).toBe('bigquery-public-data.mydata.first_table');
  });

  it('returns null when tableGet fails and tablesList also throws (Code.gs:713-714)', async () => {
    const bqClient = makeBqClient({
      tableGetResult: new Error('not found'),
      tablesListResult: new Error('list error'),
    });
    const result = await verifyAndResolveTable('bigquery-public-data.noaa_gsod.gsod2023', { bqClient });
    expect(result).toBeNull();
  });

  it('prefers earlier pattern over later in preferredPatterns order (Code.gs:703-708 — "trips" before "orders")', async () => {
    const bqClient = makeBqClient({
      tableGetResult: new Error('not found'),
      tablesListResult: {
        tables: [
          { tableReference: { tableId: 'all_orders' } },
          { tableReference: { tableId: 'taxi_trips' } },
        ],
      },
    });
    const result = await verifyAndResolveTable('bigquery-public-data.transit.missing', { bqClient });
    // 'trips' (index 0 in preferredPatterns) should match 'taxi_trips' before 'orders' matches 'all_orders'
    expect(result).toBe('bigquery-public-data.transit.taxi_trips');
  });

  it('handles tableId with dots (parts.slice(2).join(".")) correctly (Code.gs:692)', async () => {
    const bqClient = makeBqClient({ tableGetResult: {} });
    await verifyAndResolveTable('bigquery-public-data.dataset.table.with.dots', { bqClient });
    expect(bqClient.tableGet).toHaveBeenCalledWith('bigquery-public-data', 'dataset', 'table.with.dots');
  });
});
