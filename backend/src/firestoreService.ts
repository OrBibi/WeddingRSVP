import { randomBytes, randomUUID } from 'node:crypto';
import type { Guest, GuestGroup, GuestStatus } from '../../shared/types';
import { firestore } from './firebaseAdmin';
import { normalizePhoneForComparison } from './phoneUtils';

const usersCollection = firestore.collection('users');
const weddingsCollection = firestore.collection('weddings');

export const ensureUserWedding = async (uid: string, email?: string) => {
  const userRef = usersCollection.doc(uid);
  const weddingRef = weddingsCollection.doc(uid);
  const now = new Date().toISOString();

  const userDoc = await userRef.get();
  if (!userDoc.exists) {
    await userRef.set({
      uid,
      email: email ?? null,
      weddingId: uid,
      createdAt: now,
    });
  }

  const weddingDoc = await weddingRef.get();
  if (!weddingDoc.exists) {
    await weddingRef.set({
      id: uid,
      ownerUid: uid,
      createdAt: now,
    });
  }
};

const guestsCollection = (weddingId: string) => weddingsCollection.doc(weddingId).collection('guests');
const groupsCollection = (weddingId: string) => weddingsCollection.doc(weddingId).collection('groups');

const RSVP_SLUG_RE = /^[A-Za-z0-9_-]{6,22}$/;

const newRsvpSlugCandidate = (): string =>
  randomBytes(6)
    .toString('base64url')
    .replace(/=/g, '')
    .slice(0, 10);

export const getGuestsByWeddingId = async (weddingId: string): Promise<Guest[]> => {
  const snapshot = await guestsCollection(weddingId).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data() as Guest;
    return {
      ...data,
      groupIds: Array.isArray(data.groupIds) ? data.groupIds : [],
      messageSent: Boolean(data.messageSent),
      lastMessageSentAt: typeof data.lastMessageSentAt === 'string' ? data.lastMessageSentAt : undefined,
    };
  });
};

export const getGroupsByWeddingId = async (weddingId: string): Promise<GuestGroup[]> => {
  const snapshot = await groupsCollection(weddingId).get();
  return snapshot.docs.map((doc) => doc.data() as GuestGroup);
};

export const createGroupInWedding = async (weddingId: string, name: string): Promise<GuestGroup> => {
  const group: GuestGroup = {
    id: randomUUID(),
    name,
    weddingId,
  };
  await groupsCollection(weddingId).doc(group.id).set(group);
  return group;
};

export const deleteGroupInWedding = async (weddingId: string, groupId: string): Promise<boolean> => {
  const groupRef = groupsCollection(weddingId).doc(groupId);
  const existing = await groupRef.get();
  if (!existing.exists) {
    return false;
  }
  await groupRef.delete();
  return true;
};

export const addGuestToWedding = async (
  weddingId: string,
  payload: { name: string; phoneNumber: string; expectedPartySize: number }
): Promise<Guest> => {
  const id = randomUUID();
  const guest: Guest = {
    id,
    weddingId,
    name: payload.name,
    phoneNumber: payload.phoneNumber,
    status: 'Pending',
    expectedPartySize: payload.expectedPartySize,
    partySize: payload.expectedPartySize,
    groupIds: [],
    rsvpToken: randomUUID(),
    messageSent: false,
  };
  await guestsCollection(weddingId).doc(id).set(guest);
  const slug = await ensureGuestRsvpSlug(weddingId, id);
  return slug ? { ...guest, rsvpSlug: slug } : guest;
};

export const updateGuestInWedding = async (
  weddingId: string,
  guestId: string,
  updates: Partial<
    Pick<
      Guest,
      | 'name'
      | 'phoneNumber'
      | 'status'
      | 'partySize'
      | 'expectedPartySize'
      | 'groupIds'
      | 'messageSent'
      | 'lastMessageSentAt'
    >
  >
): Promise<Guest | null> => {
  const guestRef = guestsCollection(weddingId).doc(guestId);
  const existing = await guestRef.get();
  if (!existing.exists) {
    return null;
  }

  const current = existing.data() as Guest;
  const updated: Guest = {
    ...current,
    ...updates,
    groupIds: Array.isArray(current.groupIds) ? current.groupIds : [],
    messageSent: typeof updates.messageSent === 'boolean' ? updates.messageSent : Boolean(current.messageSent),
    lastMessageSentAt:
      typeof updates.lastMessageSentAt === 'string'
        ? updates.lastMessageSentAt
        : typeof current.lastMessageSentAt === 'string'
          ? current.lastMessageSentAt
          : undefined,
  };
  await guestRef.set(updated);
  return updated;
};

export const deleteGuestInWedding = async (weddingId: string, guestId: string): Promise<Guest | null> => {
  const guestRef = guestsCollection(weddingId).doc(guestId);
  const existing = await guestRef.get();
  if (!existing.exists) {
    return null;
  }
  const data = existing.data() as Guest;
  await guestRef.delete();
  return data;
};

export const findGuestByPhone = async (weddingId: string, phoneNumber: string): Promise<Guest | null> => {
  const normalizedSearchPhone = normalizePhoneForComparison(phoneNumber);
  const guests = await getGuestsByWeddingId(weddingId);
  const found = guests.find(
    (guest) => normalizePhoneForComparison(guest.phoneNumber) === normalizedSearchPhone
  );
  if (!found) {
    return null;
  }
  return {
    ...found,
    groupIds: Array.isArray(found.groupIds) ? found.groupIds : [],
    messageSent: Boolean(found.messageSent),
    lastMessageSentAt: typeof found.lastMessageSentAt === 'string' ? found.lastMessageSentAt : undefined,
  };
};

export const findGuestById = async (weddingId: string, guestId: string): Promise<Guest | null> => {
  const guestDoc = await guestsCollection(weddingId).doc(guestId).get();
  if (!guestDoc.exists) {
    return null;
  }
  const data = guestDoc.data() as Guest;
  return {
    ...data,
    groupIds: Array.isArray(data.groupIds) ? data.groupIds : [],
    messageSent: Boolean(data.messageSent),
    lastMessageSentAt: typeof data.lastMessageSentAt === 'string' ? data.lastMessageSentAt : undefined,
  };
};

export const ensureGuestRsvpToken = async (weddingId: string, guestId: string): Promise<string | null> => {
  const guestRef = guestsCollection(weddingId).doc(guestId);
  const existing = await guestRef.get();
  if (!existing.exists) {
    return null;
  }

  const guest = existing.data() as Guest;
  if (guest.rsvpToken && guest.rsvpToken.trim()) {
    return guest.rsvpToken;
  }

  const newToken = randomUUID();
  await guestRef.update({ rsvpToken: newToken });
  return newToken;
};

export const ensureGuestRsvpSlug = async (weddingId: string, guestId: string): Promise<string | null> => {
  const guestRef = guestsCollection(weddingId).doc(guestId);
  const existing = await guestRef.get();
  if (!existing.exists) {
    return null;
  }

  const guest = existing.data() as Guest;
  if (typeof guest.rsvpSlug === 'string' && RSVP_SLUG_RE.test(guest.rsvpSlug)) {
    return guest.rsvpSlug;
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const slug = newRsvpSlugCandidate();
    const conflict = await guestsCollection(weddingId).where('rsvpSlug', '==', slug).limit(1).get();
    if (conflict.empty) {
      await guestRef.update({ rsvpSlug: slug });
      return slug;
    }
    if (conflict.docs[0]?.id === guestId) {
      return slug;
    }
  }
  return null;
};

export const findGuestByRsvpSlug = async (weddingId: string, slug: string): Promise<Guest | null> => {
  if (!RSVP_SLUG_RE.test(slug)) {
    return null;
  }
  const snap = await guestsCollection(weddingId).where('rsvpSlug', '==', slug).limit(1).get();
  if (snap.empty) {
    return null;
  }
  const data = snap.docs[0].data() as Guest;
  return {
    ...data,
    groupIds: Array.isArray(data.groupIds) ? data.groupIds : [],
    messageSent: Boolean(data.messageSent),
    lastMessageSentAt: typeof data.lastMessageSentAt === 'string' ? data.lastMessageSentAt : undefined,
  };
};

export const importGuestsToWedding = async (
  weddingId: string,
  input: Array<{
    name: string;
    phoneNumber: string;
    expectedPartySize: number;
    status: GuestStatus;
    groupIds?: string[];
  }>
) => {
  const existingGuests = await getGuestsByWeddingId(weddingId);
  const existingPhones = new Set(
    existingGuests.map((guest) => normalizePhoneForComparison(guest.phoneNumber))
  );

  const createdGuests: Guest[] = [];
  let skippedCount = 0;

  for (const row of input) {
    const normalizedPhone = normalizePhoneForComparison(row.phoneNumber);
    if (existingPhones.has(normalizedPhone)) {
      skippedCount += 1;
      continue;
    }
    const guest: Guest = {
      id: randomUUID(),
      weddingId,
      name: row.name,
      phoneNumber: row.phoneNumber,
      status: row.status,
      expectedPartySize: row.expectedPartySize,
      partySize: row.status === 'Attending' ? row.expectedPartySize : 1,
      groupIds: Array.isArray(row.groupIds) ? [...new Set(row.groupIds)] : [],
      rsvpToken: randomUUID(),
      messageSent: false,
    };
    await guestsCollection(weddingId).doc(guest.id).set(guest);
    const slug = await ensureGuestRsvpSlug(weddingId, guest.id);
    existingPhones.add(normalizedPhone);
    createdGuests.push(slug ? { ...guest, rsvpSlug: slug } : guest);
  }

  return {
    createdGuests,
    skippedCount,
  };
};

export const bulkUpdateGuestGroups = async (
  weddingId: string,
  guestIds: string[],
  groupId: string,
  action: 'add' | 'remove'
) => {
  const uniqueGuestIds = [...new Set(guestIds)];
  const batch = firestore.batch();
  let updatedCount = 0;

  for (const guestId of uniqueGuestIds) {
    const guestRef = guestsCollection(weddingId).doc(guestId);
    const guestDoc = await guestRef.get();
    if (!guestDoc.exists) {
      continue;
    }
    const guest = guestDoc.data() as Guest;
    const currentGroupIds = Array.isArray(guest.groupIds) ? guest.groupIds : [];
    const nextGroupIds =
      action === 'add'
        ? [...new Set([...currentGroupIds, groupId])]
        : currentGroupIds.filter((id) => id !== groupId);

    batch.update(guestRef, { groupIds: nextGroupIds });
    updatedCount += 1;
  }

  if (updatedCount > 0) {
    await batch.commit();
  }

  return { updatedCount };
};
