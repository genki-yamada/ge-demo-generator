import { buildApp } from './app.js';
import { DemoRegistry } from './registry/registry.js';
import { FirestoreStore } from './registry/firestore-store.js';
import { iapAuth } from './auth/iap.js';

const port = process.env.PORT || 8080;
const projectId = process.env.GOOGLE_CLOUD_PROJECT;
const databaseId = process.env.FIRESTORE_DATABASE_ID || 'generator';
const iapAudience = process.env.IAP_AUDIENCE;
const devUserEmail = process.env.DEV_USER_EMAIL || null;

const store = new FirestoreStore({ projectId, databaseId });
const registry = new DemoRegistry(store);
const authMiddleware = iapAuth({ audience: iapAudience, devUserEmail });

const app = buildApp({ registry, authMiddleware });

app.listen(port, () => {
  console.log(`generator backend listening on ${port} (db=${databaseId})`);
});
