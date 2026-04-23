import axios from 'axios';
import type { Guest, GuestGroup, GuestStatus } from '../../shared/types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const PUBLIC_RSVP_API_URL =
  import.meta.env.VITE_PUBLIC_RSVP_API_URL ||
  (import.meta.env.PROD ? '/api/public' : `${API_URL.replace(/\/$/, '')}/public`);
let authToken: string | null = null;

const api = axios.create({
  baseURL: API_URL,
});

const publicRsvpApi = axios.create({
  baseURL: PUBLIC_RSVP_API_URL,
});

api.interceptors.request.use((config) => {
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

export interface AddGuestPayload {
  name: string;
  phoneNumber: string;
  partySize: number;
}

export interface ImportGuestPayload {
  name: string;
  phoneNumber: string;
  expectedPartySize: number;
  status?: string;
  groupIds?: string[];
}

export interface RSVPUpdatePayload {
  phoneNumber: string;
  status: GuestStatus;
  partySize: number;
}

export interface UpdateGuestPayload {
  name: string;
  newPhoneNumber: string;
  expectedPartySize: number;
  status: GuestStatus;
  partySize: number;
  groupIds?: string[];
}

export type NotificationStatusFilter = 'All' | GuestStatus;
export type NotificationMessageSentFilter = 'All' | 'Sent' | 'Not Sent';

export interface WhatsAppNotificationPayload {
  messageTemplate: string;
  statusFilter: NotificationStatusFilter;
  messageSentFilter: NotificationMessageSentFilter;
  rsvpLink: string;
  groupId?: string;
  selectedGuestIds?: string[];
  progressSessionId?: string;
  media?: {
    dataUrl: string;
    fileName?: string;
  } | null;
}

export interface WhatsAppNotificationResponse {
  message: string;
  queuedCount: number;
  sentCount: number;
  failedCount?: number;
}

export interface WhatsAppStatusResponse {
  isReady: boolean;
  qrDataUrl: string | null;
  message: string;
}

export interface WhatsAppProgressState {
  totalRecipients: number;
  processedCount: number;
  sentCount: number;
  failedCount: number;
  currentGuestId: string | null;
}

export const openWhatsAppProgressStream = (
  sessionId: string,
  handlers: {
    onStarted?: (state: WhatsAppProgressState) => void;
    onProgress?: (state: WhatsAppProgressState) => void;
    onCompleted?: (state: WhatsAppProgressState) => void;
    onError?: (payload: { message?: string }) => void;
  }
) => {
  const source = new EventSource(
    `${API_URL.replace(/\/$/, '')}/notifications/whatsapp/progress/${encodeURIComponent(sessionId)}`
  );

  source.addEventListener('started', (event) => {
    handlers.onStarted?.(JSON.parse((event as MessageEvent).data) as WhatsAppProgressState);
  });
  source.addEventListener('progress', (event) => {
    handlers.onProgress?.(JSON.parse((event as MessageEvent).data) as WhatsAppProgressState);
  });
  source.addEventListener('completed', (event) => {
    handlers.onCompleted?.(JSON.parse((event as MessageEvent).data) as WhatsAppProgressState);
  });
  source.addEventListener('error', (event) => {
    handlers.onError?.(JSON.parse((event as MessageEvent).data) as { message?: string });
  });
  source.onerror = () => {
    handlers.onError?.({ message: 'SSE connection dropped.' });
  };

  return source;
};

export const setApiAuthToken = (token: string | null) => {
  authToken = token;
};

export const bootstrapAuth = async (): Promise<{
  user: { uid: string; email: string | null; weddingId: string };
}> => {
  const { data } = await api.post<{ user: { uid: string; email: string | null; weddingId: string } }>(
    '/auth/bootstrap'
  );
  return data;
};

export const fetchGuests = async (): Promise<Guest[]> => {
  const { data } = await api.get<Guest[]>('/guests');
  return data;
};

export const createGuest = async (payload: AddGuestPayload): Promise<Guest> => {
  const { data } = await api.post<Guest>('/guests', payload);
  return data;
};

export const fetchGroups = async (): Promise<GuestGroup[]> => {
  const { data } = await api.get<GuestGroup[]>('/groups');
  return data;
};

export const createGroup = async (name: string): Promise<GuestGroup> => {
  const { data } = await api.post<GuestGroup>('/groups', { name });
  return data;
};

export const deleteGroup = async (id: string): Promise<{ message: string }> => {
  const { data } = await api.delete<{ message: string }>(`/groups/${encodeURIComponent(id)}`);
  return data;
};

export const importGuests = async (
  guests: ImportGuestPayload[]
): Promise<{ message: string; createdCount: number; skippedCount: number; guests: Guest[] }> => {
  const { data } = await api.post<{
    message: string;
    createdCount: number;
    skippedCount: number;
    guests: Guest[];
  }>('/guests/import', { guests });
  return data;
};

export const deleteGuest = async (
  phoneNumber: string
): Promise<{ message: string; guest: Guest }> => {
  const { data } = await api.delete<{ message: string; guest: Guest }>(
    `/guests/${encodeURIComponent(phoneNumber)}`
  );
  return data;
};

export const updateGuest = async (
  phoneNumber: string,
  payload: UpdateGuestPayload
): Promise<Guest> => {
  const { data } = await api.put<Guest>(`/guests/${encodeURIComponent(phoneNumber)}`, payload);
  return data;
};

export const bulkUpdateGuestGroups = async (payload: {
  guestIds: string[];
  groupId: string;
  action: 'add' | 'remove';
}): Promise<{ message: string; updatedCount: number }> => {
  const { data } = await api.post<{ message: string; updatedCount: number }>(
    '/guests/bulk-groups',
    payload
  );
  return data;
};

export const updateRsvp = async (payload: RSVPUpdatePayload): Promise<Guest> => {
  const { data } = await api.put<Guest>('/rsvp', payload);
  return data;
};

export const triggerNotifications = async (): Promise<{ message: string; sentCount: number }> => {
  const { data } = await api.post<{ message: string; sentCount: number }>(
    '/notifications/trigger'
  );
  return data;
};

export const sendWhatsAppNotifications = async (
  payload: WhatsAppNotificationPayload
): Promise<WhatsAppNotificationResponse> => {
  const { data } = await api.post<WhatsAppNotificationResponse>('/notifications/whatsapp', payload);
  return data;
};

export const fetchWhatsAppStatus = async (): Promise<WhatsAppStatusResponse> => {
  const { data } = await api.get<WhatsAppStatusResponse>('/notifications/whatsapp/status');
  return data;
};

export const disconnectWhatsApp = async (): Promise<{ message: string }> => {
  const { data } = await api.post<{ message: string }>('/notifications/whatsapp/disconnect');
  return data;
};

export const fetchPublicInvitation = async (
  weddingId: string,
  guestId: string,
  token: string
): Promise<Pick<Guest, 'id' | 'weddingId' | 'name' | 'status' | 'partySize'>> => {
  const { data } = await publicRsvpApi.get<
    Pick<Guest, 'id' | 'weddingId' | 'name' | 'status' | 'partySize'>
  >(
    `/rsvp/${encodeURIComponent(weddingId)}/${encodeURIComponent(guestId)}`,
    { params: { token } }
  );
  return data;
};

export const submitPublicRsvp = async (
  weddingId: string,
  guestId: string,
  payload: { token: string; status: GuestStatus; partySize: number }
): Promise<Guest> => {
  const { data } = await publicRsvpApi.put<Guest>(
    `/rsvp/${encodeURIComponent(weddingId)}/${encodeURIComponent(guestId)}`,
    payload
  );
  return data;
};

export const fetchPublicInvitationBySlug = async (
  weddingId: string,
  slug: string,
  token: string
): Promise<Pick<Guest, 'id' | 'weddingId' | 'name' | 'status' | 'partySize'>> => {
  const { data } = await publicRsvpApi.get<
    Pick<Guest, 'id' | 'weddingId' | 'name' | 'status' | 'partySize'>
  >(`/rsvp/${encodeURIComponent(weddingId)}/s/${encodeURIComponent(slug)}`, { params: { token } });
  return data;
};

export const submitPublicRsvpBySlug = async (
  weddingId: string,
  slug: string,
  payload: { token: string; status: GuestStatus; partySize: number }
): Promise<Guest> => {
  const { data } = await publicRsvpApi.put<Guest>(
    `/rsvp/${encodeURIComponent(weddingId)}/s/${encodeURIComponent(slug)}`,
    payload
  );
  return data;
};
