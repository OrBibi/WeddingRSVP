import axios from 'axios';
import type { Guest, GuestStatus } from '../../shared/types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_URL,
});

export interface AddGuestPayload {
  name: string;
  phoneNumber: string;
  partySize: number;
}

export interface RSVPUpdatePayload {
  phoneNumber: string;
  status: GuestStatus;
  partySize: number;
}

export type NotificationStatusFilter = 'All' | GuestStatus;

export interface WhatsAppNotificationPayload {
  messageTemplate: string;
  statusFilter: NotificationStatusFilter;
  scheduledTime: string | null;
  rsvpLink: string;
}

export interface WhatsAppNotificationResponse {
  message: string;
  queuedCount: number;
  sentCount: number;
}

export interface WhatsAppStatusResponse {
  isReady: boolean;
  qrDataUrl: string | null;
  message: string;
}

export const fetchGuests = async (): Promise<Guest[]> => {
  const { data } = await api.get<Guest[]>('/guests');
  return data;
};

export const createGuest = async (payload: AddGuestPayload): Promise<Guest> => {
  const { data } = await api.post<Guest>('/guests', payload);
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
