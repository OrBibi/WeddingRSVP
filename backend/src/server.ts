import cors from 'cors';
import express from 'express';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { Guest, GuestStatus } from '../../shared/types';
import QRCode from 'qrcode';
import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js';
import {
  addGuestToWedding,
  bulkUpdateGuestGroups,
  createGroupInWedding,
  deleteGuestInWedding,
  deleteGroupInWedding,
  ensureGuestRsvpSlug,
  ensureGuestRsvpToken,
  findActiveWhatsAppSendJob,
  findGuestById,
  findGuestByPhone,
  findGuestByRsvpSlug,
  findWhatsAppSendJobByIdempotencyKey,
  getNextWhatsAppSendRecipient,
  getWhatsAppRetryRecipientCount,
  getWhatsAppSendJob,
  getGuestsByWeddingId,
  getGroupsByWeddingId,
  importGuestsToWedding,
  claimWhatsAppSendJobLease,
  createWhatsAppSendJobInWedding,
  releaseWhatsAppSendJobLease,
  updateWhatsAppSendJob,
  updateWhatsAppSendRecipient,
  updateGuestInWedding,
} from './firestoreService';
import { normalizePhoneForComparison, formatPhoneForWhatsApp } from './phoneUtils';
import type { WhatsAppSendJob, WhatsAppSendJobRecipient, WhatsAppSendJobStatus } from '../../shared/types';
import { computeRetryDelayMs, isTransientWhatsAppError } from './whatsappRetry';

const app = express();
const PORT = process.env.PORT || 3001;
const WA_DELAY_MIN_MS = Number(process.env.WA_DELAY_MIN_MS ?? 2000);
const WA_DELAY_MAX_MS = Number(process.env.WA_DELAY_MAX_MS ?? 7000);
const DEFAULT_WEDDING_ID = process.env.DEFAULT_WEDDING_ID?.trim() || 'default-wedding';
/** When not `false`, WhatsApp RSVP links use `/r/{weddingId}/{slug}` when a slug exists; otherwise the long `/rsvp/.../guestId` URL is used. */
const RSVP_SHORT_LINKS_ENABLED = process.env.RSVP_SHORT_LINKS?.trim() !== 'false';

const buildGuestRsvpUrl = (
  baseNoTrailingSlash: string,
  weddingId: string,
  guestId: string,
  token: string,
  slug: string | null
): string => {
  const encWedding = encodeURIComponent(weddingId);
  const encToken = encodeURIComponent(token);
  if (RSVP_SHORT_LINKS_ENABLED && slug) {
    return `${baseNoTrailingSlash}/r/${encWedding}/${encodeURIComponent(slug)}?token=${encToken}`;
  }
  return `${baseNoTrailingSlash}/rsvp/${encWedding}/${encodeURIComponent(guestId)}?token=${encToken}`;
};

app.use(cors());
app.use(express.json({ limit: '15mb' }));

type WhatsAppSessionState = {
  client: Client;
  isReady: boolean;
  latestQrCode: string | null;
  latestError: string | null;
  initializing: boolean;
};

const whatsappSessions = new Map<string, WhatsAppSessionState>();

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const getRandomDelayMs = () => {
  const min = Number.isFinite(WA_DELAY_MIN_MS) ? WA_DELAY_MIN_MS : 2000;
  const max = Number.isFinite(WA_DELAY_MAX_MS) ? WA_DELAY_MAX_MS : 7000;
  const safeMin = Math.max(0, Math.min(min, max));
  const safeMax = Math.max(safeMin, max);
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
};

const getOrCreateWhatsAppSession = (uid: string): WhatsAppSessionState => {
  const existing = whatsappSessions.get(uid);
  if (existing) {
    return existing;
  }

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: uid,
      dataPath: './.wwebjs_auth',
    }),
    puppeteer: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  const sessionState: WhatsAppSessionState = {
    client,
    isReady: false,
    latestQrCode: null,
    latestError: null,
    initializing: true,
  };

  client.on('qr', (qr) => {
    sessionState.latestQrCode = qr;
    sessionState.latestError = null;
    sessionState.isReady = false;
    console.log(`WhatsApp QR code updated for user ${uid}.`);
  });

  client.on('ready', () => {
    sessionState.isReady = true;
    sessionState.latestQrCode = null;
    sessionState.latestError = null;
    sessionState.initializing = false;
    console.log(`WhatsApp client is ready for user ${uid}.`);
  });

  client.on('auth_failure', (message) => {
    sessionState.isReady = false;
    sessionState.latestError = message;
    sessionState.initializing = false;
    console.error(`WhatsApp auth failure for user ${uid}: ${message}`);
  });

  client.on('disconnected', (reason) => {
    sessionState.isReady = false;
    sessionState.latestError = reason;
    sessionState.initializing = false;
    console.warn(`WhatsApp client disconnected for user ${uid}: ${reason}`);
  });

  void client.initialize().catch((error: unknown) => {
    sessionState.isReady = false;
    sessionState.initializing = false;
    sessionState.latestError =
      error instanceof Error ? error.message : 'Unknown WhatsApp initialization error';
    console.error(`WhatsApp initialization failed for user ${uid}:`, sessionState.latestError);
  });

  whatsappSessions.set(uid, sessionState);
  return sessionState;
};

const disconnectWhatsAppSession = async (uid: string) => {
  const session = whatsappSessions.get(uid);
  if (!session) {
    return false;
  }

  session.isReady = false;
  session.initializing = false;
  session.latestQrCode = null;

  try {
    await session.client.logout();
  } catch (error) {
    console.warn(`WhatsApp logout failed for user ${uid}:`, error);
  }

  try {
    await session.client.destroy();
  } catch (error) {
    console.warn(`WhatsApp destroy failed for user ${uid}:`, error);
  }

  whatsappSessions.delete(uid);
  return true;
};

const statuses: GuestStatus[] = ['Pending', 'Attending', 'Not Attending'];
type StatusFilter = 'All' | GuestStatus;
type MessageSentFilter = 'All' | 'Sent' | 'Not Sent';
type WhatsAppProgressState = {
  totalRecipients: number;
  processedCount: number;
  sentCount: number;
  failedCount: number;
  currentGuestId: string | null;
};
type ProgressEvent = 'started' | 'progress' | 'completed' | 'error';

const whatsappProgressStreams = new Map<string, Response>();

const isValidStatus = (value: unknown): value is GuestStatus =>
  typeof value === 'string' && statuses.includes(value as GuestStatus);
const isValidStatusFilter = (value: unknown): value is StatusFilter =>
  value === 'All' || isValidStatus(value);
const isValidMessageSentFilter = (value: unknown): value is MessageSentFilter =>
  value === 'All' || value === 'Sent' || value === 'Not Sent';

const filterGuestsByStatus = (guests: Guest[], statusFilter: StatusFilter) => {
  if (statusFilter === 'All') {
    return guests;
  }
  return guests.filter((guest) => guest.status === statusFilter);
};

const filterGuestsByGroup = (guests: Guest[], groupId?: string) => {
  if (!groupId?.trim()) {
    return guests;
  }
  return guests.filter((guest) => Array.isArray(guest.groupIds) && guest.groupIds.includes(groupId));
};

const filterGuestsByMessageSent = (guests: Guest[], messageSentFilter: MessageSentFilter) => {
  if (messageSentFilter === 'All') {
    return guests;
  }
  if (messageSentFilter === 'Sent') {
    return guests.filter((guest) => Boolean(guest.messageSent));
  }
  return guests.filter((guest) => !guest.messageSent);
};

const filterGuestsBySelectedIds = (guests: Guest[], selectedGuestIds?: string[]) => {
  if (!Array.isArray(selectedGuestIds) || selectedGuestIds.length === 0) {
    return guests;
  }
  const idSet = new Set(selectedGuestIds);
  return guests.filter((guest) => idSet.has(guest.id));
};

const emitProgressEvent = (sessionId: string, event: ProgressEvent, payload: unknown) => {
  const stream = whatsappProgressStreams.get(sessionId);
  if (!stream) {
    return;
  }

  stream.write(`event: ${event}\n`);
  stream.write(`data: ${JSON.stringify(payload)}\n\n`);
};

/** WhatsApp has no HTML-style hyperlinks; the URL stays visible. This block adds a clear Hebrew line above it. */
const RSVP_LINK_HERE_PLACEHOLDER = '{{link_here}}';

const buildWhatsAppGuestMessage = (messageTemplate: string, guestName: string, singleGuestLink: string): string => {
  const linkHereBlock = `לחץ כאן\n\u200E${singleGuestLink}`;
  return messageTemplate
    .replaceAll('{{name}}', guestName)
    .replaceAll(RSVP_LINK_HERE_PLACEHOLDER, linkHereBlock)
    .replaceAll('{{link}}', singleGuestLink);
};

type SendJobStartPayload = {
  messageTemplate: string;
  statusFilter: StatusFilter;
  messageSentFilter: MessageSentFilter;
  rsvpLink: string;
  media?: { dataUrl?: string; fileName?: string } | null;
  groupId?: string;
  selectedGuestIds?: string[];
  progressSessionId?: string;
  idempotencyKey?: string;
};

const JOB_LEASE_MS = Number(process.env.WA_JOB_LEASE_MS ?? 45000);
const MAX_RETRY_ATTEMPTS = Number(process.env.WA_MAX_RETRY_ATTEMPTS ?? 3);
const RETRY_BACKOFF_BASE_MS = Number(process.env.WA_RETRY_BACKOFF_BASE_MS ?? 5000);
const RETRY_BACKOFF_CAP_MS = Number(process.env.WA_RETRY_BACKOFF_CAP_MS ?? 120000);
const runningJobById = new Set<string>();

const emitJobProgress = (job: WhatsAppSendJob) => {
  if (!job.progressSessionId) {
    return;
  }
  emitProgressEvent(job.progressSessionId, 'progress', {
    totalRecipients: job.totalRecipients,
    processedCount: job.processedCount,
    sentCount: job.sentCount,
    failedCount: job.failedCount,
    currentGuestId: job.currentGuestId ?? null,
  });
};

const startProgressForJob = (job: WhatsAppSendJob) => {
  if (!job.progressSessionId) {
    return;
  }
  emitProgressEvent(job.progressSessionId, 'started', {
    totalRecipients: job.totalRecipients,
    processedCount: job.processedCount,
    sentCount: job.sentCount,
    failedCount: job.failedCount,
    currentGuestId: job.currentGuestId ?? null,
  });
};

const completeProgressForJob = (job: WhatsAppSendJob, event: 'completed' | 'error') => {
  if (!job.progressSessionId) {
    return;
  }
  if (event === 'completed') {
    emitProgressEvent(job.progressSessionId, 'completed', {
      totalRecipients: job.totalRecipients,
      processedCount: job.processedCount,
      sentCount: job.sentCount,
      failedCount: job.failedCount,
      currentGuestId: null,
    });
    return;
  }
  emitProgressEvent(job.progressSessionId, 'error', {
    message: job.lastError ?? 'Unknown error',
  });
};

const processRecipientInJob = async (
  weddingId: string,
  job: WhatsAppSendJob,
  recipient: WhatsAppSendJobRecipient,
  transientFailureStreak: number
): Promise<{ updatedJob: WhatsAppSendJob; transientFailureStreak: number }> => {
  const whatsappSession = getOrCreateWhatsAppSession(DEFAULT_WEDDING_ID);
  if (!whatsappSession.isReady) {
    const paused = await updateWhatsAppSendJob(weddingId, job.id, {
      status: 'paused',
      pausedAt: new Date().toISOString(),
      lastError: 'WhatsApp client disconnected during sending.',
      currentGuestId: null,
    });
    if (!paused) {
      throw new Error('Failed to pause disconnected job.');
    }
    throw new Error('WhatsAppDisconnected');
  }

  const token = (await ensureGuestRsvpToken(weddingId, recipient.guestId)) ?? '';
  const slug = RSVP_SHORT_LINKS_ENABLED ? await ensureGuestRsvpSlug(weddingId, recipient.guestId) : null;
  const singleGuestLink = buildGuestRsvpUrl(
    job.rsvpLink.replace(/\/$/, ''),
    weddingId,
    recipient.guestId,
    token,
    slug
  );
  const text = buildWhatsAppGuestMessage(job.messageTemplate, recipient.guestName, singleGuestLink);
  const formattedPhone = formatPhoneForWhatsApp(recipient.phoneNumber);
  const attempt = recipient.attempts + 1;
  const lastAttemptAt = new Date().toISOString();
  let messageMedia: MessageMedia | null = null;
  if (job.mediaDataUrl) {
    const mediaMatch = job.mediaDataUrl.match(/^data:(.+);base64,(.+)$/);
    if (mediaMatch) {
      const [, mimetype, base64Data] = mediaMatch;
      messageMedia = new MessageMedia(mimetype, base64Data, job.mediaFileName || 'attachment');
    }
  }

  let nextJob = await updateWhatsAppSendJob(weddingId, job.id, {
    currentGuestId: recipient.guestId,
  });
  if (!nextJob) {
    throw new Error('Failed to lock current guest.');
  }

  try {
    if (messageMedia) {
      await whatsappSession.client.sendMessage(formattedPhone, messageMedia, {
        caption: text,
        linkPreview: true,
      });
    } else {
      await whatsappSession.client.sendMessage(formattedPhone, text, { linkPreview: true });
    }
    await updateGuestInWedding(weddingId, recipient.guestId, {
      messageSent: true,
      lastMessageSentAt: new Date().toISOString(),
    });
    await updateWhatsAppSendRecipient(weddingId, job.id, recipient.id, {
      status: 'sent',
      attempts: attempt,
      sentAt: new Date().toISOString(),
      lastAttemptAt,
    });
    nextJob = await updateWhatsAppSendJob(weddingId, job.id, {
      sentCount: job.sentCount + 1,
      processedCount: job.processedCount + 1,
      lastProcessedGuestId: recipient.guestId,
      currentGuestId: null,
      status: 'running',
    });
    if (!nextJob) {
      throw new Error('Failed to update successful progress.');
    }
    emitJobProgress(nextJob);
    return { updatedJob: nextJob, transientFailureStreak: 0 };
  } catch (error) {
    const transient = isTransientWhatsAppError(error);
    const isRetryable = transient && attempt < Math.max(1, MAX_RETRY_ATTEMPTS);
    if (isRetryable) {
      const retryDelay = computeRetryDelayMs(attempt, RETRY_BACKOFF_BASE_MS, RETRY_BACKOFF_CAP_MS);
      await updateWhatsAppSendRecipient(weddingId, job.id, recipient.id, {
        status: 'retry',
        attempts: attempt,
        nextRetryAt: new Date(Date.now() + retryDelay).toISOString(),
        lastError: error instanceof Error ? error.message : 'Unknown retryable error',
        lastAttemptAt,
      });
      const resumed = await updateWhatsAppSendJob(weddingId, job.id, {
        currentGuestId: null,
        status: 'running',
        lastError: error instanceof Error ? error.message : 'Unknown retryable error',
      });
      if (!resumed) {
        throw new Error('Failed to update retry state.');
      }
      emitJobProgress(resumed);
      return {
        updatedJob: resumed,
        transientFailureStreak: transient ? transientFailureStreak + 1 : transientFailureStreak,
      };
    }
    await updateWhatsAppSendRecipient(weddingId, job.id, recipient.id, {
      status: 'failed',
      attempts: attempt,
      lastError: error instanceof Error ? error.message : 'Unknown non-retryable error',
      lastAttemptAt,
    });
    nextJob = await updateWhatsAppSendJob(weddingId, job.id, {
      failedCount: job.failedCount + 1,
      processedCount: job.processedCount + 1,
      lastProcessedGuestId: recipient.guestId,
      currentGuestId: null,
      status: 'running',
      lastError: error instanceof Error ? error.message : 'Unknown non-retryable error',
    });
    if (!nextJob) {
      throw new Error('Failed to update failed progress.');
    }
    emitJobProgress(nextJob);
    return { updatedJob: nextJob, transientFailureStreak: transient ? transientFailureStreak + 1 : 0 };
  }
};

const runWhatsAppJob = async (weddingId: string, jobId: string) => {
  if (runningJobById.has(jobId)) {
    return;
  }
  runningJobById.add(jobId);
  const owner = `runner-${randomUUID()}`;
  let transientFailureStreak = 0;

  try {
    while (true) {
      const lease = await claimWhatsAppSendJobLease(weddingId, jobId, owner, JOB_LEASE_MS);
      if (!lease) {
        return;
      }
      const job = await getWhatsAppSendJob(weddingId, jobId);
      if (!job) {
        return;
      }
      if (job.status === 'paused' || job.status === 'completed' || job.status === 'completed_with_failures') {
        completeProgressForJob(job, 'completed');
        return;
      }

      const recipient = await getNextWhatsAppSendRecipient(weddingId, job.id);
      if (!recipient) {
        const retries = await getWhatsAppRetryRecipientCount(weddingId, job.id);
        if (retries > 0) {
          await sleep(Math.min(3000, getRandomDelayMs()));
          continue;
        }
        const finalStatus: WhatsAppSendJobStatus = job.failedCount > 0 ? 'completed_with_failures' : 'completed';
        const done = await updateWhatsAppSendJob(weddingId, job.id, {
          status: finalStatus,
          completedAt: new Date().toISOString(),
          currentGuestId: null,
        });
        if (done) {
          completeProgressForJob(done, 'completed');
        }
        return;
      }

      if (job.status !== 'running') {
        await updateWhatsAppSendJob(weddingId, job.id, {
          status: 'running',
          startedAt: job.startedAt ?? new Date().toISOString(),
        });
      }

      const result = await processRecipientInJob(weddingId, job, recipient, transientFailureStreak);
      transientFailureStreak = result.transientFailureStreak;
      const adaptiveDelay = Math.min(30000, transientFailureStreak * 2000);
      await sleep(getRandomDelayMs() + adaptiveDelay);
    }
  } catch (error) {
    const failed = await updateWhatsAppSendJob(weddingId, jobId, {
      status: 'paused',
      pausedAt: new Date().toISOString(),
      currentGuestId: null,
      lastError: error instanceof Error ? error.message : 'Unknown job error',
    });
    if (failed) {
      completeProgressForJob(failed, 'error');
    }
  } finally {
    await releaseWhatsAppSendJobLease(weddingId, jobId, owner);
    runningJobById.delete(jobId);
  }
};

app.get('/api/notifications/whatsapp/progress/:sessionId', (req, res) => {
  const sessionId = String(req.params.sessionId ?? '').trim();
  if (!sessionId) {
    return res.status(400).json({ message: 'sessionId is required.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  whatsappProgressStreams.set(sessionId, res);

  req.on('close', () => {
    whatsappProgressStreams.delete(sessionId);
  });
});

app.post('/api/auth/bootstrap', async (_req, res) => {
  return res.json({
    message: 'Single-user mode is active.',
    user: {
      uid: DEFAULT_WEDDING_ID,
      email: null,
      weddingId: DEFAULT_WEDDING_ID,
    },
  });
});

app.get('/api/guests', async (_req, res) => {
  const guests = await getGuestsByWeddingId(DEFAULT_WEDDING_ID);
  return res.json(guests);
});

app.get('/api/groups', async (_req, res) => {
  const groups = await getGroupsByWeddingId(DEFAULT_WEDDING_ID);
  return res.json(groups);
});

app.post('/api/groups', async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) {
    return res.status(400).json({ message: 'name is required.' });
  }

  const existingGroups = await getGroupsByWeddingId(DEFAULT_WEDDING_ID);
  const hasDuplicate = existingGroups.some(
    (group) => group.name.trim().toLowerCase() === name.trim().toLowerCase()
  );
  if (hasDuplicate) {
    return res.status(409).json({ message: 'Group name already exists.' });
  }

  const group = await createGroupInWedding(DEFAULT_WEDDING_ID, name.trim());
  return res.status(201).json(group);
});

app.delete('/api/groups/:id', async (req, res) => {
  const id = String(req.params.id ?? '');
  if (!id) {
    return res.status(400).json({ message: 'id is required.' });
  }

  const deleted = await deleteGroupInWedding(DEFAULT_WEDDING_ID, id);
  if (!deleted) {
    return res.status(404).json({ message: 'Group not found.' });
  }

  const guests = await getGuestsByWeddingId(DEFAULT_WEDDING_ID);
  await Promise.all(
    guests
      .filter((guest) => guest.groupIds.includes(id))
      .map((guest) =>
        updateGuestInWedding(DEFAULT_WEDDING_ID, guest.id, {
          groupIds: guest.groupIds.filter((groupId) => groupId !== id),
        })
      )
  );

  return res.json({ message: 'Group deleted successfully.' });
});

app.post('/api/guests', async (req, res) => {
  const { name, phoneNumber, partySize } = req.body as Partial<Guest>;
  if (!name || !phoneNumber || typeof partySize !== 'number') {
    return res
      .status(400)
      .json({ message: 'name, phoneNumber, and partySize are required.' });
  }

  const normalizedPhone = normalizePhoneForComparison(phoneNumber);
  const allGuests = await getGuestsByWeddingId(DEFAULT_WEDDING_ID);
  const existing = allGuests.find(
    (guest) => normalizePhoneForComparison(guest.phoneNumber) === normalizedPhone
  );
  if (existing) {
    return res.status(409).json({ message: 'Phone number must be unique.' });
  }

  const guest = await addGuestToWedding(DEFAULT_WEDDING_ID, {
    name: name.trim(),
    phoneNumber: phoneNumber.trim(),
    expectedPartySize: partySize,
  });
  return res.status(201).json(guest);
});

app.post('/api/guests/import', async (req, res) => {
  const { guests: rawGuests } = req.body as {
    guests?: Array<{
      name?: string;
      phoneNumber?: string;
      expectedPartySize?: number;
      status?: string;
      groupIds?: string[];
    }>;
  };

  if (!Array.isArray(rawGuests) || rawGuests.length === 0) {
    return res.status(400).json({ message: 'guests array is required.' });
  }

  const normalizeImportedStatus = (value: string | undefined): GuestStatus => {
    if (!value?.trim()) {
      return 'Pending';
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === 'attending' || normalized === 'מגיע') {
      return 'Attending';
    }
    if (normalized === 'not attending' || normalized === 'לא מגיע') {
      return 'Not Attending';
    }
    return 'Pending';
  };

  const normalizedRows: Array<{
    name: string;
    phoneNumber: string;
    expectedPartySize: number;
    status: GuestStatus;
    groupIds: string[];
  }> = [];

  rawGuests.forEach((item, index) => {
    const name = item.name?.trim();
    const phoneNumber = item.phoneNumber?.trim() || `IMPORT-${Date.now()}-${index}`;
    const expectedPartySize = Number(item.expectedPartySize);
    const status = normalizeImportedStatus(item.status);
    const groupIds = Array.isArray(item.groupIds)
      ? item.groupIds.filter((groupId): groupId is string => typeof groupId === 'string')
      : [];

    if (!name || !Number.isFinite(expectedPartySize) || expectedPartySize < 1) {
      return;
    }

    normalizedRows.push({
      name,
      phoneNumber,
      expectedPartySize,
      status,
      groupIds: [...new Set(groupIds)],
    });
  });

  const uniqueByPhone = new Map<string, (typeof normalizedRows)[number]>();
  normalizedRows.forEach((row) => {
    uniqueByPhone.set(normalizePhoneForComparison(row.phoneNumber), row);
  });
  const deduplicatedRows = [...uniqueByPhone.values()];
  const skippedInvalidRows = rawGuests.length - deduplicatedRows.length;

  const { createdGuests, skippedCount } = await importGuestsToWedding(
    DEFAULT_WEDDING_ID,
    deduplicatedRows
  );

  return res.json({
    message: 'Guests imported successfully.',
    createdCount: createdGuests.length,
    skippedCount: skippedCount + skippedInvalidRows,
    guests: createdGuests,
  });
});

app.post('/api/guests/bulk-groups', async (req, res) => {
  const { guestIds, groupId, action } = req.body as {
    guestIds?: string[];
    groupId?: string;
    action?: 'add' | 'remove';
  };

  if (!Array.isArray(guestIds) || guestIds.length === 0 || !groupId || !action) {
    return res.status(400).json({ message: 'guestIds, groupId, and action are required.' });
  }
  if (action !== 'add' && action !== 'remove') {
    return res.status(400).json({ message: 'action must be add or remove.' });
  }

  const groups = await getGroupsByWeddingId(DEFAULT_WEDDING_ID);
  const groupExists = groups.some((group) => group.id === groupId);
  if (!groupExists) {
    return res.status(404).json({ message: 'Group not found.' });
  }

  const result = await bulkUpdateGuestGroups(DEFAULT_WEDDING_ID, guestIds, groupId, action);
  return res.json({
    message: 'Guest groups updated successfully.',
    updatedCount: result.updatedCount,
  });
});

app.delete('/api/guests/:phoneNumber', async (req, res) => {
  const { phoneNumber } = req.params;
  if (!phoneNumber) {
    return res.status(400).json({ message: 'phoneNumber is required.' });
  }

  try {
    const guests = await getGuestsByWeddingId(DEFAULT_WEDDING_ID);
    const existing = guests.find((guest) => guest.phoneNumber === phoneNumber);
    if (!existing) {
      return res.status(404).json({ message: 'Guest not found for that phone number.' });
    }
    const deleted = await deleteGuestInWedding(DEFAULT_WEDDING_ID, existing.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Guest not found for that phone number.' });
    }
    return res.json({ message: 'Guest deleted successfully.', guest: deleted });
  } catch {
    return res.status(500).json({ message: 'Failed to delete guest.' });
  }
});

app.put('/api/guests/:phoneNumber', async (req, res) => {
  const { phoneNumber } = req.params;
  const { name, newPhoneNumber, expectedPartySize, status, partySize, groupIds } = req.body as {
    name?: string;
    newPhoneNumber?: string;
    expectedPartySize?: number;
    status?: GuestStatus;
    partySize?: number;
    groupIds?: string[];
  };

  const allGuests = await getGuestsByWeddingId(DEFAULT_WEDDING_ID);
  const currentGuest = allGuests.find((guest) => guest.phoneNumber === phoneNumber);
  if (!currentGuest) {
    return res.status(404).json({ message: 'Guest not found for that phone number.' });
  }

  if (
    typeof expectedPartySize !== 'undefined' &&
    (typeof expectedPartySize !== 'number' || expectedPartySize < 1)
  ) {
    return res.status(400).json({ message: 'expectedPartySize must be a number greater than 0.' });
  }
  if (typeof status !== 'undefined' && !isValidStatus(status)) {
    return res.status(400).json({ message: 'status is invalid.' });
  }
  if (typeof partySize !== 'undefined' && (typeof partySize !== 'number' || partySize < 0)) {
    return res.status(400).json({ message: 'partySize must be a non-negative number.' });
  }
  if (typeof groupIds !== 'undefined' && !Array.isArray(groupIds)) {
    return res.status(400).json({ message: 'groupIds must be an array.' });
  }

  if (newPhoneNumber && newPhoneNumber !== phoneNumber) {
    const normalizedNewPhone = normalizePhoneForComparison(newPhoneNumber);
    const hasConflict = allGuests.some(
      (guest) =>
        guest.phoneNumber !== phoneNumber &&
        normalizePhoneForComparison(guest.phoneNumber) === normalizedNewPhone
    );
    if (hasConflict) {
      return res.status(409).json({ message: 'Phone number must be unique.' });
    }
  }

  const updated = await updateGuestInWedding(DEFAULT_WEDDING_ID, currentGuest.id, {
    name: typeof name === 'string' ? name.trim() : undefined,
    phoneNumber: typeof newPhoneNumber === 'string' ? newPhoneNumber.trim() : undefined,
    expectedPartySize,
    status,
    partySize,
    groupIds: Array.isArray(groupIds) ? [...new Set(groupIds)] : undefined,
  });

  if (!updated) {
    return res.status(404).json({ message: 'Guest not found for that phone number.' });
  }

  return res.json(updated as Guest);
});

app.post('/api/notifications/trigger', async (_req, res) => {
  const guests = await getGuestsByWeddingId(DEFAULT_WEDDING_ID);
  const pendingGuests = guests.filter((guest) => guest.status === 'Pending');

  pendingGuests.forEach((guest) => {
    console.log(
      `[SMS SENT] "היי ${guest.name}, נשמח לראותכם! אנא אל תשכחו לאשר הגעה לחתונה שלנו."`
    );
  });

  return res.json({
    message: 'Notifications triggered successfully.',
    sentCount: pendingGuests.length,
  });
});

const createWhatsAppSendJob = async (payload: SendJobStartPayload) => {
  const {
    messageTemplate,
    statusFilter,
    rsvpLink,
    media,
    groupId,
    messageSentFilter,
    selectedGuestIds,
    progressSessionId,
    idempotencyKey,
  } = payload;
  if (
    !messageTemplate?.trim() ||
    !rsvpLink?.trim() ||
    !isValidStatusFilter(statusFilter) ||
    !isValidMessageSentFilter(messageSentFilter)
  ) {
    throw new Error('messageTemplate, rsvpLink, valid statusFilter, and valid messageSentFilter are required.');
  }
  const trimmedTemplate = messageTemplate.trim();
  if (!trimmedTemplate.includes('{{link}}') && !trimmedTemplate.includes(RSVP_LINK_HERE_PLACEHOLDER)) {
    throw new Error('messageTemplate must include {{link}} or {{link_here}} so each guest gets their personal RSVP URL.');
  }
  if (media && typeof media.dataUrl !== 'string') {
    throw new Error('media.dataUrl must be a base64 data URL string.');
  }
  const weddingId = DEFAULT_WEDDING_ID;
  const activeJob = await findActiveWhatsAppSendJob(weddingId);
  if (activeJob) {
    const incomingSessionId = typeof progressSessionId === 'string' ? progressSessionId.trim() : '';
    if (incomingSessionId && activeJob.progressSessionId !== incomingSessionId) {
      const rebound = await updateWhatsAppSendJob(weddingId, activeJob.id, {
        progressSessionId: incomingSessionId,
      });
      if (rebound) {
        emitJobProgress(rebound);
        return { reused: true, job: rebound };
      }
    }
    return { reused: true, job: activeJob };
  }
  const dedupeKey = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
  if (dedupeKey) {
    const existing = await findWhatsAppSendJobByIdempotencyKey(weddingId, dedupeKey);
    if (existing) {
      return { reused: true, job: existing };
    }
  }

  const allGuests = await getGuestsByWeddingId(weddingId);
  const statusFiltered = filterGuestsByStatus(allGuests, statusFilter);
  const groupFiltered = filterGuestsByGroup(statusFiltered, groupId);
  const sentFiltered = filterGuestsByMessageSent(groupFiltered, messageSentFilter);
  const guestsToNotify = filterGuestsBySelectedIds(sentFiltered, selectedGuestIds);
  if (guestsToNotify.length === 0) {
    throw new Error('No guests match the selected filters.');
  }

  const job = await createWhatsAppSendJobInWedding(weddingId, {
    messageTemplate: trimmedTemplate,
    rsvpLink: rsvpLink.trim(),
    mediaDataUrl: media?.dataUrl,
    mediaFileName: media?.fileName,
    progressSessionId: typeof progressSessionId === 'string' ? progressSessionId.trim() : '',
    idempotencyKey: dedupeKey || undefined,
    filters: {
      statusFilter,
      messageSentFilter,
      groupId: groupId ?? undefined,
      selectedGuestIds: Array.isArray(selectedGuestIds) ? selectedGuestIds : undefined,
    },
    recipients: guestsToNotify.map((guest) => ({
      id: guest.id,
      name: guest.name,
      phoneNumber: guest.phoneNumber,
    })),
  });
  startProgressForJob(job);
  void runWhatsAppJob(weddingId, job.id);
  return { reused: false, job };
};

app.post('/api/notifications/whatsapp/jobs', async (req, res) => {
  const whatsappSession = getOrCreateWhatsAppSession(DEFAULT_WEDDING_ID);
  if (!whatsappSession.isReady) {
    return res.status(503).json({
      message: 'WhatsApp client is not ready for this user. Please scan your personal QR first.',
    });
  }
  try {
    const result = await createWhatsAppSendJob(req.body as SendJobStartPayload);
    return res.status(result.reused ? 200 : 201).json({
      message: result.reused ? 'Reusing existing active WhatsApp job.' : 'WhatsApp job created.',
      job: result.job,
    });
  } catch (error) {
    return res.status(400).json({
      message: error instanceof Error ? error.message : 'Failed to create WhatsApp send job.',
    });
  }
});

app.get('/api/notifications/whatsapp/jobs/:jobId', async (req, res) => {
  const jobId = String(req.params.jobId ?? '').trim();
  if (!jobId) {
    return res.status(400).json({ message: 'jobId is required.' });
  }
  const job = await getWhatsAppSendJob(DEFAULT_WEDDING_ID, jobId);
  if (!job) {
    return res.status(404).json({ message: 'WhatsApp job not found.' });
  }
  return res.json(job);
});

app.post('/api/notifications/whatsapp/jobs/:jobId/pause', async (req, res) => {
  const jobId = String(req.params.jobId ?? '').trim();
  if (!jobId) {
    return res.status(400).json({ message: 'jobId is required.' });
  }
  const job = await updateWhatsAppSendJob(DEFAULT_WEDDING_ID, jobId, {
    status: 'paused',
    pausedAt: new Date().toISOString(),
    currentGuestId: null,
  });
  if (!job) {
    return res.status(404).json({ message: 'WhatsApp job not found.' });
  }
  emitJobProgress(job);
  return res.json({ message: 'WhatsApp job paused.', job });
});

app.post('/api/notifications/whatsapp/jobs/:jobId/resume', async (req, res) => {
  const jobId = String(req.params.jobId ?? '').trim();
  if (!jobId) {
    return res.status(400).json({ message: 'jobId is required.' });
  }
  const whatsappSession = getOrCreateWhatsAppSession(DEFAULT_WEDDING_ID);
  if (!whatsappSession.isReady) {
    return res.status(503).json({
      message: 'WhatsApp client is not ready for this user. Please scan your personal QR first.',
    });
  }
  const job = await updateWhatsAppSendJob(DEFAULT_WEDDING_ID, jobId, {
    status: 'running',
    pausedAt: null,
    lastError: '',
  });
  if (!job) {
    return res.status(404).json({ message: 'WhatsApp job not found.' });
  }
  emitJobProgress(job);
  void runWhatsAppJob(DEFAULT_WEDDING_ID, job.id);
  return res.json({ message: 'WhatsApp job resumed.', job });
});

app.post('/api/notifications/whatsapp', async (req, res) => {
  const whatsappSession = getOrCreateWhatsAppSession(DEFAULT_WEDDING_ID);
  if (!whatsappSession.isReady) {
    return res.status(503).json({
      message: 'WhatsApp client is not ready for this user. Please scan your personal QR first.',
    });
  }
  try {
    const result = await createWhatsAppSendJob(req.body as SendJobStartPayload);
    return res.status(result.reused ? 200 : 201).json({
      message: 'WhatsApp notifications job accepted.',
      queuedCount: result.job.totalRecipients - result.job.processedCount,
      sentCount: result.job.sentCount,
      failedCount: result.job.failedCount,
      jobId: result.job.id,
      status: result.job.status,
    });
  } catch (error) {
    return res.status(400).json({
      message: error instanceof Error ? error.message : 'Failed to send WhatsApp notifications.',
    });
  }
});

app.post('/api/notifications/whatsapp/disconnect', async (_req, res) => {
  const disconnected = await disconnectWhatsAppSession(DEFAULT_WEDDING_ID);
  return res.json({
    message: disconnected
      ? 'WhatsApp client disconnected successfully.'
      : 'No active WhatsApp session found.',
  });
});

app.get('/api/public/rsvp/:weddingId/s/:slug', async (req, res) => {
  const { weddingId, slug } = req.params;
  const token = String(req.query.token ?? '');
  if (!weddingId || !slug || !token) {
    return res.status(400).json({ message: 'weddingId, slug, and token are required.' });
  }

  const guest = await findGuestByRsvpSlug(weddingId, slug);
  if (!guest || guest.rsvpToken !== token) {
    return res.status(404).json({ message: 'Invitation not found.' });
  }

  return res.json({
    id: guest.id,
    weddingId: guest.weddingId,
    name: guest.name,
    status: guest.status,
    partySize: guest.partySize,
  });
});

app.put('/api/public/rsvp/:weddingId/s/:slug', async (req, res) => {
  const { weddingId, slug } = req.params;
  const { token, status, partySize } = req.body as {
    token?: string;
    status?: GuestStatus;
    partySize?: number;
  };
  if (!weddingId || !slug || !token || !isValidStatus(status) || typeof partySize !== 'number') {
    return res.status(400).json({ message: 'token, status, and partySize are required.' });
  }

  const guest = await findGuestByRsvpSlug(weddingId, slug);
  if (!guest || guest.rsvpToken !== token) {
    return res.status(404).json({ message: 'Invitation not found.' });
  }

  const updated = await updateGuestInWedding(weddingId, guest.id, {
    status,
    partySize,
  });
  return res.json(updated);
});

app.get('/api/public/rsvp/:weddingId/:guestId', async (req, res) => {
  const { weddingId, guestId } = req.params;
  const token = String(req.query.token ?? '');
  if (!weddingId || !guestId || !token) {
    return res.status(400).json({ message: 'weddingId, guestId, and token are required.' });
  }

  const guest = await findGuestById(weddingId, guestId);
  if (!guest || guest.rsvpToken !== token) {
    return res.status(404).json({ message: 'Invitation not found.' });
  }

  return res.json({
    id: guest.id,
    weddingId: guest.weddingId,
    name: guest.name,
    status: guest.status,
    partySize: guest.partySize,
  });
});

app.put('/api/public/rsvp/:weddingId/:guestId', async (req, res) => {
  const { weddingId, guestId } = req.params;
  const { token, status, partySize } = req.body as {
    token?: string;
    status?: GuestStatus;
    partySize?: number;
  };
  if (!weddingId || !guestId || !token || !isValidStatus(status) || typeof partySize !== 'number') {
    return res.status(400).json({ message: 'token, status, and partySize are required.' });
  }

  const guest = await findGuestById(weddingId, guestId);
  if (!guest || guest.rsvpToken !== token) {
    return res.status(404).json({ message: 'Invitation not found.' });
  }

  const updated = await updateGuestInWedding(weddingId, guestId, {
    status,
    partySize,
  });
  return res.json(updated);
});

app.put('/api/rsvp', async (req, res) => {
  const { phoneNumber, status, partySize } = req.body as {
    phoneNumber?: string;
    status?: GuestStatus;
    partySize?: number;
  };
  if (!phoneNumber || !isValidStatus(status) || typeof partySize !== 'number') {
    return res.status(400).json({ message: 'phoneNumber, status, and partySize are required.' });
  }

  const guest = await findGuestByPhone(DEFAULT_WEDDING_ID, phoneNumber.trim());
  if (!guest) {
    return res.status(404).json({ message: 'Guest not found for that phone number.' });
  }
  const updated = await updateGuestInWedding(DEFAULT_WEDDING_ID, guest.id, {
    status,
    partySize,
  });
  return res.json(updated);
});

app.get('/api/notifications/whatsapp/status', async (_req, res) => {
  const whatsappSession = getOrCreateWhatsAppSession(DEFAULT_WEDDING_ID);

  if (whatsappSession.isReady) {
    return res.json({
      isReady: true,
      qrDataUrl: null,
      message: 'WhatsApp client is connected.',
    });
  }

  if (!whatsappSession.latestQrCode) {
    return res.json({
      isReady: false,
      qrDataUrl: null,
      message: whatsappSession.latestError
        ? `WhatsApp client error: ${whatsappSession.latestError}`
        : whatsappSession.initializing
          ? 'WhatsApp is initializing. Wait a few seconds and retry.'
          : 'QR code is not available yet. Wait a few seconds and retry.',
    });
  }

  try {
    const qrDataUrl = await QRCode.toDataURL(whatsappSession.latestQrCode, {
      margin: 1,
      width: 320,
    });
    return res.json({
      isReady: false,
      qrDataUrl,
      message: 'Scan this QR code with WhatsApp to connect.',
    });
  } catch {
    return res.json({
      isReady: false,
      qrDataUrl: null,
      message: 'Failed to generate WhatsApp QR code image.',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Wedding RSVP backend running on http://localhost:${PORT}`);
});
