export type GuestStatus = 'Pending' | 'Attending' | 'Not Attending';

export interface Guest {
  id: string;
  name: string;
  phoneNumber: string;
  status: GuestStatus;
  partySize: number;
}
