import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSecretStore } from '../../src/provision/secrets.js';

const PROJECT_ID = 'test-project';
const DEMO_SUFFIX = 'acme-crm-001';

function makeStubClient() {
  return {
    createSecret: vi.fn().mockResolvedValue([{}]),
    addSecretVersion: vi.fn().mockResolvedValue([{}]),
    accessSecretVersion: vi.fn().mockResolvedValue([
      { payload: { data: Buffer.from('secret-value', 'utf8') } },
    ]),
  };
}

describe('makeSecretStore', () => {
  describe('secretName', () => {
    it('returns demo-<suffix>-<key>', () => {
      const store = makeSecretStore({ projectId: PROJECT_ID, client: makeStubClient(), demoSuffix: DEMO_SUFFIX });
      expect(store.secretName('SLACK_TOKEN')).toBe(`demo-${DEMO_SUFFIX}-SLACK_TOKEN`);
    });

    it('always contains the suffix (cleanup grep compatibility)', () => {
      const store = makeSecretStore({ projectId: PROJECT_ID, client: makeStubClient(), demoSuffix: DEMO_SUFFIX });
      const name = store.secretName('WORKSPACE_CLIENT_ID');
      expect(name).toContain(DEMO_SUFFIX);
    });
  });

  describe('secretRef', () => {
    it('returns the full resource path with /versions/latest', () => {
      const store = makeSecretStore({ projectId: PROJECT_ID, client: makeStubClient(), demoSuffix: DEMO_SUFFIX });
      expect(store.secretRef('SLACK_TOKEN')).toBe(
        `projects/${PROJECT_ID}/secrets/demo-${DEMO_SUFFIX}-SLACK_TOKEN/versions/latest`
      );
    });
  });

  describe('putSecret', () => {
    it('calls createSecret with correct parent, secretId, and automatic replication', async () => {
      const client = makeStubClient();
      const store = makeSecretStore({ projectId: PROJECT_ID, client, demoSuffix: DEMO_SUFFIX });

      await store.putSecret('SLACK_TOKEN', 'xoxb-abc-123');

      expect(client.createSecret).toHaveBeenCalledOnce();
      expect(client.createSecret).toHaveBeenCalledWith({
        parent: `projects/${PROJECT_ID}`,
        secretId: `demo-${DEMO_SUFFIX}-SLACK_TOKEN`,
        secret: { replication: { automatic: {} } },
      });
    });

    it('calls addSecretVersion with correct parent and Buffer payload', async () => {
      const client = makeStubClient();
      const store = makeSecretStore({ projectId: PROJECT_ID, client, demoSuffix: DEMO_SUFFIX });

      await store.putSecret('SLACK_TOKEN', 'xoxb-abc-123');

      expect(client.addSecretVersion).toHaveBeenCalledOnce();
      const call = client.addSecretVersion.mock.calls[0][0];
      expect(call.parent).toBe(`projects/${PROJECT_ID}/secrets/demo-${DEMO_SUFFIX}-SLACK_TOKEN`);
      expect(call.payload.data).toBeInstanceOf(Buffer);
      expect(call.payload.data.toString('utf8')).toBe('xoxb-abc-123');
    });

    it('is idempotent: swallows ALREADY_EXISTS (code 6) and still calls addSecretVersion', async () => {
      const client = makeStubClient();
      const alreadyExistsError = Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
      client.createSecret.mockRejectedValue(alreadyExistsError);

      const store = makeSecretStore({ projectId: PROJECT_ID, client, demoSuffix: DEMO_SUFFIX });

      await expect(store.putSecret('SLACK_TOKEN', 'xoxb-abc-123')).resolves.not.toThrow();
      expect(client.addSecretVersion).toHaveBeenCalledOnce();
    });

    it('is idempotent: swallows ALREADY_EXISTS in message and still calls addSecretVersion', async () => {
      const client = makeStubClient();
      const alreadyExistsError = new Error('Resource already exists: projects/test-project/secrets/demo-acme-crm-001-SLACK_TOKEN; ALREADY_EXISTS');
      client.createSecret.mockRejectedValue(alreadyExistsError);

      const store = makeSecretStore({ projectId: PROJECT_ID, client, demoSuffix: DEMO_SUFFIX });

      await expect(store.putSecret('SLACK_TOKEN', 'xoxb-abc-123')).resolves.not.toThrow();
      expect(client.addSecretVersion).toHaveBeenCalledOnce();
    });

    it('rethrows createSecret errors that are NOT ALREADY_EXISTS', async () => {
      const client = makeStubClient();
      const permissionError = Object.assign(new Error('PERMISSION_DENIED'), { code: 7 });
      client.createSecret.mockRejectedValue(permissionError);

      const store = makeSecretStore({ projectId: PROJECT_ID, client, demoSuffix: DEMO_SUFFIX });

      await expect(store.putSecret('SLACK_TOKEN', 'xoxb-abc-123')).rejects.toThrow('PERMISSION_DENIED');
      expect(client.addSecretVersion).not.toHaveBeenCalled();
    });
  });

  describe('getSecret', () => {
    it('calls accessSecretVersion with the correct resource ref', async () => {
      const client = makeStubClient();
      const store = makeSecretStore({ projectId: PROJECT_ID, client, demoSuffix: DEMO_SUFFIX });

      await store.getSecret('SLACK_TOKEN');

      expect(client.accessSecretVersion).toHaveBeenCalledOnce();
      expect(client.accessSecretVersion).toHaveBeenCalledWith({
        name: `projects/${PROJECT_ID}/secrets/demo-${DEMO_SUFFIX}-SLACK_TOKEN/versions/latest`,
      });
    });

    it('returns the payload data as a string', async () => {
      const client = makeStubClient();
      const store = makeSecretStore({ projectId: PROJECT_ID, client, demoSuffix: DEMO_SUFFIX });

      const result = await store.getSecret('SLACK_TOKEN');
      expect(result).toBe('secret-value');
    });

    it('returns null when accessSecretVersion throws NOT_FOUND (code 5)', async () => {
      const client = makeStubClient();
      const notFoundError = Object.assign(new Error('NOT_FOUND'), { code: 5 });
      client.accessSecretVersion.mockRejectedValue(notFoundError);

      const store = makeSecretStore({ projectId: PROJECT_ID, client, demoSuffix: DEMO_SUFFIX });

      const result = await store.getSecret('MISSING_KEY');
      expect(result).toBeNull();
    });

    it('returns null when accessSecretVersion throws NOT_FOUND in message', async () => {
      const client = makeStubClient();
      const notFoundError = new Error('Secret not found: projects/test-project/secrets/demo-acme-crm-001-MISSING_KEY; NOT_FOUND');
      client.accessSecretVersion.mockRejectedValue(notFoundError);

      const store = makeSecretStore({ projectId: PROJECT_ID, client, demoSuffix: DEMO_SUFFIX });

      const result = await store.getSecret('MISSING_KEY');
      expect(result).toBeNull();
    });

    it('rethrows errors that are NOT NOT_FOUND', async () => {
      const client = makeStubClient();
      const permissionError = Object.assign(new Error('PERMISSION_DENIED'), { code: 7 });
      client.accessSecretVersion.mockRejectedValue(permissionError);

      const store = makeSecretStore({ projectId: PROJECT_ID, client, demoSuffix: DEMO_SUFFIX });

      await expect(store.getSecret('SLACK_TOKEN')).rejects.toThrow('PERMISSION_DENIED');
    });
  });
});
