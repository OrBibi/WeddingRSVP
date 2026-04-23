import cors from 'cors';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { Guest, GuestStatus } from '../../shared/types';
import QRCode from 'qrcode';
import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js';
import {
  addGuestToWedding,
  bulkUpdateGuestGroups,
  createGroupInWedding,
  deleteGuestInWedding,
  deleteGroupInWedding,
  ensureGuestRsvpToken,
  ensureUserWedding,
  findGuestById,
  findGuestByPhone,
  getGuestsByWeddingId,
  getGroupsByWeddingId,
  importGuestsToWedding,
  updateGuestInWedding,
} from './firestoreService';
import { firebaseAdminAuth } from './firebaseAdmin';

const app = express();
const PORT = process.env.PORT || 3001;
const WA_DELAY_MIN_MS = Number(process.env.WA_DELAY_MIN_MS ?? 2000);
const WA_DELAY_MAX_MS = Number(process.env.WA_DELAY_MAX_MS ?? 7000);

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
type AuthenticatedRequest = Request & { user: { uid: string; email?: string } };

const isValidStatus = (value: unknown): value is GuestStatus =>
  typeof value === 'string' && statuses.includes(value as GuestStatus);
const isValidStatusFilter = (value: unknown): value is StatusFilter =>
  value === 'All' || isValidStatus(value);

const normalizePhoneForComparison = (phone: string): string => {
  const digitsOnly = phone.replace(/\D/g, '');
  if (digitsOnly.startsWith('972')) {
    return `0${digitsOnly.slice(3)}`;
  }
  if (digitsOnly.length === 9) {
    return `0${digitsOnly}`;
  }
  return digitsOnly;
};

const formatPhoneForWhatsApp = (phone: string): string => {
  const trimmed = phone.trim();
  if (trimmed.startsWith('+')) {
    return `${trimmed.replace(/\D/g, '')}@c.us`;
  }

  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.startsWith('972')) {
    return `${digitsOnly}@c.us`;
  }

  const withoutLeadingZero = digitsOnly.startsWith('0') ? digitsOnly.slice(1) : digitsOnly;
  return `972${withoutLeadingZero}@c.us`;
};

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

const sendWhatsAppBatch = async (
  client: Client,
  weddingId: string,
  guestsToNotify: Guest[],
  messageTemplate: string,
  rsvpLink: string,
  media?: { dataUrl: string; fileName?: string } | null
): Promise<{ sentCount: number; failedCount: number }> => {
  let sentCount = 0;
  let failedCount = 0;
  let messageMedia: MessageMedia | null = null;

  if (media?.dataUrl) {
    const mediaMatch = media.dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!mediaMatch) {
      throw new Error('Invalid media dataUrl format.');
    }
    const [, mimetype, base64Data] = mediaMatch;
    messageMedia = new MessageMedia(mimetype, base64Data, media.fileName || 'attachment');
  }

  for (const [index, guest] of guestsToNotify.entries()) {
    const token = (await ensureGuestRsvpToken(weddingId, guest.id)) ?? '';
    const singleGuestLink = `${rsvpLink.replace(/\/$/, '')}/rsvp/${weddingId}/${guest.id}?token=${token}`;
    const text = messageTemplate
      .replaceAll('{{name}}', guest.name)
      .replaceAll('{{link}}', singleGuestLink);
    const formattedPhone = formatPhoneForWhatsApp(guest.phoneNumber);

    try {
      if (messageMedia) {
        await client.sendMessage(formattedPhone, messageMedia, { caption: text });
      } else {
        await client.sendMessage(formattedPhone, text);
      }
      sentCount += 1;
    } catch (error) {
      failedCount += 1;
      console.error(`WhatsApp send failed for guest ${guest.id}:`, error);
    }

    if (index < guestsToNotify.length - 1) {
      const delayMs = getRandomDelayMs();
      await sleep(delayMs);
    }
  }
  return { sentCount, failedCount };
};

const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing authorization token.' });
  }

  const idToken = authHeader.slice('Bearer '.length);
  try {
    const decoded = await firebaseAdminAuth.verifyIdToken(idToken);
    (req as AuthenticatedRequest).user = {
      uid: decoded.uid,
      email: decoded.email,
    };
    await ensureUserWedding(decoded.uid, decoded.email);
    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid authorization token.' });
  }
};

app.post('/api/auth/bootstrap', requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  return res.json({
    message: 'Authenticated successfully.',
    user: {
      uid: authReq.user.uid,
      email: authReq.user.email ?? null,
      weddingId: authReq.user.uid,
    },
  });
});

app.get('/api/guests', requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const guests = await getGuestsByWeddingId(authReq.user.uid);
  return res.json(guests);
});

app.get('/api/groups', requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const groups = await getGroupsByWeddingId(authReq.user.uid);
  return res.json(groups);
});

app.post('/api/groups', requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const { name } = req.body as { name?: string };
  if (!name?.trim()) {
    return res.status(400).json({ message: 'name is required.' });
  }

  const existingGroups = await getGroupsByWeddingId(authReq.user.uid);
  const hasDuplicate = existingGroups.some(
    (group) => group.name.trim().toLowerCase() === name.trim().toLowerCase()
  );
  if (hasDuplicate) {
    return res.status(409).json({ message: 'Group name already exists.' });
  }

  const group = await createGroupInWedding(authReq.user.uid, name.trim());
  return res.status(201).json(group);
});

app.delete('/api/groups/:id', requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const id = String(req.params.id ?? '');
  if (!id) {
    return res.status(400).json({ message: 'id is required.' });
  }

  const deleted = await deleteGroupInWedding(authReq.user.uid, id);
  if (!deleted) {
    return res.status(404).json({ message: 'Group not found.' });
  }

  const guests = await getGuestsByWeddingId(authReq.user.uid);
  await Promise.all(
    guests
      .filter((guest) => guest.groupIds.includes(id))
      .map((guest) =>
        updateGuestInWedding(authReq.user.uid, guest.id, {
          groupIds: guest.groupIds.filter((groupId) => groupId !== id),
        })
      )
  );

  return res.json({ message: 'Group deleted successfully.' });
});

app.post('/api/guests', requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const { name, phoneNumber, partySize } = req.body as Partial<Guest>;
  if (!name || !phoneNumber || typeof partySize !== 'number') {
    return res
      .status(400)
      .json({ message: 'name, phoneNumber, and partySize are required.' });
  }

  const normalizedPhone = normalizePhoneForComparison(phoneNumber);
  const allGuests = await getGuestsByWeddingId(authReq.user.uid);
  const existing = allGuests.find(
    (guest) => normalizePhoneForComparison(guest.phoneNumber) === normalizedPhone
  );
  if (existing) {
    return res.status(409).json({ message: 'Phone number must be unique.' });
  }

  const guest = await addGuestToWedding(authReq.user.uid, {
    name: name.trim(),
    phoneNumber: phoneNumber.trim(),
    expectedPartySize: partySize,
  });
  return res.status(201).json(guest);
});

app.post('/api/guests/import', requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
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

  const { createdGuests, skippedCount } = await importGuestsToWedding(authReq.user.uid, deduplicatedRows);

  return res.json({
    message: 'Guests imported successfully.',
    createdCount: createdGuests.length,
    skippedCount: skippedCount + skippedInvalidRows,
    guests: createdGuests,
  });
});

app.post('/api/guests/bulk-groups', requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
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

  const groups = await getGroupsByWeddingId(authReq.user.uid);
  const groupExists = groups.some((group) => group.id === groupId);
  if (!groupExists) {
    return res.status(404).json({ message: 'Group not found.' });
  }

  const result = await bulkUpdateGuestGroups(authReq.user.uid, guestIds, groupId, action);
  return res.json({
    message: 'Guest groups updated successfully.',
    updatedCount: result.updatedCount,
  });
});

app.delete('/api/guests/:phoneNumber', requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const { phoneNumber } = req.params;
  if (!phoneNumber) {
    return res.status(400).json({ message: 'phoneNumber is required.' });
  }

  try {
    const guests = await getGuestsByWeddingId(authReq.user.uid);
    const existing = guests.find((guest) => guest.phoneNumber === phoneNumber);
    if (!existing) {
      return res.status(404).json({ message: 'Guest not found for that phone number.' });
    }
    const deleted = await deleteGuestInWedding(authReq.user.uid, existing.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Guest not found for that phone number.' });
    }
    return res.json({ message: 'Guest deleted successfully.', guest: deleted });
  } catch {
    return res.status(500).json({ message: 'Failed to delete guest.' });
  }
});

app.put('/api/guests/:phoneNumber', requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const { phoneNumber } = req.params;
  const { name, newPhoneNumber, expectedPartySize, status, partySize, groupIds } = req.body as {
    name?: string;
    newPhoneNumber?: string;
    expectedPartySize?: number;
    status?: GuestStatus;
    partySize?: number;
    groupIds?: string[];
  };

  const allGuests = await getGuestsByWeddingId(authReq.user.uid);
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

  const updated = await updateGuestInWedding(authReq.user.uid, currentGuest.id, {
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

app.post('/api/notifications/trigger', requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const guests = await getGuestsByWeddingId(authReq.user.uid);
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

app.post('/api/notifications/whatsapp', requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const { messageTemplate, statusFilter, rsvpLink, media, groupId } = req.body as {
    messageTemplate?: string;
    statusFilter?: StatusFilter;
    rsvpLink?: string;
    media?: { dataUrl?: string; fileName?: string } | null;
    groupId?: string;
  };

  const whatsappSession = getOrCreateWhatsAppSession(authReq.user.uid);
  if (!whatsappSession.isReady) {
    return res.status(503).json({
      message: 'WhatsApp client is not ready for this user. Please scan your personal QR first.',
    });
  }

  if (!messageTemplate?.trim() || !rsvpLink?.trim() || !isValidStatusFilter(statusFilter)) {
    return res.status(400).json({
      message: 'messageTemplate, rsvpLink, and a valid statusFilter are required.',
    });
  }
  if (media && typeof media.dataUrl !== 'string') {
    return res.status(400).json({
      message: 'media.dataUrl must be a base64 data URL string.',
    });
  }
  const normalizedMedia =
    media && typeof media.dataUrl === 'string'
      ? { dataUrl: media.dataUrl, fileName: media.fileName }
      : null;

  const weddingId = authReq.user.uid;
  const allGuests = await getGuestsByWeddingId(weddingId);
  const statusFiltered = filterGuestsByStatus(allGuests, statusFilter);
  const guestsToNotify = filterGuestsByGroup(statusFiltered, groupId);
  console.log('Incoming WhatsApp notification request:', {
    statusFilter,
    groupId: groupId ?? null,
    recipients: guestsToNotify.length,
  });

  try {
    const { sentCount, failedCount } = await sendWhatsAppBatch(
      whatsappSession.client,
      weddingId,
      guestsToNotify,
      messageTemplate.trim(),
      rsvpLink.trim(),
      normalizedMedia
    );
    return res.json({
      message: 'WhatsApp notifications sent successfully.',
      queuedCount: 0,
      sentCount,
      failedCount,
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to send WhatsApp notifications.',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.post('/api/notifications/whatsapp/disconnect', requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const disconnected = await disconnectWhatsAppSession(authReq.user.uid);
  return res.json({
    message: disconnected
      ? 'WhatsApp client disconnected successfully.'
      : 'No active WhatsApp session found.',
  });
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

app.put('/api/rsvp', requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const { phoneNumber, status, partySize } = req.body as {
    phoneNumber?: string;
    status?: GuestStatus;
    partySize?: number;
  };
  if (!phoneNumber || !isValidStatus(status) || typeof partySize !== 'number') {
    return res.status(400).json({ message: 'phoneNumber, status, and partySize are required.' });
  }

  const guest = await findGuestByPhone(authReq.user.uid, phoneNumber.trim());
  if (!guest) {
    return res.status(404).json({ message: 'Guest not found for that phone number.' });
  }
  const updated = await updateGuestInWedding(authReq.user.uid, guest.id, {
    status,
    partySize,
  });
  return res.json(updated);
});

app.get('/api/notifications/whatsapp/status', requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const whatsappSession = getOrCreateWhatsAppSession(authReq.user.uid);

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
