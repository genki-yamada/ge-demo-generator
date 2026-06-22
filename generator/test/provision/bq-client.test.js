import { describe, it, expect, vi } from 'vitest';
import { makeBqClient } from '../../src/provision/bq-client.js';

// ---------------------------------------------------------------------------
// Fake bigquery builder
//
// The @google-cloud/bigquery API used in bq-client.js:
//   bigquery.dataset(datasetId, { projectId }).table(tableId).get()
//   bigquery.dataset(datasetId, { projectId }).getTables({ maxResults })
//
// SDK getTables resolves [Table[], ApiResponse]; Table.id is the tableId string.
// ---------------------------------------------------------------------------

/**
 * Build a fake bigquery SDK object.
 *
 * @param {{ getResolves?: boolean, tables?: Array<{id:string}> }} opts
 */
function makeFakeBigquery({ getResolves = true, tables = [{ id: 'orders' }, { id: 'stats' }] } = {}) {
  const getImpl = getResolves
    ? vi.fn().mockResolvedValue([{}])
    : vi.fn().mockRejectedValue(new Error('NOT_FOUND: table does not exist'));

  const tableImpl = vi.fn().mockReturnValue({ get: getImpl });
  const getTablesImpl = vi.fn().mockResolvedValue([tables]);

  const datasetImpl = vi.fn().mockReturnValue({
    table: tableImpl,
    getTables: getTablesImpl,
  });

  return {
    dataset: datasetImpl,
    _internals: { getImpl, tableImpl, getTablesImpl, datasetImpl },
  };
}

// ---------------------------------------------------------------------------
// tableGet
// ---------------------------------------------------------------------------

describe('makeBqClient / tableGet', () => {
  it('calls bigquery.dataset(datasetId, { projectId }).table(tableId).get()', async () => {
    const bq = makeFakeBigquery({ getResolves: true });
    const client = makeBqClient({ bigquery: bq });

    await client.tableGet('bigquery-public-data', 'thelook_ecommerce', 'orders');

    expect(bq.dataset).toHaveBeenCalledOnce();
    expect(bq.dataset).toHaveBeenCalledWith('thelook_ecommerce', { projectId: 'bigquery-public-data' });

    const datasetInstance = bq.dataset.mock.results[0].value;
    expect(datasetInstance.table).toHaveBeenCalledOnce();
    expect(datasetInstance.table).toHaveBeenCalledWith('orders');

    const tableInstance = datasetInstance.table.mock.results[0].value;
    expect(tableInstance.get).toHaveBeenCalledOnce();
  });

  it('resolves when the table exists (get() resolves)', async () => {
    const bq = makeFakeBigquery({ getResolves: true });
    const client = makeBqClient({ bigquery: bq });

    await expect(client.tableGet('bigquery-public-data', 'noaa_gsod', 'gsod2023')).resolves.not.toThrow();
  });

  it('throws when get() rejects (table does not exist)', async () => {
    const bq = makeFakeBigquery({ getResolves: false });
    const client = makeBqClient({ bigquery: bq });

    await expect(
      client.tableGet('bigquery-public-data', 'nonexistent_dataset', 'nonexistent_table')
    ).rejects.toThrow();
  });

  it('propagates the original error from get()', async () => {
    const bq = makeFakeBigquery({ getResolves: false });
    const client = makeBqClient({ bigquery: bq });

    await expect(
      client.tableGet('bigquery-public-data', 'ds', 'missing')
    ).rejects.toThrow('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// tablesList
// ---------------------------------------------------------------------------

describe('makeBqClient / tablesList', () => {
  it('calls bigquery.dataset(datasetId, { projectId }).getTables({ maxResults })', async () => {
    const bq = makeFakeBigquery();
    const client = makeBqClient({ bigquery: bq });

    await client.tablesList('bigquery-public-data', 'thelook_ecommerce', { maxResults: 20 });

    expect(bq.dataset).toHaveBeenCalledOnce();
    expect(bq.dataset).toHaveBeenCalledWith('thelook_ecommerce', { projectId: 'bigquery-public-data' });

    const datasetInstance = bq.dataset.mock.results[0].value;
    expect(datasetInstance.getTables).toHaveBeenCalledOnce();
    expect(datasetInstance.getTables).toHaveBeenCalledWith({ maxResults: 20 });
  });

  it('returns { tables: [{ tableReference: { tableId } }] } mapped from SDK Table[]', async () => {
    const bq = makeFakeBigquery({ tables: [{ id: 'orders' }, { id: 'stats' }] });
    const client = makeBqClient({ bigquery: bq });

    const result = await client.tablesList('bigquery-public-data', 'thelook_ecommerce', { maxResults: 20 });

    expect(result).toEqual({
      tables: [
        { tableReference: { tableId: 'orders' } },
        { tableReference: { tableId: 'stats' } },
      ],
    });
  });

  it('returns { tables: [] } when SDK returns empty array', async () => {
    const bq = makeFakeBigquery({ tables: [] });
    const client = makeBqClient({ bigquery: bq });

    const result = await client.tablesList('bigquery-public-data', 'empty_dataset', { maxResults: 5 });

    expect(result).toEqual({ tables: [] });
  });

  it('maps t.id to tableReference.tableId for each table in the SDK result', async () => {
    const bq = makeFakeBigquery({ tables: [{ id: 'trips' }] });
    const client = makeBqClient({ bigquery: bq });

    const result = await client.tablesList('bigquery-public-data', 'austin_bikeshare', { maxResults: 10 });

    expect(result.tables[0].tableReference.tableId).toBe('trips');
  });

  it('passes maxResults: undefined when opts are omitted', async () => {
    const bq = makeFakeBigquery();
    const client = makeBqClient({ bigquery: bq });

    // Call without opts argument
    await client.tablesList('bigquery-public-data', 'ds');

    const datasetInstance = bq.dataset.mock.results[0].value;
    expect(datasetInstance.getTables).toHaveBeenCalledWith({ maxResults: undefined });
  });
});
