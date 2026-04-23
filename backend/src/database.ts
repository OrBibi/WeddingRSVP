import type { Guest } from '../../shared/types';

const guests: Guest[] = [
  {
    id: 'g-001',
    weddingId: 'legacy',
    name: 'אור ביבי',
    phoneNumber: '0584455881',
    status: 'Pending',
    expectedPartySize: 1,
    partySize: 1,
    groupIds: [],
  },
  {
    id: 'g-002',
    weddingId: 'legacy',
    name: 'קרן אור',
    phoneNumber: '0526911704',
    status: 'Attending',
    expectedPartySize: 1,
    partySize: 1,
    groupIds: [],
  },
];

export const getAllGuests = (): Guest[] => guests;

export const addGuest = (guest: Guest): Guest => {
  guests.push(guest);
  return guest;
};

export const updateGuestByPhone = (
  phone: string,
  updates: Partial<Pick<Guest, 'status' | 'partySize'>>
): Guest | null => {
  const guest = guests.find((entry) => entry.phoneNumber === phone);
  if (!guest) {
    return null;
  }

  if (updates.status) {
    guest.status = updates.status;
  }
  if (typeof updates.partySize === 'number') {
    guest.partySize = updates.partySize;
  }

  return guest;
};

export const getPendingGuests = (): Guest[] =>
  guests.filter((guest) => guest.status === 'Pending');

export const deleteGuestByPhone = (phoneNumber: string): Guest | null => {
  const index = guests.findIndex((guest) => guest.phoneNumber === phoneNumber);
  if (index === -1) {
    return null;
  }
  const [deletedGuest] = guests.splice(index, 1);
  return deletedGuest;
};

export const updateGuestDetailsByPhone = (
  phoneNumber: string,
  updates: Partial<Pick<Guest, 'name' | 'phoneNumber' | 'expectedPartySize' | 'status' | 'partySize'>>
): Guest | null => {
  const guest = guests.find((entry) => entry.phoneNumber === phoneNumber);
  if (!guest) {
    return null;
  }

  if (typeof updates.name === 'string') {
    guest.name = updates.name;
  }
  if (typeof updates.phoneNumber === 'string') {
    guest.phoneNumber = updates.phoneNumber;
  }
  if (typeof updates.expectedPartySize === 'number') {
    guest.expectedPartySize = updates.expectedPartySize;
  }
  if (updates.status) {
    guest.status = updates.status;
  }
  if (typeof updates.partySize === 'number') {
    guest.partySize = updates.partySize;
  }

  return guest;
};
