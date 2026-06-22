/**
 * provision/bq-client.js — BigQuery adapter for the planning pipeline.
 *
 * Adapts @google-cloud/bigquery to the bqClient interface expected by
 * planning/public-dataset.js (verifyAndResolveTable):
 *
 *   tableGet(projectId, datasetId, tableId)
 *     — resolves if the table exists; throws (propagating the SDK error) if not.
 *
 *   tablesList(projectId, datasetId, { maxResults })
 *     — returns { tables: [{ tableReference: { tableId } }, ...] }
 *       matching the GAS BigQuery.Tables.list response shape.
 *
 * Cross-project access decision:
 *   bigquery-public-data (and similar external projects) are accessed by passing
 *   { projectId } as the second argument to bigquery.dataset(), which routes the
 *   REST call to the correct billing project while accessing the target project's
 *   data.  API used:
 *     bigquery.dataset(datasetId, { projectId }).table(tableId).get()
 *     bigquery.dataset(datasetId, { projectId }).getTables({ maxResults })
 *   SDK getTables resolves [Table[], ApiResponse]; each Table.id is the tableId string.
 *
 * bigquery is injected so callers (including tests) supply their own instance.
 * Production wiring (new BigQuery()) is done by the composition root (server.js, W-B).
 *
 * @param {{ bigquery: import('@google-cloud/bigquery').BigQuery }} opts
 */
export function makeBqClient({ bigquery }) {
  return {
    /**
     * Verifies a table exists in BigQuery.
     * Resolves (return value unused by caller) when the table exists.
     * Throws when the table does not exist — propagating the SDK error.
     *
     * @param {string} projectId  - GCP project owning the dataset (e.g. 'bigquery-public-data')
     * @param {string} datasetId  - Dataset ID
     * @param {string} tableId    - Table ID
     */
    async tableGet(projectId, datasetId, tableId) {
      await bigquery.dataset(datasetId, { projectId }).table(tableId).get();
    },

    /**
     * Lists tables in a dataset, returning the GAS-compatible shape.
     *
     * @param {string} projectId   - GCP project owning the dataset
     * @param {string} datasetId   - Dataset ID
     * @param {{ maxResults?: number }} [opts]
     * @returns {Promise<{ tables: Array<{ tableReference: { tableId: string } }> }>}
     */
    async tablesList(projectId, datasetId, { maxResults } = {}) {
      const [tables] = await bigquery.dataset(datasetId, { projectId }).getTables({ maxResults });
      return {
        tables: tables.map(t => ({ tableReference: { tableId: t.id } })),
      };
    },
  };
}
