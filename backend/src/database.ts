import type { Guest } from '../../shared/types';

const guests: Guest[] = [
  {
    id: 'g-001',
    name: 'ישראל ישראלי',
    phoneNumber: '0501111111',
    status: 'Pending',
    partySize: 2,
  },
  {
    id: 'g-002',
    name: 'נועה כהן',
    phoneNumber: '0502222222',
    status: 'Attending',
    partySize: 3,
  },
  {
    id: 'g-003',
    name: 'דניאל לוי',
    phoneNumber: '0503333333',
    status: 'Not Attending',
    partySize: 1,
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
