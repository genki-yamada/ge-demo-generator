import { Firestore } from '@google-cloud/firestore';

export class FirestoreStore {
  constructor({ projectId, databaseId = 'generator', collection = 'demos', firestore } = {}) {
    this.firestore = firestore ?? new Firestore({ projectId, databaseId });
    this.collectionName = collection;
  }

  _doc(id) {
    return this.firestore.collection(this.collectionName).doc(id);
  }

  async get(id) {
    const snap = await this._doc(id).get();
    return snap.exists ? snap.data() : null;
  }

  async put(demo) {
    await this._doc(demo.id).set(demo);
  }

  async list() {
    const snap = await this.firestore.collection(this.collectionName).get();
    return snap.docs.map((d) => d.data());
  }
}
