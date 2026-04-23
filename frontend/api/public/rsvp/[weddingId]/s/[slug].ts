import { firestore } from '../../../../_lib/firebaseAdmin.js';

type GuestStatus = 'Pending' | 'Attending' | 'Not Attending';

const allowedStatuses: GuestStatus[] = ['Pending', 'Attending', 'Not Attending'];

const RSVP_SLUG_RE = /^[A-Za-z0-9_-]{6,22}$/;

const parsePathParam = (value: unknown): string => {
  if (Array.isArray(value)) {
    return String(value[0] ?? '');
  }
  return String(value ?? '');
};

const isValidStatus = (value: unknown): value is GuestStatus =>
  typeof value === 'string' && allowedStatuses.includes(value as GuestStatus);

const weddingGuestsCollection = (weddingId: string) =>
  firestore.collection('weddings').doc(weddingId).collection('guests');

export default async function handler(req: any, res: any) {
  const weddingId = parsePathParam(req.query.weddingId);
  const slug = parsePathParam(req.query.slug);
  const requestMethod = String(req.method ?? 'UNKNOWN');

  if (!weddingId || !slug || !RSVP_SLUG_RE.test(slug)) {
    return res.status(400).json({ message: 'weddingId and a valid slug are required.' });
  }

  const snapshot = await weddingGuestsCollection(weddingId).where('rsvpSlug', '==', slug).limit(1).get();
  if (snapshot.empty) {
    return res.status(404).json({ message: 'Invitation not found.' });
  }

  const guestRef = snapshot.docs[0].ref;
  const guest = snapshot.docs[0].data() as {
    id: string;
    weddingId: string;
    name: string;
    status: GuestStatus;
    partySize: number;
    rsvpToken?: string;
  };

  if (requestMethod === 'GET') {
    const token = String(req.query.token ?? '');
    if (!token || guest.rsvpToken !== token) {
      return res.status(404).json({ message: 'Invitation not found.' });
    }

    return res.json({
      id: guest.id,
      weddingId: guest.weddingId,
      name: guest.name,
      status: guest.status,
      partySize: guest.partySize,
    });
  }

  if (requestMethod === 'PUT') {
    const { token, status, partySize } = req.body as {
      token?: string;
      status?: GuestStatus;
      partySize?: number;
    };

    if (!token || guest.rsvpToken !== token || !isValidStatus(status) || typeof partySize !== 'number') {
      return res.status(400).json({ message: 'token, status, and partySize are required.' });
    }

    const normalizedPartySize = Math.max(1, Math.floor(partySize));
    await guestRef.update({
      status,
      partySize: normalizedPartySize,
    });

    const refreshedDoc = await guestRef.get();
    return res.json(refreshedDoc.data());
  }

  return res.status(405).json({ message: 'Method not allowed.' });
}
