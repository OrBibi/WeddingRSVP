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

export type WhatsAppSendJobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'completed_with_failures'
  | 'failed';

export type WhatsAppSendRecipientStatus = 'pending' | 'retry' | 'sent' | 'failed';

export interface WhatsAppSendJobRecipient {
  id: string;
  jobId: string;
  weddingId: string;
  guestId: string;
  guestName: string;
  phoneNumber: string;
  orderIndex: number;
  status: WhatsAppSendRecipientStatus;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  nextRetryAt?: string;
  sentAt?: string;
  lastAttemptAt?: string;
}

export interface WhatsAppSendJob {
  id: string;
  weddingId: string;
  status: WhatsAppSendJobStatus;
  messageTemplate: string;
  rsvpLink: string;
  mediaDataUrl?: string;
  mediaFileName?: string;
  totalRecipients: number;
  processedCount: number;
  sentCount: number;
  failedCount: number;
  currentGuestId?: string | null;
  lastProcessedGuestId?: string | null;
  progressSessionId?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  pausedAt?: string | null;
  idempotencyKey?: string;
  lockOwner?: string | null;
  leaseUntil?: string | null;
  lastError?: string;
  filters?: {
    statusFilter?: string;
    messageSentFilter?: string;
    groupId?: string;
    selectedGuestIds?: string[];
  };
}
