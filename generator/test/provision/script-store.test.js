import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeScriptStore } from '../../src/provision/script-store.js';

const BUCKET = 'test-scripts-bucket';
const DEMO_ID = 'demo-retail-abcd1234';
const OBJECT_NAME = `scripts/${DEMO_ID}.sh`;
const GCS_URI = `gs://${BUCKET}/${OBJECT_NAME}`;

function makeFakeStorage() {
  const fakeFile = {
    save: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue([Buffer.from('#!/bin/bash\necho hello')]),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const fakeBucket = { file: vi.fn().mockReturnValue(fakeFile) };
  const storage = { bucket: vi.fn().mockReturnValue(fakeBucket) };
  return { storage, fakeBucket, fakeFile };
}

describe('makeScriptStore', () => {
  let store;
  let storage;
  let fakeBucket;
  let fakeFile;

  beforeEach(() => {
    ({ storage, fakeBucket, fakeFile } = makeFakeStorage());
    store = makeScriptStore({ bucket: BUCKET, storage });
  });

  describe('save(demoId, scriptText)', () => {
    it('calls storage.bucket with the correct bucket name', async () => {
      await store.save(DEMO_ID, '#!/bin/bash\necho hello');
      expect(storage.bucket).toHaveBeenCalledWith(BUCKET);
    });

    it('calls file() with the correct object name', async () => {
      await store.save(DEMO_ID, '#!/bin/bash\necho hello');
      expect(fakeBucket.file).toHaveBeenCalledWith(OBJECT_NAME);
    });

    it('calls save() with the script text and correct contentType', async () => {
      const script = '#!/bin/bash\necho hello';
      await store.save(DEMO_ID, script);
      expect(fakeFile.save).toHaveBeenCalledWith(script, { contentType: 'text/x-shellscript' });
    });

    it('returns the gs:// URI for the stored object', async () => {
      const uri = await store.save(DEMO_ID, '#!/bin/bash\necho hello');
      expect(uri).toBe(GCS_URI);
    });
  });

  describe('fetch(demoId)', () => {
    it('calls file() with the correct object name', async () => {
      await store.fetch(DEMO_ID);
      expect(fakeBucket.file).toHaveBeenCalledWith(OBJECT_NAME);
    });

    it('calls download() on the file', async () => {
      await store.fetch(DEMO_ID);
      expect(fakeFile.download).toHaveBeenCalledOnce();
    });

    it('returns the script as a utf8 string', async () => {
      const result = await store.fetch(DEMO_ID);
      expect(result).toBe('#!/bin/bash\necho hello');
    });

    it('handles buffers with multi-byte utf8 characters', async () => {
      const text = '#!/bin/bash\necho "こんにちは"';
      fakeFile.download.mockResolvedValueOnce([Buffer.from(text, 'utf8')]);
      const result = await store.fetch(DEMO_ID);
      expect(result).toBe(text);
    });
  });

  describe('remove(demoId)', () => {
    it('calls file() with the correct object name', async () => {
      await store.remove(DEMO_ID);
      expect(fakeBucket.file).toHaveBeenCalledWith(OBJECT_NAME);
    });

    it('calls delete() with { ignoreNotFound: true }', async () => {
      await store.remove(DEMO_ID);
      expect(fakeFile.delete).toHaveBeenCalledWith({ ignoreNotFound: true });
    });
  });
});
