export const DEMO_STATES = Object.freeze({
  BUILDING: 'building',
  ACTIVE: 'active',
  BUILD_FAILED: 'build_failed',
  DELETING: 'deleting',
  DELETED: 'deleted',
  DELETE_FAILED: 'delete_failed',
});

const VALID_TRANSITIONS = Object.freeze({
  building: ['active', 'build_failed'],
  active: ['deleting'],
  build_failed: ['deleting'],
  deleting: ['deleted', 'delete_failed'],
  delete_failed: ['deleting'],
  deleted: [],
});

export function makeDemoId(domain, suffix) {
  return `demo-${domain}-${suffix}`;
}

export function canTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

export function createDemo({ domain, suffix, ownerCe, goal, classification, now }) {
  if (!domain) throw new Error('domain is required');
  if (!suffix) throw new Error('suffix is required');
  if (!ownerCe) throw new Error('ownerCe is required');
  if (!now) throw new Error('now is required');
  return {
    id: makeDemoId(domain, suffix),
    domain,
    suffix,
    ownerCe,
    goal: goal ?? '',
    classification: classification ?? '',
    state: DEMO_STATES.BUILDING,
    scriptGcsUri: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function withState(demo, nextState, now) {
  if (!canTransition(demo.state, nextState)) {
    throw new Error(`invalid transition: ${demo.state} -> ${nextState}`);
  }
  return { ...demo, state: nextState, updatedAt: now };
}
