export type GuestStatus = 'Pending' | 'Attending' | 'Not Attending';

export interface Guest {
  id: string;
  weddingId: string;
  name: string;
  phoneNumber: string;
  status: GuestStatus;
  expectedPartySize: number;
  partySize: number;
  groupIds: string[];
  rsvpToken?: string;
  /** Short stable segment for compact RSVP URLs (/r/.../slug). */
  rsvpSlug?: string;
  messageSent?: boolean;
  lastMessageSentAt?: string;
}

export interface GuestGroup {
  id: string;
  name: string;
  weddingId: string;
}
