/**
 * script-store.js — GCS-backed store for generated setup scripts.
 *
 * Each demo's setup script is stored as `scripts/<demoId>.sh` in the
 * configured bucket. The URI is recorded in the registry so the provisioner
 * Job can fetch the script at runtime without re-generating it.
 *
 * A temporary cleanup script is stored as `scripts/<demoId>-cleanup.sh`
 * for the duration of the cleanup job, then removed immediately after.
 *
 * @param {object} opts
 * @param {string} opts.bucket   - GCS bucket name
 * @param {object} opts.storage  - @google-cloud/storage Storage instance
 */
export function makeScriptStore({ bucket, storage }) {
  const objectName = (demoId) => `scripts/${demoId}.sh`;
  const cleanupObjectName = (demoId) => `scripts/${demoId}-cleanup.sh`;
  const headlessObjectName = (demoId) => `scripts/${demoId}-headless.sh`;
  return {
    async save(demoId, scriptText) {
      await storage.bucket(bucket).file(objectName(demoId)).save(scriptText, { contentType: 'text/x-shellscript' });
      return `gs://${bucket}/${objectName(demoId)}`;
    },
    async fetch(demoId) {
      const [buf] = await storage.bucket(bucket).file(objectName(demoId)).download();
      return buf.toString('utf8');
    },
    async remove(demoId) {
      await storage.bucket(bucket).file(objectName(demoId)).delete({ ignoreNotFound: true });
    },
    async saveCleanup(demoId, scriptText) {
      await storage.bucket(bucket).file(cleanupObjectName(demoId)).save(scriptText, { contentType: 'text/x-shellscript' });
      return `gs://${bucket}/${cleanupObjectName(demoId)}`;
    },
    async removeCleanup(demoId) {
      await storage.bucket(bucket).file(cleanupObjectName(demoId)).delete({ ignoreNotFound: true });
    },
    async saveHeadless(demoId, scriptText) {
      await storage.bucket(bucket).file(headlessObjectName(demoId)).save(scriptText, { contentType: 'text/x-shellscript' });
      return `gs://${bucket}/${headlessObjectName(demoId)}`;
    },
    async removeHeadless(demoId) {
      await storage.bucket(bucket).file(headlessObjectName(demoId)).delete({ ignoreNotFound: true });
    },
  };
}
