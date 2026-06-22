/**
 * provision/secrets.js — injectable Secret Manager store for pre-collected demo credentials.
 *
 * Replaces GAS bash `read -p` prompts (Code.gs:3354-3735, 4216) with UI-collected credentials
 * stored in Secret Manager (ADR-0002).
 *
 * Design: client is injected for full testability (no real network or package import in tests).
 * Production wiring (real SecretManagerServiceClient) is done by the caller (server / route).
 *
 * Naming convention: `demo-${demoSuffix}-${key}`
 *   Cleanup flow deletes secrets via `gcloud secrets list | grep "${suffix}"` (Code.gs:4015),
 *   so names MUST contain the suffix — this convention satisfies that requirement.
 *
 * @param {object} opts
 * @param {string} opts.projectId  - GCP project ID
 * @param {object} opts.client     - @google-cloud/secret-manager SecretManagerServiceClient-compatible
 * @param {string} opts.demoSuffix - Demo identifier suffix (e.g. 'acme-crm-001')
 * @returns {{ secretName: Function, secretRef: Function, putSecret: Function, getSecret: Function }}
 */
export function makeSecretStore({ projectId, client, demoSuffix }) {
  /**
   * Returns the secret resource name for a given key.
   * Format: `demo-${demoSuffix}-${key}`
   * Naming invariant: always contains demoSuffix for cleanup-grep compatibility.
   */
  function secretName(key) {
    return `demo-${demoSuffix}-${key}`;
  }

  /**
   * Returns the fully-qualified secret version reference for Cloud Run Job env injection.
   * Format: `projects/${projectId}/secrets/demo-${demoSuffix}-${key}/versions/latest`
   */
  function secretRef(key) {
    return `projects/${projectId}/secrets/${secretName(key)}/versions/latest`;
  }

  /**
   * Stores a credential as a new secret version. Idempotent: creates the secret if absent
   * (swallows ALREADY_EXISTS), then always adds a new version.
   *
   * ALREADY_EXISTS detection: gRPC code 6 (primary) or 'ALREADY_EXISTS' in message (fallback).
   * This matches the @google-cloud/secret-manager library behaviour where gRPC status codes
   * are surfaced as error.code on the thrown Error object.
   *
   * @param {string} key   - Credential key (e.g. 'SLACK_TOKEN')
   * @param {string} value - Credential value (plaintext; stored encrypted by Secret Manager)
   */
  async function putSecret(key, value) {
    const name = secretName(key);

    // Create the secret container (idempotent: swallow ALREADY_EXISTS)
    try {
      await client.createSecret({
        parent: `projects/${projectId}`,
        secretId: name,
        secret: { replication: { automatic: {} } },
      });
    } catch (err) {
      if (!isAlreadyExists(err)) {
        throw err;
      }
      // Secret already exists — proceed to add a new version
    }

    // Add the secret version (always runs, even if secret pre-existed)
    await client.addSecretVersion({
      parent: `projects/${projectId}/secrets/${name}`,
      payload: { data: Buffer.from(value, 'utf8') },
    });
  }

  /**
   * Retrieves the latest version of a credential.
   * Returns null if the secret does not exist (NOT_FOUND).
   *
   * NOT_FOUND detection: gRPC code 5 (primary) or 'NOT_FOUND' in message (fallback).
   *
   * @param {string} key - Credential key (e.g. 'SLACK_TOKEN')
   * @returns {Promise<string|null>}
   */
  async function getSecret(key) {
    try {
      const [response] = await client.accessSecretVersion({ name: secretRef(key) });
      return response.payload.data.toString('utf8');
    } catch (err) {
      if (isNotFound(err)) {
        return null;
      }
      throw err;
    }
  }

  return { secretName, secretRef, putSecret, getSecret };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true if the error represents a gRPC ALREADY_EXISTS condition.
 * gRPC status code 6 = ALREADY_EXISTS.
 * Fallback: checks message string for library versions that don't set .code.
 */
function isAlreadyExists(err) {
  return err.code === 6 || (typeof err.message === 'string' && err.message.includes('ALREADY_EXISTS'));
}

/**
 * Returns true if the error represents a gRPC NOT_FOUND condition.
 * gRPC status code 5 = NOT_FOUND.
 * Fallback: checks message string for library versions that don't set .code.
 */
function isNotFound(err) {
  return err.code === 5 || (typeof err.message === 'string' && err.message.includes('NOT_FOUND'));
}
