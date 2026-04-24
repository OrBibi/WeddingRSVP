import { randomBytes, randomUUID } from 'node:crypto';
import type {
  Guest,
  GuestGroup,
  GuestStatus,
  WhatsAppSendJob,
  WhatsAppSendJobRecipient,
  WhatsAppSendJobStatus,
} from '../../shared/types';
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
const sendJobsCollection = (weddingId: string) =>
  weddingsCollection.doc(weddingId).collection('whatsappSendJobs');
const sendJobRecipientsCollection = (weddingId: string, jobId: string) =>
  sendJobsCollection(weddingId).doc(jobId).collection('recipients');

const RSVP_SLUG_RE = /^[A-Za-z0-9_-]{6,22}$/;

const newRsvpSlugCandidate = (): string =>
  randomBytes(6)
    .toString('base64url')
    .replace(/=/g, '')
    .slice(0, 10);

const nowIso = () => new Date().toISOString();

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

export const createWhatsAppSendJobInWedding = async (
  weddingId: string,
  payload: {
    messageTemplate: string;
    rsvpLink: string;
    mediaDataUrl?: string;
    mediaFileName?: string;
    progressSessionId?: string | null;
    idempotencyKey?: string;
    filters?: WhatsAppSendJob['filters'];
    recipients: Array<Pick<Guest, 'id' | 'name' | 'phoneNumber'>>;
  }
): Promise<WhatsAppSendJob> => {
  const createdAt = nowIso();
  const jobId = randomUUID();
  const job: WhatsAppSendJob = {
    id: jobId,
    weddingId,
    status: 'queued',
    messageTemplate: payload.messageTemplate,
    rsvpLink: payload.rsvpLink,
    mediaDataUrl: payload.mediaDataUrl,
    mediaFileName: payload.mediaFileName,
    totalRecipients: payload.recipients.length,
    processedCount: 0,
    sentCount: 0,
    failedCount: 0,
    createdAt,
    updatedAt: createdAt,
    startedAt: createdAt,
    progressSessionId: payload.progressSessionId ?? null,
    currentGuestId: null,
    lastProcessedGuestId: null,
    idempotencyKey: payload.idempotencyKey,
    lockOwner: null,
    leaseUntil: null,
    filters: payload.filters,
  };
  const jobRef = sendJobsCollection(weddingId).doc(jobId);
  await jobRef.set(job);

  const chunkSize = 400;
  for (let i = 0; i < payload.recipients.length; i += chunkSize) {
    const batch = firestore.batch();
    const chunk = payload.recipients.slice(i, i + chunkSize);
    chunk.forEach((recipient, offset) => {
      const orderIndex = i + offset;
      const recipientId = `${String(orderIndex).padStart(6, '0')}-${recipient.id}`;
      const recipientDoc: WhatsAppSendJobRecipient = {
        id: recipientId,
        jobId,
        weddingId,
        guestId: recipient.id,
        guestName: recipient.name,
        phoneNumber: recipient.phoneNumber,
        orderIndex,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
      };
      batch.set(sendJobRecipientsCollection(weddingId, jobId).doc(recipientId), recipientDoc);
    });
    await batch.commit();
  }

  return job;
};

export const findActiveWhatsAppSendJob = async (
  weddingId: string
): Promise<WhatsAppSendJob | null> => {
  const snapshot = await sendJobsCollection(weddingId)
    .where('status', 'in', ['queued', 'running'])
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  if (snapshot.empty) {
    return null;
  }
  return snapshot.docs[0].data() as WhatsAppSendJob;
};

export const findWhatsAppSendJobByIdempotencyKey = async (
  weddingId: string,
  idempotencyKey: string
): Promise<WhatsAppSendJob | null> => {
  const key = idempotencyKey.trim();
  if (!key) {
    return null;
  }
  const snapshot = await sendJobsCollection(weddingId)
    .where('idempotencyKey', '==', key)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  if (snapshot.empty) {
    return null;
  }
  return snapshot.docs[0].data() as WhatsAppSendJob;
};

export const getWhatsAppSendJob = async (
  weddingId: string,
  jobId: string
): Promise<WhatsAppSendJob | null> => {
  const doc = await sendJobsCollection(weddingId).doc(jobId).get();
  if (!doc.exists) {
    return null;
  }
  return doc.data() as WhatsAppSendJob;
};

export const updateWhatsAppSendJob = async (
  weddingId: string,
  jobId: string,
  updates: Partial<WhatsAppSendJob>
): Promise<WhatsAppSendJob | null> => {
  const ref = sendJobsCollection(weddingId).doc(jobId);
  const existing = await ref.get();
  if (!existing.exists) {
    return null;
  }
  const merged = {
    ...(existing.data() as WhatsAppSendJob),
    ...updates,
    updatedAt: nowIso(),
  };
  await ref.set(merged);
  return merged as WhatsAppSendJob;
};

export const claimWhatsAppSendJobLease = async (
  weddingId: string,
  jobId: string,
  owner: string,
  leaseMs: number
): Promise<boolean> => {
  const ref = sendJobsCollection(weddingId).doc(jobId);
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      return false;
    }
    const job = snap.data() as WhatsAppSendJob;
    const leaseUntil = job.leaseUntil ? Date.parse(job.leaseUntil) : 0;
    const current = Date.now();
    if (job.lockOwner && job.lockOwner !== owner && leaseUntil > current) {
      return false;
    }
    tx.update(ref, {
      lockOwner: owner,
      leaseUntil: new Date(current + leaseMs).toISOString(),
      updatedAt: nowIso(),
    });
    return true;
  });
};

export const releaseWhatsAppSendJobLease = async (
  weddingId: string,
  jobId: string,
  owner: string
) => {
  const ref = sendJobsCollection(weddingId).doc(jobId);
  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      return;
    }
    const job = snap.data() as WhatsAppSendJob;
    if (job.lockOwner !== owner) {
      return;
    }
    tx.update(ref, {
      lockOwner: null,
      leaseUntil: null,
      updatedAt: nowIso(),
    });
  });
};

export const getNextWhatsAppSendRecipient = async (
  weddingId: string,
  jobId: string
): Promise<WhatsAppSendJobRecipient | null> => {
  const recipients = sendJobRecipientsCollection(weddingId, jobId);
  const pending = await recipients.where('status', '==', 'pending').orderBy('orderIndex', 'asc').limit(1).get();
  if (!pending.empty) {
    return pending.docs[0].data() as WhatsAppSendJobRecipient;
  }
  const retry = await recipients.where('status', '==', 'retry').orderBy('nextRetryAt', 'asc').limit(1).get();
  if (retry.empty) {
    return null;
  }
  const candidate = retry.docs[0].data() as WhatsAppSendJobRecipient;
  if (!candidate.nextRetryAt || Date.parse(candidate.nextRetryAt) <= Date.now()) {
    return candidate;
  }
  return null;
};

export const getWhatsAppRetryRecipientCount = async (
  weddingId: string,
  jobId: string
): Promise<number> => {
  const snap = await sendJobRecipientsCollection(weddingId, jobId).where('status', '==', 'retry').get();
  return snap.size;
};

export const updateWhatsAppSendRecipient = async (
  weddingId: string,
  jobId: string,
  recipientId: string,
  updates: Partial<WhatsAppSendJobRecipient>
): Promise<WhatsAppSendJobRecipient | null> => {
  const ref = sendJobRecipientsCollection(weddingId, jobId).doc(recipientId);
  const existing = await ref.get();
  if (!existing.exists) {
    return null;
  }
  const merged = {
    ...(existing.data() as WhatsAppSendJobRecipient),
    ...updates,
  };
  await ref.set(merged);
  return merged as WhatsAppSendJobRecipient;
};
