import cors from 'cors';
import cron from 'node-cron';
import express from 'express';
import { randomUUID } from 'node:crypto';
import type { Guest, GuestStatus } from '../../shared/types';
import QRCode from 'qrcode';
import { Client, LocalAuth } from 'whatsapp-web.js';
import {
  addGuest,
  getAllGuests,
  getPendingGuests,
  updateGuestByPhone,
} from './database';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const whatsappClient = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});
let isWhatsAppReady = false;
let latestQrCode: string | null = null;
let latestWhatsAppError: string | null = null;

whatsappClient.on('qr', (qr) => {
  latestQrCode = qr;
  latestWhatsAppError = null;
  console.log('WhatsApp QR code updated and available in frontend.');
});

whatsappClient.on('ready', () => {
  isWhatsAppReady = true;
  latestQrCode = null;
  latestWhatsAppError = null;
  console.log('WhatsApp client is ready.');
});

whatsappClient.on('auth_failure', (message) => {
  isWhatsAppReady = false;
  latestWhatsAppError = message;
  console.error(`WhatsApp authentication failure: ${message}`);
});

whatsappClient.on('disconnected', (reason) => {
  isWhatsAppReady = false;
  latestWhatsAppError = reason;
  console.warn(`WhatsApp client disconnected: ${reason}`);
});

void whatsappClient.initialize().catch((error: unknown) => {
  isWhatsAppReady = false;
  latestWhatsAppError = error instanceof Error ? error.message : 'Unknown WhatsApp initialization error';
  console.error('WhatsApp initialization failed:', latestWhatsAppError);
});

const statuses: GuestStatus[] = ['Pending', 'Attending', 'Not Attending'];
type StatusFilter = 'All' | GuestStatus;

const isValidStatus = (value: unknown): value is GuestStatus =>
  typeof value === 'string' && statuses.includes(value as GuestStatus);
const isValidStatusFilter = (value: unknown): value is StatusFilter =>
  value === 'All' || isValidStatus(value);

const formatPhoneForWhatsApp = (phone: string): string => {
  const digitsOnly = phone.replace(/\D/g, '');
  const withoutLeadingZero = digitsOnly.startsWith('0') ? digitsOnly.slice(1) : digitsOnly;
  return `972${withoutLeadingZero}@c.us`;
};

const filterGuestsByStatus = (statusFilter: StatusFilter) => {
  if (statusFilter === 'All') {
    return getAllGuests();
  }
  return getAllGuests().filter((guest) => guest.status === statusFilter);
};

const formatDateToCron = (date: Date): string => {
  const minute = date.getMinutes();
  const hour = date.getHours();
  const day = date.getDate();
  const month = date.getMonth() + 1;
  return `${minute} ${hour} ${day} ${month} *`;
};

const sendWhatsAppBatch = async (
  guestsToNotify: ReturnType<typeof getAllGuests>,
  messageTemplate: string,
  rsvpLink: string
): Promise<number> => {
  let sentCount = 0;
  for (const guest of guestsToNotify) {
    const text = messageTemplate.replaceAll('{{name}}', guest.name).replaceAll('{{link}}', rsvpLink);
    const formattedPhone = formatPhoneForWhatsApp(guest.phoneNumber);
    await whatsappClient.sendMessage(formattedPhone, text);
    sentCount += 1;
  }
  return sentCount;
};

app.get('/api/guests', (_req, res) => {
  res.json(getAllGuests());
});

app.post('/api/guests', (req, res) => {
  const { name, phoneNumber, partySize } = req.body as Partial<Guest>;
  if (!name || !phoneNumber || typeof partySize !== 'number') {
    return res
      .status(400)
      .json({ message: 'name, phoneNumber, and partySize are required.' });
  }

  const existing = getAllGuests().find((guest) => guest.phoneNumber === phoneNumber);
  if (existing) {
    return res.status(409).json({ message: 'Phone number must be unique.' });
  }

  const guest: Guest = {
    id: randomUUID(),
    name: name.trim(),
    phoneNumber: phoneNumber.trim(),
    status: 'Pending',
    partySize,
  };

  addGuest(guest);
  return res.status(201).json(guest);
});

app.put('/api/rsvp', (req, res) => {
  const { phoneNumber, status, partySize } = req.body as {
    phoneNumber?: string;
    status?: GuestStatus;
    partySize?: number;
  };

  if (!phoneNumber || !isValidStatus(status) || typeof partySize !== 'number') {
    return res
      .status(400)
      .json({ message: 'phoneNumber, status, and partySize are required.' });
  }

  const updated = updateGuestByPhone(phoneNumber, { status, partySize });
  if (!updated) {
    return res.status(404).json({ message: 'Guest not found for that phone number.' });
  }

  return res.json(updated);
});

app.post('/api/notifications/trigger', (_req, res) => {
  const pendingGuests = getPendingGuests();

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

app.post('/api/notifications/whatsapp', async (req, res) => {
  const { messageTemplate, statusFilter, scheduledTime, rsvpLink } = req.body as {
    messageTemplate?: string;
    statusFilter?: StatusFilter;
    scheduledTime?: string | null;
    rsvpLink?: string;
  };

  if (!isWhatsAppReady) {
    return res.status(503).json({
      message: 'WhatsApp client is not ready. Scan QR in backend terminal first.',
    });
  }

  if (!messageTemplate?.trim() || !rsvpLink?.trim() || !isValidStatusFilter(statusFilter)) {
    return res.status(400).json({
      message: 'messageTemplate, rsvpLink, and a valid statusFilter are required.',
    });
  }

  const guestsToNotify = filterGuestsByStatus(statusFilter);
  console.log('Incoming WhatsApp notification request:', {
    statusFilter,
    scheduledTime: scheduledTime ?? null,
    recipients: guestsToNotify.length,
  });

  const scheduledDate = scheduledTime ? new Date(scheduledTime) : null;
  const hasFutureSchedule =
    scheduledDate instanceof Date && !Number.isNaN(scheduledDate.getTime()) && scheduledDate > new Date();

  if (hasFutureSchedule && scheduledDate) {
    const expression = formatDateToCron(scheduledDate);
    const task = cron.schedule(expression, async () => {
      try {
        await sendWhatsAppBatch(guestsToNotify, messageTemplate.trim(), rsvpLink.trim());
      } catch (error) {
        console.error('Scheduled WhatsApp batch failed:', error);
      } finally {
        task.stop();
      }
    });

    return res.json({
      message: 'WhatsApp notifications scheduled successfully.',
      queuedCount: guestsToNotify.length,
      sentCount: 0,
    });
  }

  try {
    const sentCount = await sendWhatsAppBatch(guestsToNotify, messageTemplate.trim(), rsvpLink.trim());
    return res.json({
      message: 'WhatsApp notifications sent successfully.',
      queuedCount: 0,
      sentCount,
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to send WhatsApp notifications.',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.get('/api/notifications/whatsapp/status', async (_req, res) => {
  if (isWhatsAppReady) {
    return res.json({
      isReady: true,
      qrDataUrl: null,
      message: 'WhatsApp client is connected.',
    });
  }

  if (!latestQrCode) {
    return res.json({
      isReady: false,
      qrDataUrl: null,
      message: latestWhatsAppError
        ? `WhatsApp client error: ${latestWhatsAppError}`
        : 'QR code is not available yet. Wait a few seconds and retry.',
    });
  }

  try {
    const qrDataUrl = await QRCode.toDataURL(latestQrCode, { margin: 1, width: 320 });
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
