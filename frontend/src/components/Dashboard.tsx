import axios from 'axios';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Guest, GuestGroup, WhatsAppSendJob } from '../../../shared/types';
import {
  bulkUpdateGuestGroups,
  createWhatsAppSendJob,
  createGroup,
  createGuest,
  deleteGroup,
  deleteGuest,
  disconnectWhatsApp,
  fetchWhatsAppSendJob,
  fetchGuests,
  fetchGroups,
  fetchWhatsAppStatus,
  importGuests,
  openWhatsAppProgressStream,
  pauseWhatsAppSendJob,
  resumeWhatsAppSendJob,
  type NotificationMessageSentFilter,
  type WhatsAppProgressState,
  triggerNotifications,
  updateGuest,
} from '../api';
import * as XLSX from 'xlsx';

const defaultForm = {
  name: '',
  phoneNumber: '',
  partySize: 1,
};

const statusLabelMap: Record<Guest['status'], string> = {
  Pending: 'מתלבט',
  Attending: 'מגיע',
  'Not Attending': 'לא מגיע',
};

const parseGroupExcelCell = (value: unknown): boolean => {
  if (typeof value === 'number') {
    return value !== 0;
  }
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) {
    return false;
  }
  return ['1', 'true', 'yes', 'y', 'כן'].includes(text);
};

export default function Dashboard() {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [groups, setGroups] = useState<GuestGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [submittingGuest, setSubmittingGuest] = useState(false);
  const [sendingNotifications, setSendingNotifications] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState(defaultForm);
  const [notificationMessage, setNotificationMessage] = useState(
    'שלום {{name}}, נשמח לראות אותך בחתונה שלנו. לאישור הגעה: {{link}}'
  );
  const [notificationFilter, setNotificationFilter] = useState<'All' | Guest['status']>('All');
  const [notificationMessageSentFilter, setNotificationMessageSentFilter] =
    useState<NotificationMessageSentFilter>('All');
  const [notificationGroupFilter, setNotificationGroupFilter] = useState('');
  const [notificationSelectedOnly, setNotificationSelectedOnly] = useState(false);
  const [notificationLink, setNotificationLink] = useState(
    import.meta.env.VITE_PUBLIC_RSVP_SITE_URL || 'http://localhost:5173'
  );
  const [notificationImage, setNotificationImage] = useState<{
    dataUrl: string;
    fileName?: string;
  } | null>(null);
  const [notificationError, setNotificationError] = useState('');
  const [importError, setImportError] = useState('');
  const [importingGuests, setImportingGuests] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | Guest['status'] | 'Maybe'>('All');
  const [sortByStatusDirection, setSortByStatusDirection] = useState<'asc' | 'desc'>('asc');
  const [deletingPhone, setDeletingPhone] = useState<string | null>(null);
  const [selectedGuestIds, setSelectedGuestIds] = useState<Set<string>>(new Set());
  const [bulkGroupId, setBulkGroupId] = useState('');
  const [applyingBulkGroup, setApplyingBulkGroup] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [editingPhone, setEditingPhone] = useState<string | null>(null);
  const [savingGuest, setSavingGuest] = useState(false);
  const [editForm, setEditForm] = useState<{
    name: string;
    phoneNumber: string;
    expectedPartySize: number;
    status: Guest['status'];
    partySize: number;
    groupIds: string[];
  }>({
    name: '',
    phoneNumber: '',
    expectedPartySize: 1,
    status: 'Pending',
    partySize: 1,
    groupIds: [],
  });
  const [whatsAppReady, setWhatsAppReady] = useState(false);
  const [whatsAppQrDataUrl, setWhatsAppQrDataUrl] = useState<string | null>(null);
  const [whatsAppStatusMessage, setWhatsAppStatusMessage] = useState('טוען מצב התחברות לוואטסאפ...');
  const [disconnectingWhatsApp, setDisconnectingWhatsApp] = useState(false);
  const [sendProgress, setSendProgress] = useState<WhatsAppProgressState | null>(null);
  const [activeWhatsAppJob, setActiveWhatsAppJob] = useState<WhatsAppSendJob | null>(null);
  const [pausingJob, setPausingJob] = useState(false);
  const [resumingJob, setResumingJob] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const sortedGuests = useMemo(
    () => [...guests].sort((a, b) => a.name.localeCompare(b.name)),
    [guests]
  );
  const filteredGuests = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const byStatus = sortedGuests.filter((guest) => {
      if (statusFilter === 'All') {
        return true;
      }
      if (statusFilter === 'Maybe') {
        return guest.status === 'Pending';
      }
      return guest.status === statusFilter;
    });

    if (!query) {
      return byStatus;
    }
    return byStatus.filter(
      (guest) =>
        guest.name.toLowerCase().includes(query) || guest.phoneNumber.toLowerCase().includes(query)
    );
  }, [searchQuery, sortedGuests, statusFilter]);

  const statusSortOrder: Record<Guest['status'], number> = {
    Attending: 0,
    Pending: 1,
    'Not Attending': 2,
  };

  const visibleGuests = useMemo(() => {
    return [...filteredGuests].sort((a, b) => {
      const direction = sortByStatusDirection === 'asc' ? 1 : -1;
      return (statusSortOrder[a.status] - statusSortOrder[b.status]) * direction;
    });
  }, [filteredGuests, sortByStatusDirection]);

  const totalInvitations = guests.length;
  const confirmedInvitations = guests.filter((guest) => guest.status === 'Attending').length;
  const declinedInvitations = guests.filter((guest) => guest.status === 'Not Attending').length;
  const pendingInvitations = guests.filter((guest) => guest.status === 'Pending').length;

  const totalExpectedGuests = guests.reduce((sum, guest) => sum + guest.expectedPartySize, 0);
  const totalConfirmedPartySize = guests
    .filter((guest) => guest.status === 'Attending')
    .reduce((sum, guest) => sum + guest.partySize, 0);
  const waitingExpectedGuests = guests
    .filter((guest) => guest.status === 'Pending')
    .reduce((sum, guest) => sum + guest.expectedPartySize, 0);
  const progressPercent =
    sendProgress && sendProgress.totalRecipients > 0
      ? Math.round((sendProgress.processedCount / sendProgress.totalRecipients) * 100)
      : 0;
  const groupNameById = useMemo(
    () => new Map(groups.map((group) => [group.id, group.name])),
    [groups]
  );

  const loadGuests = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchGuests();
      setGuests(
        data.map((guest) => ({
          ...guest,
          groupIds: Array.isArray(guest.groupIds) ? guest.groupIds : [],
          messageSent: Boolean(guest.messageSent),
        }))
      );
    } catch {
      setError('לא ניתן לטעון את רשימת האורחים. בדקו שהשרת פועל.');
    } finally {
      setLoading(false);
    }
  };

  const loadGroups = async () => {
    try {
      const data = await fetchGroups();
      setGroups(data);
    } catch {
      setGroups([]);
    }
  };

  useEffect(() => {
    void loadGuests();
    void loadGroups();
  }, []);

  const loadWhatsAppStatus = async () => {
    try {
      const status = await fetchWhatsAppStatus();
      setWhatsAppReady(status.isReady);
      setWhatsAppQrDataUrl(status.qrDataUrl);
      setWhatsAppStatusMessage(
        status.isReady ? 'הוואטסאפ מחובר ומוכן לשליחה.' : status.message || 'יש לסרוק את קוד ה-QR כדי להתחבר לוואטסאפ.'
      );
    } catch {
      setWhatsAppReady(false);
      setWhatsAppQrDataUrl(null);
      setWhatsAppStatusMessage('לא ניתן לטעון את קוד ה-QR כרגע. בדקו שהשרת פועל.');
    }
  };

  useEffect(() => {
    void loadWhatsAppStatus();
    const intervalId = window.setInterval(() => {
      void loadWhatsAppStatus();
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(
    () => () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    },
    []
  );

  const addGuest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setSubmittingGuest(true);

    try {
      const created = await createGuest({
        name: form.name.trim(),
        phoneNumber: form.phoneNumber.trim(),
        partySize: Number(form.partySize),
      });
      setGuests((current) => [...current, created]);
      setForm(defaultForm);
    } catch {
      setFormError('לא ניתן להוסיף אורח. ודאו שמספר הטלפון ייחודי.');
    } finally {
      setSubmittingGuest(false);
    }
  };

  const handleTrigger = async () => {
    setSendingNotifications(true);
    try {
      const result = await triggerNotifications();
      alert(`התזכורות נשלחו בהצלחה. נשלחו ${result.sentCount} הודעות.`);
    } catch {
      alert('שליחת התזכורות נכשלה. נסו שוב.');
    } finally {
      setSendingNotifications(false);
    }
  };

  const handleWhatsAppSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotificationError('');

    const trimmedNotification = notificationMessage.trim();
    if (!trimmedNotification) {
      setNotificationError('יש להזין תוכן להודעה לפני השליחה.');
      return;
    }
    if (!trimmedNotification.includes('{{link}}') && !trimmedNotification.includes('{{link_here}}')) {
      setNotificationError('יש לכלול בתבנית את {{link}} או את {{link_here}} כדי שכל אורח יקבל את הקישור האישי שלו.');
      return;
    }
    if (notificationSelectedOnly && selectedGuestIds.size === 0) {
      setNotificationError('בחרת "מסומנים בלבד", אך אין אורחים מסומנים כרגע.');
      return;
    }

    setSendingNotifications(true);
    setSendProgress(null);

    const progressSessionId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `session-${Date.now()}`;
    eventSourceRef.current?.close();
    eventSourceRef.current = openWhatsAppProgressStream(progressSessionId, {
      onStarted: (state) => {
        setSendProgress(state);
      },
      onProgress: (state) => {
        setSendProgress(state);
      },
      onCompleted: (state) => {
        setSendProgress(state);
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        if (activeWhatsAppJob) {
          void fetchWhatsAppSendJob(activeWhatsAppJob.id).then((job) => {
            setActiveWhatsAppJob(job);
          });
        }
        void loadGuests();
      },
      onError: (payload) => {
        if (payload?.message) {
          setNotificationError(payload.message);
        }
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
      },
    });

    try {
      const payload = {
        messageTemplate: trimmedNotification,
        statusFilter: notificationFilter,
        messageSentFilter: notificationMessageSentFilter,
        rsvpLink: notificationLink.trim(),
        groupId: notificationGroupFilter || undefined,
        selectedGuestIds: notificationSelectedOnly ? [...selectedGuestIds] : undefined,
        progressSessionId,
        media: notificationImage,
      };
      const created = await createWhatsAppSendJob({
        ...payload,
        idempotencyKey: progressSessionId,
      });
      setActiveWhatsAppJob(created.job);
    } catch (submitError: unknown) {
      const backendMessage = axios.isAxiosError<{ message?: string }>(submitError)
        ? submitError.response?.data?.message
        : '';
      setNotificationError(
        backendMessage || 'לא ניתן לשלוח הודעות וואטסאפ כרגע. ודאו שהחיבור פעיל ונסו שוב.'
      );
      if (submitError instanceof Error) {
        console.error('WhatsApp notification request failed:', submitError.message);
      }
    } finally {
      setSendingNotifications(false);
    }
  };

  const handlePauseWhatsAppJob = async () => {
    if (!activeWhatsAppJob) {
      return;
    }
    setPausingJob(true);
    try {
      const paused = await pauseWhatsAppSendJob(activeWhatsAppJob.id);
      setActiveWhatsAppJob(paused.job);
    } catch {
      setNotificationError('לא ניתן להשהות את השליחה כרגע.');
    } finally {
      setPausingJob(false);
    }
  };

  const handleResumeWhatsAppJob = async () => {
    if (!activeWhatsAppJob) {
      return;
    }
    setResumingJob(true);
    try {
      const resumed = await resumeWhatsAppSendJob(activeWhatsAppJob.id);
      setActiveWhatsAppJob(resumed.job);
    } catch {
      setNotificationError('לא ניתן להמשיך את השליחה כרגע.');
    } finally {
      setResumingJob(false);
    }
  };

  const handleDisconnectWhatsApp = async () => {
    setDisconnectingWhatsApp(true);
    try {
      await disconnectWhatsApp();
      await loadWhatsAppStatus();
      alert('חשבון הוואטסאפ נותק. ניתן להתחבר לחשבון אחר באמצעות QR.');
    } catch {
      alert('לא ניתן להתנתק מוואטסאפ כרגע. נסו שוב.');
    } finally {
      setDisconnectingWhatsApp(false);
    }
  };

  const handleNotificationImageChange = async (file: File | null) => {
    if (!file) {
      setNotificationImage(null);
      return;
    }

    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('Invalid file content.'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read image.'));
      reader.readAsDataURL(file);
    });

    setNotificationImage({
      dataUrl,
      fileName: file.name,
    });
  };

  const handleDeleteGuest = async (phoneNumber: string) => {
    const confirmed = window.confirm('האם אתה בטוח שברצונך למחוק אורח זה?');
    if (!confirmed) {
      return;
    }

    setDeletingPhone(phoneNumber);
    try {
      await deleteGuest(phoneNumber);
      setGuests((current) => current.filter((guest) => guest.phoneNumber !== phoneNumber));
    } catch {
      alert('לא ניתן למחוק את האורח כרגע. נסו שוב בעוד רגע.');
    } finally {
      setDeletingPhone(null);
    }
  };

  const startEditingGuest = (guest: Guest) => {
    setEditingPhone(guest.phoneNumber);
    setEditForm({
      name: guest.name,
      phoneNumber: guest.phoneNumber,
      expectedPartySize: guest.expectedPartySize,
      status: guest.status,
      partySize: guest.partySize,
      groupIds: Array.isArray(guest.groupIds) ? guest.groupIds : [],
    });
  };

  const cancelEditingGuest = () => {
    setEditingPhone(null);
    setSavingGuest(false);
  };

  const saveEditingGuest = async (originalPhoneNumber: string) => {
    if (!editForm.name.trim() || !editForm.phoneNumber.trim() || editForm.expectedPartySize < 1) {
      alert('נא למלא שם, טלפון וכמות אורחים צפויה תקינים.');
      return;
    }

    setSavingGuest(true);
    try {
      const updated = await updateGuest(originalPhoneNumber, {
        name: editForm.name.trim(),
        newPhoneNumber: editForm.phoneNumber.trim(),
        expectedPartySize: Number(editForm.expectedPartySize),
        status: editForm.status,
        partySize:
          editForm.status === 'Attending'
            ? Number(editForm.partySize)
            : 1,
        groupIds: [...new Set(editForm.groupIds)],
      });
      setGuests((current) =>
        current.map((guest) => (guest.phoneNumber === originalPhoneNumber ? updated : guest))
      );
      setEditingPhone(null);
    } catch {
      alert('לא ניתן לשמור את השינויים כרגע. ודאו שהטלפון ייחודי ונסו שוב.');
    } finally {
      setSavingGuest(false);
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      return;
    }
    setCreatingGroup(true);
    try {
      const created = await createGroup(newGroupName.trim());
      setGroups((current) => [...current, created]);
      setNewGroupName('');
    } catch {
      alert('לא ניתן ליצור קבוצה כרגע. ייתכן שהשם כבר קיים.');
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    const confirmed = window.confirm('האם למחוק קבוצה זו?');
    if (!confirmed) {
      return;
    }
    setDeletingGroupId(groupId);
    try {
      await deleteGroup(groupId);
      setGroups((current) => current.filter((group) => group.id !== groupId));
      setGuests((current) =>
        current.map((guest) => ({
          ...guest,
          groupIds: (Array.isArray(guest.groupIds) ? guest.groupIds : []).filter((id) => id !== groupId),
        }))
      );
    } catch {
      alert('לא ניתן למחוק את הקבוצה כרגע.');
    } finally {
      setDeletingGroupId(null);
    }
  };

  const toggleGuestSelection = (guestId: string) => {
    setSelectedGuestIds((current) => {
      const next = new Set(current);
      if (next.has(guestId)) {
        next.delete(guestId);
      } else {
        next.add(guestId);
      }
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = visibleGuests.map((guest) => guest.id);
    const allSelected = visibleIds.every((id) => selectedGuestIds.has(id));
    setSelectedGuestIds((current) => {
      const next = new Set(current);
      if (allSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const handleBulkGroupAction = async (action: 'add' | 'remove') => {
    if (!bulkGroupId || selectedGuestIds.size === 0) {
      return;
    }
    setApplyingBulkGroup(true);
    const selectedIds = [...selectedGuestIds];
    try {
      await bulkUpdateGuestGroups({
        guestIds: selectedIds,
        groupId: bulkGroupId,
        action,
      });
      setGuests((current) =>
        current.map((guest) => {
          if (!selectedGuestIds.has(guest.id)) {
            return guest;
          }
          const currentGroupIds = Array.isArray(guest.groupIds) ? guest.groupIds : [];
          return {
            ...guest,
            groupIds:
              action === 'add'
                ? [...new Set([...currentGroupIds, bulkGroupId])]
                : currentGroupIds.filter((id) => id !== bulkGroupId),
          };
        })
      );
    } catch {
      alert('עדכון קבוצות נכשל. נסו שוב.');
    } finally {
      setApplyingBulkGroup(false);
    }
  };

  const handleImportGuestsFile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const formData = new FormData(formElement);
    const file = formData.get('guests-file');

    if (!(file instanceof File) || file.size === 0) {
      setImportError('יש לבחור קובץ אקסל לפני הייבוא.');
      return;
    }

    setImportError('');
    setImportingGuests(true);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const firstSheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' });

      const importedGuests = rows
        .map((row) => {
          const detectedGroupIds = groups
            .filter((group) => parseGroupExcelCell(row[group.name]))
            .map((group) => group.id);
          return {
            name: String(row['שם האורח'] ?? row['שם'] ?? row['name'] ?? '').trim(),
            phoneNumber: String(
              row['מספר פלאפון'] ?? row['מספר טלפון'] ?? row['phoneNumber'] ?? ''
            ).trim(),
            expectedPartySize: Number(
              row['כמות אורחים'] ?? row['כמות אורחים צפויה'] ?? row['expectedPartySize'] ?? 0
            ),
            status: String(row['סטטוס הגעה'] ?? row['status'] ?? '').trim() || 'מתלבט',
            groupIds: detectedGroupIds,
          };
        })
        .filter((row) => row.name && row.phoneNumber && row.expectedPartySize >= 1);

      if (importedGuests.length === 0) {
        setImportError(
          'לא נמצאו נתונים תקינים בקובץ. ודאו שיש עמודות: שם האורח, מספר פלאפון, כמות אורחים, סטטוס הגעה.'
        );
        return;
      }

      const result = await importGuests(importedGuests);
      setGuests((current) => [...current, ...result.guests]);
      alert(`הייבוא הושלם. נוספו ${result.createdCount} אורחים, ודולגו ${result.skippedCount}.`);
      formElement.reset();
    } catch {
      setImportError('הייבוא נכשל. ודאו שהקובץ תקין ונסו שוב.');
    } finally {
      setImportingGuests(false);
    }
  };

  const handleExportExcelStyled = async () => {
    setDownloadingTemplate(true);
    try {
      const { Workbook } = await import('exceljs');
      const workbook = new Workbook();
      const worksheet = workbook.addWorksheet('Guests');

      worksheet.columns = [
        { header: 'שם האורח', key: 'guestName', width: 28 },
        { header: 'מספר פלאפון', key: 'phoneNumber', width: 20 },
        { header: 'כמות אורחים', key: 'expectedPartySize', width: 16 },
        { header: 'סטטוס הגעה', key: 'status', width: 20 },
        ...groups.map((group) => ({
          header: group.name,
          key: `group_${group.id}`,
          width: Math.max(14, group.name.length + 6),
        })),
      ];

      const headerRow = worksheet.getRow(1);
      headerRow.height = 24;
      headerRow.eachCell((cell) => {
        cell.font = {
          name: 'Calibri',
          size: 12,
          bold: true,
          color: { argb: 'FFFFFFFF' },
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFD4AF37' },
        };
        cell.alignment = {
          vertical: 'middle',
          horizontal: 'center',
        };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFB89328' } },
          left: { style: 'thin', color: { argb: 'FFB89328' } },
          bottom: { style: 'thin', color: { argb: 'FFB89328' } },
          right: { style: 'thin', color: { argb: 'FFB89328' } },
        };
      });

      visibleGuests.forEach((guest) => {
        const groupColumns = Object.fromEntries(
          groups.map((group) => [`group_${group.id}`, guest.groupIds.includes(group.id) ? 1 : 0])
        );
        const createdRow = worksheet.addRow({
          guestName: guest.name,
          phoneNumber: guest.phoneNumber,
          expectedPartySize: guest.expectedPartySize,
          status: statusLabelMap[guest.status],
          ...groupColumns,
        });
        const phoneCell = createdRow.getCell(2);
        phoneCell.numFmt = '@';
        phoneCell.value = String(guest.phoneNumber);
      });

      for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber);
        row.eachCell((cell) => {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE4D7B7' } },
            left: { style: 'thin', color: { argb: 'FFE4D7B7' } },
            bottom: { style: 'thin', color: { argb: 'FFE4D7B7' } },
            right: { style: 'thin', color: { argb: 'FFE4D7B7' } },
          };
        });

        const guest = visibleGuests[rowNumber - 2];
        const statusCell = row.getCell(4);
        if (guest?.status === 'Attending') {
          statusCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE8F7EE' },
          };
          statusCell.font = { color: { argb: 'FF1F6B3A' }, bold: true };
        } else if (guest?.status === 'Not Attending') {
          statusCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFDECEC' },
          };
          statusCell.font = { color: { argb: 'FF9F2D2D' }, bold: true };
        } else {
          statusCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFF8E6' },
          };
          statusCell.font = { color: { argb: 'FF8A6A1B' }, bold: true };
        }
      }

      for (let rowNumber = 2; rowNumber <= Math.max(worksheet.rowCount, 500); rowNumber += 1) {
        const statusCell = worksheet.getRow(rowNumber).getCell(4);
        statusCell.dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: ['"מגיע,מתלבט,לא מגיע"'],
          showErrorMessage: true,
          errorTitle: 'סטטוס לא תקין',
          error: 'יש לבחור סטטוס מהרשימה בלבד.',
        };
      }

      const fileBuffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([fileBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.setAttribute('download', 'guests-styled.xlsx');
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const handleDownloadStyledExcelTemplate = async () => {
    setDownloadingTemplate(true);
    try {
      const { Workbook } = await import('exceljs');
      const workbook = new Workbook();
      const worksheet = workbook.addWorksheet('Guests Template');

      worksheet.columns = [
        { header: 'שם האורח', key: 'guestName', width: 28 },
        { header: 'מספר פלאפון', key: 'phoneNumber', width: 20 },
        { header: 'כמות אורחים', key: 'expectedPartySize', width: 16 },
        { header: 'סטטוס הגעה', key: 'status', width: 20 },
        ...groups.map((group) => ({
          header: group.name,
          key: `group_${group.id}`,
          width: Math.max(14, group.name.length + 6),
        })),
      ];

      const headerRow = worksheet.getRow(1);
      headerRow.height = 24;
      headerRow.eachCell((cell) => {
        cell.font = {
          name: 'Calibri',
          size: 12,
          bold: true,
          color: { argb: 'FFFFFFFF' },
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFD4AF37' },
        };
        cell.alignment = {
          vertical: 'middle',
          horizontal: 'center',
        };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFB89328' } },
          left: { style: 'thin', color: { argb: 'FFB89328' } },
          bottom: { style: 'thin', color: { argb: 'FFB89328' } },
          right: { style: 'thin', color: { argb: 'FFB89328' } },
        };
      });

      const exampleGroups = Object.fromEntries(
        groups.map((group, index) => [`group_${group.id}`, index === 0 ? 1 : 0])
      );
      worksheet.addRow({
        guestName: 'ישראל ישראלי',
        phoneNumber: '0501234567',
        expectedPartySize: 2,
        status: 'מתלבט',
        ...exampleGroups,
      });

      const dataRow = worksheet.getRow(2);
      dataRow.eachCell((cell) => {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE4D7B7' } },
          left: { style: 'thin', color: { argb: 'FFE4D7B7' } },
          bottom: { style: 'thin', color: { argb: 'FFE4D7B7' } },
          right: { style: 'thin', color: { argb: 'FFE4D7B7' } },
        };
      });

      for (let rowNumber = 2; rowNumber <= 500; rowNumber += 1) {
        const statusCell = worksheet.getRow(rowNumber).getCell(4);
        statusCell.dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: ['"מגיע,מתלבט,לא מגיע"'],
          showErrorMessage: true,
          errorTitle: 'סטטוס לא תקין',
          error: 'יש לבחור סטטוס מהרשימה בלבד.',
        };
      }

      const fileBuffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([fileBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.setAttribute('download', 'guest-template-styled.xlsx');
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const getStatusBadgeClassName = (status: Guest['status']) => {
    if (status === 'Attending') {
      return 'bg-emerald-100 text-emerald-800';
    }
    if (status === 'Not Attending') {
      return 'bg-rose-100 text-rose-800';
    }
    return 'bg-amber-100 text-amber-900';
  };

  return (
    <section className="relative space-y-6 overflow-hidden rounded-3xl bg-[#F9F7F2] p-4 sm:p-6">
      <div className="pointer-events-none absolute -right-16 top-4 h-52 w-52 rounded-full bg-wedding-champagne/40 blur-3xl" />
      <div className="pointer-events-none absolute -left-20 bottom-10 h-64 w-64 rounded-full bg-amber-100/35 blur-3xl" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-wedding-gold/30 bg-white/90 px-4 py-3 shadow-sm backdrop-blur-sm">
          <p className="text-xs tracking-wider text-wedding-gold">סה"כ הזמנות</p>
          <p className="mt-1 text-2xl font-semibold text-wedding-charcoal">{totalInvitations}</p>
        </div>
        <div className="rounded-2xl border border-wedding-gold/30 bg-white/90 px-4 py-3 shadow-sm backdrop-blur-sm">
          <p className="text-xs tracking-wider text-wedding-gold">אישרו הגעה</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-800">{confirmedInvitations}</p>
        </div>
        <div className="rounded-2xl border border-wedding-gold/30 bg-white/90 px-4 py-3 shadow-sm backdrop-blur-sm">
          <p className="text-xs tracking-wider text-wedding-gold">לא אישרו</p>
          <p className="mt-1 text-2xl font-semibold text-rose-800">{declinedInvitations}</p>
        </div>
        <div className="rounded-2xl border border-wedding-gold/30 bg-white/90 px-4 py-3 shadow-sm backdrop-blur-sm">
          <p className="text-xs tracking-wider text-wedding-gold">עוד לא עידכנו</p>
          <p className="mt-1 text-2xl font-semibold text-amber-900">{pendingInvitations}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-wedding-gold/30 bg-white/90 px-4 py-3 shadow-sm backdrop-blur-sm">
          <p className="text-xs tracking-wider text-wedding-gold">כמות אורחים צפויה</p>
          <p className="mt-1 text-2xl font-semibold text-wedding-charcoal">{totalExpectedGuests}</p>
        </div>
        <div className="rounded-2xl border border-wedding-gold/30 bg-white/90 px-4 py-3 shadow-sm backdrop-blur-sm">
          <p className="text-xs tracking-wider text-wedding-gold">כמות אורחים בפועל</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-800">{totalConfirmedPartySize}</p>
        </div>
        <div className="rounded-2xl border border-wedding-gold/30 bg-white/90 px-4 py-3 shadow-sm backdrop-blur-sm">
          <p className="text-xs tracking-wider text-wedding-gold">ממתינים לאישור (אורחים)</p>
          <p className="mt-1 text-2xl font-semibold text-amber-900">{waitingExpectedGuests}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white/95 p-4 shadow-lg backdrop-blur-sm sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <h2 className="text-xl font-semibold text-slate-800">רשימת אורחים</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded-lg border border-wedding-gold/30 bg-white px-4 py-2 text-sm font-medium text-wedding-charcoal transition hover:bg-stone-50"
              disabled={downloadingTemplate}
              onClick={() => void handleExportExcelStyled()}
              type="button"
            >
              {downloadingTemplate ? 'טוען...' : '⬇ ייצוא Excel מעוצב'}
            </button>
            <button
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-300"
              disabled={sendingNotifications}
              onClick={handleTrigger}
              type="button"
            >
              {sendingNotifications ? 'טוען...' : 'שלח תזכורות'}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white/95 p-4 shadow-lg backdrop-blur-sm sm:p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-800">ניהול קבוצות</h3>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none sm:max-w-xs"
            onChange={(event) => setNewGroupName(event.target.value)}
            placeholder="שם קבוצה חדשה"
            type="text"
            value={newGroupName}
          />
          <button
            className="rounded-lg bg-wedding-charcoal px-4 py-2 text-sm font-medium text-wedding-champagne transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-500"
            disabled={creatingGroup}
            onClick={() => void handleCreateGroup()}
            type="button"
          >
            {creatingGroup ? 'טוען...' : 'יצירת קבוצה'}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {groups.length === 0 ? (
            <p className="text-sm text-slate-500">עדיין לא הוגדרו קבוצות.</p>
          ) : (
            groups.map((group) => (
              <div
                className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-900"
                key={group.id}
              >
                <span>{group.name}</span>
                <button
                  className="text-rose-600 transition hover:text-rose-800"
                  disabled={deletingGroupId === group.id}
                  onClick={() => void handleDeleteGroup(group.id)}
                  type="button"
                >
                  {deletingGroupId === group.id ? '...' : 'מחק'}
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white/95 p-4 shadow-lg backdrop-blur-sm sm:p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-800">הוסף אורח</h3>
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-4" onSubmit={addGuest}>
          <input
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="שם אורח"
            required
            type="text"
            value={form.name}
          />
          <input
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
            onChange={(e) => setForm((prev) => ({ ...prev, phoneNumber: e.target.value }))}
            placeholder="מספר טלפון"
            required
            type="text"
            value={form.phoneNumber}
          />
          <input
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
            min={1}
            onChange={(e) => setForm((prev) => ({ ...prev, partySize: Number(e.target.value) }))}
            placeholder="כמות אורחים"
            required
            type="number"
            value={form.partySize}
          />
          <button
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={submittingGuest}
            type="submit"
          >
            {submittingGuest ? 'טוען...' : 'הוסף אורח'}
          </button>
        </form>
        {formError && <p className="mt-3 text-sm text-red-600">{formError}</p>}

        <div className="mt-6 border-t border-stone-200 pt-4">
          <h4 className="mb-2 text-sm font-semibold text-slate-700">ייבוא רשימת מוזמנים מקובץ Excel</h4>
          <p className="mb-3 text-xs text-slate-500">
            פורמט עמודות נדרש: שם האורח, מספר פלאפון, כמות אורחים, סטטוס הגעה (אם ריק ייחשב מתלבט)
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              className="rounded-lg border border-wedding-gold/40 bg-white px-3 py-2 text-xs font-medium text-wedding-charcoal transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={downloadingTemplate}
              onClick={() => void handleDownloadStyledExcelTemplate()}
              type="button"
            >
              {downloadingTemplate ? 'טוען...' : 'הורדת תבנית Excel מעוצבת'}
            </button>
          </div>
          <form className="flex flex-col gap-3 sm:flex-row sm:items-center" onSubmit={handleImportGuestsFile}>
            <input
              accept=".xlsx"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 file:me-3 file:rounded-md file:border-0 file:bg-amber-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-amber-900"
              name="guests-file"
              type="file"
            />
            <button
              className="rounded-lg bg-wedding-charcoal px-4 py-2 text-sm font-medium text-wedding-champagne transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-500"
              disabled={importingGuests}
              type="submit"
            >
              {importingGuests ? 'טוען...' : 'ייבוא מאקסל'}
            </button>
          </form>
          {importError && <p className="mt-2 text-sm text-red-600">{importError}</p>}
        </div>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white/95 p-4 shadow-lg backdrop-blur-sm sm:p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-800">מרכז התראות וואטסאפ</h3>
        <div className="mb-5 rounded-xl border border-stone-200 bg-stone-50 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-700">חיבור וואטסאפ</p>
            <div className="flex items-center gap-2">
              <button
                className="rounded-md border border-stone-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-stone-100"
                onClick={() => void loadWhatsAppStatus()}
                type="button"
              >
                רענן קוד
              </button>
              <button
                className="rounded-md border border-rose-300 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={disconnectingWhatsApp}
                onClick={() => void handleDisconnectWhatsApp()}
                type="button"
              >
                {disconnectingWhatsApp ? 'מנתק...' : 'התנתק מחשבון'}
              </button>
            </div>
          </div>
          <p className={`mb-3 text-sm ${whatsAppReady ? 'text-emerald-700' : 'text-amber-700'}`}>
            {whatsAppStatusMessage}
          </p>
          {!whatsAppReady && whatsAppQrDataUrl && (
            <div className="inline-block rounded-lg border border-stone-200 bg-white p-2">
              <img
                alt="WhatsApp QR"
                className="h-56 w-56 max-w-full"
                src={whatsAppQrDataUrl}
              />
            </div>
          )}
        </div>
        <form className="space-y-4" onSubmit={handleWhatsAppSubmit}>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="wa-message">
              תוכן הודעה
            </label>
            <textarea
              className="min-h-28 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
              id="wa-message"
              onChange={(e) => setNotificationMessage(e.target.value)}
              placeholder="שלום {{name}}, לאישור הגעה לחצו על {{link}}"
              value={notificationMessage}
            />
            <p className="mt-1 text-xs text-slate-500">
              ניתן להשתמש במשתנים: {'{{name}}'}, {'{{link}}'}, {'{{link_here}}'} (טקסט ״לחץ כאן״ בשורה לפני הקישור).
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="wa-link">
              קישור לעמוד אישור הגעה
            </label>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
              id="wa-link"
              onChange={(e) => setNotificationLink(e.target.value)}
              placeholder="http://localhost:5173"
              required
              type="url"
              value={notificationLink}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="wa-filter">
              קהל יעד
            </label>
            <select
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
              id="wa-filter"
              onChange={(e) => setNotificationFilter(e.target.value as 'All' | Guest['status'])}
              value={notificationFilter}
            >
              <option value="All">כל האורחים</option>
              <option value="Attending">אישרו הגעה</option>
              <option value="Pending">ממתינים לתשובה</option>
              <option value="Not Attending">לא מגיעים</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="wa-sent-filter">
              נשלחה הודעה
            </label>
            <select
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
              id="wa-sent-filter"
              onChange={(event) =>
                setNotificationMessageSentFilter(event.target.value as NotificationMessageSentFilter)
              }
              value={notificationMessageSentFilter}
            >
              <option value="All">הכל</option>
              <option value="Sent">כן</option>
              <option value="Not Sent">לא</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="wa-group-filter">
              סינון לפי קבוצה (אופציונלי)
            </label>
            <select
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
              id="wa-group-filter"
              onChange={(event) => setNotificationGroupFilter(event.target.value)}
              value={notificationGroupFilter}
            >
              <option value="">כל הקבוצות</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="wa-image">
              צרוף תמונה (אופציונלי)
            </label>
            <input
              accept="image/*"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 file:me-3 file:rounded-md file:border-0 file:bg-amber-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-amber-900"
              id="wa-image"
              onChange={(event) =>
                void handleNotificationImageChange(event.target.files?.[0] ?? null)
              }
              type="file"
            />
            {notificationImage?.fileName && (
              <div className="mt-2 flex items-center gap-3">
                <img
                  alt="תצוגה מקדימה"
                  className="h-12 w-12 rounded-md border border-stone-200 object-cover"
                  src={notificationImage.dataUrl}
                />
                <p className="text-xs text-slate-500">נבחר קובץ: {notificationImage.fileName}</p>
                <button
                  className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-100"
                  onClick={() => setNotificationImage(null)}
                  type="button"
                >
                  הסר תמונה
                </button>
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-slate-700">
            <input
              checked={notificationSelectedOnly}
              className="h-4 w-4"
              onChange={(event) => setNotificationSelectedOnly(event.target.checked)}
              type="checkbox"
            />
            מסומנים בלבד ({selectedGuestIds.size})
          </label>

          {sendingNotifications && sendProgress && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-sm font-medium text-emerald-900">
                נשלחו {sendProgress.sentCount} מתוך {sendProgress.totalRecipients}
              </p>
              <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-emerald-100">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-emerald-800">
                עובדו {sendProgress.processedCount}/{sendProgress.totalRecipients} | הצליחו{' '}
                {sendProgress.sentCount} | נכשלו {sendProgress.failedCount}
              </p>
            </div>
          )}
          {activeWhatsAppJob && (
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-slate-700">
              <p>
                מצב משימה: {activeWhatsAppJob.status} | עובדו {activeWhatsAppJob.processedCount}/
                {activeWhatsAppJob.totalRecipients}
              </p>
              <p>
                הצליחו {activeWhatsAppJob.sentCount} | נכשלו {activeWhatsAppJob.failedCount}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 disabled:opacity-60"
                  disabled={pausingJob || activeWhatsAppJob.status !== 'running'}
                  onClick={() => void handlePauseWhatsAppJob()}
                  type="button"
                >
                  {pausingJob ? 'ממתין...' : 'השהה שליחה'}
                </button>
                <button
                  className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 disabled:opacity-60"
                  disabled={resumingJob || activeWhatsAppJob.status !== 'paused'}
                  onClick={() => void handleResumeWhatsAppJob()}
                  type="button"
                >
                  {resumingJob ? 'ממתין...' : 'המשך שליחה'}
                </button>
              </div>
            </div>
          )}

          <button
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-300"
            disabled={sendingNotifications || activeWhatsAppJob?.status === 'running'}
            type="submit"
          >
            {sendingNotifications ? 'יוצר משימה...' : 'שלח הודעות וואטסאפ'}
          </button>
        </form>
        {notificationError && <p className="mt-3 text-sm text-red-600">{notificationError}</p>}
      </div>

      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white/95 shadow-lg backdrop-blur-sm">
        {selectedGuestIds.size > 0 && (
          <div className="animate-slide-up border-b border-amber-200 bg-amber-50/80 px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <p className="text-sm font-medium text-amber-900">
                נבחרו {selectedGuestIds.size} אורחים - סרגל פעולות
              </p>
              <select
                className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-amber-500 focus:outline-none sm:w-56"
                onChange={(event) => setBulkGroupId(event.target.value)}
                value={bulkGroupId}
              >
                <option value="">בחר קבוצה</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
              <button
                className="rounded-lg bg-wedding-charcoal px-3 py-2 text-sm font-medium text-wedding-champagne transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-500"
                disabled={!bulkGroupId || applyingBulkGroup}
                onClick={() => void handleBulkGroupAction('add')}
                type="button"
              >
                {applyingBulkGroup ? 'טוען...' : 'הוסף לקבוצה'}
              </button>
              <button
                className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!bulkGroupId || applyingBulkGroup}
                onClick={() => void handleBulkGroupAction('remove')}
                type="button"
              >
                הסר מקבוצה
              </button>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-3 border-b border-stone-200 bg-stone-50 p-4 sm:flex-row">
          <input
            className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none sm:flex-1"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="חיפוש אורח לפי שם או טלפון..."
            type="text"
            value={searchQuery}
          />
          <select
            className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-amber-500 focus:outline-none sm:w-56"
            onChange={(event) =>
              setStatusFilter(event.target.value as 'All' | Guest['status'] | 'Maybe')
            }
            value={statusFilter}
          >
            <option value="All">כל הסטטוסים</option>
            <option value="Attending">מגיע</option>
            <option value="Not Attending">לא מגיע</option>
            <option value="Maybe">מתלבט</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-right text-sm">
            <thead className="bg-white text-slate-700">
              <tr>
                <th className="px-4 py-3 text-xs font-semibold tracking-wider text-wedding-gold">
                  <input
                    checked={
                      visibleGuests.length > 0 &&
                      visibleGuests.every((guest) => selectedGuestIds.has(guest.id))
                    }
                    onChange={toggleSelectAllVisible}
                    type="checkbox"
                  />
                </th>
                <th className="px-4 py-3 text-xs font-semibold tracking-wider text-wedding-gold">שם</th>
                <th className="px-4 py-3 text-xs font-semibold tracking-wider text-wedding-gold">טלפון</th>
                <th className="px-4 py-3 text-xs font-semibold tracking-wider text-wedding-gold">
                  <button
                    className="inline-flex items-center gap-1 text-wedding-gold transition hover:text-amber-700"
                    onClick={() =>
                      setSortByStatusDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
                    }
                    type="button"
                  >
                    סטטוס
                    <span>{sortByStatusDirection === 'asc' ? '▲' : '▼'}</span>
                  </button>
                </th>
                <th className="px-4 py-3 text-xs font-semibold tracking-wider text-wedding-gold">כמות אורחים</th>
                <th className="px-4 py-3 text-xs font-semibold tracking-wider text-wedding-gold">כמות אורחים צפויה</th>
                <th className="px-4 py-3 text-xs font-semibold tracking-wider text-wedding-gold">נשלחה הודעה</th>
                <th className="px-4 py-3 text-xs font-semibold tracking-wider text-wedding-gold">קבוצות</th>
                <th className="px-4 py-3 text-xs font-semibold tracking-wider text-wedding-gold">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td className="px-4 py-4 text-slate-500" colSpan={9}>
                    טוען...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td className="px-4 py-4 text-red-600" colSpan={9}>
                    {error}
                  </td>
                </tr>
              ) : filteredGuests.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-slate-500" colSpan={9}>
                    {searchQuery.trim()
                      ? 'לא נמצאו אורחים התואמים לחיפוש.'
                      : 'אין אורחים כרגע.'}
                  </td>
                </tr>
              ) : (
                visibleGuests.map((guest) => (
                  <tr className="transition-all duration-300 hover:bg-amber-50/40" key={guest.id}>
                    <td className="px-4 py-3">
                      <input
                        checked={selectedGuestIds.has(guest.id)}
                        onChange={() => toggleGuestSelection(guest.id)}
                        type="checkbox"
                      />
                    </td>
                    <td className="px-4 py-3">
                      {editingPhone === guest.phoneNumber ? (
                        <input
                          className="w-full rounded-md border border-stone-200 bg-white px-2 py-1 text-sm focus:border-amber-500 focus:outline-none"
                          onChange={(event) =>
                            setEditForm((current) => ({ ...current, name: event.target.value }))
                          }
                          type="text"
                          value={editForm.name}
                        />
                      ) : (
                        guest.name
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editingPhone === guest.phoneNumber ? (
                        <input
                          className="w-full rounded-md border border-stone-200 bg-white px-2 py-1 text-sm focus:border-amber-500 focus:outline-none"
                          onChange={(event) =>
                            setEditForm((current) => ({ ...current, phoneNumber: event.target.value }))
                          }
                          type="text"
                          value={editForm.phoneNumber}
                        />
                      ) : (
                        guest.phoneNumber
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editingPhone === guest.phoneNumber ? (
                        <select
                          className="w-full rounded-md border border-stone-200 bg-white px-2 py-1 text-sm focus:border-amber-500 focus:outline-none"
                          onChange={(event) =>
                            setEditForm((current) => ({
                              ...current,
                              status: event.target.value as Guest['status'],
                            }))
                          }
                          value={editForm.status}
                        >
                          <option value="Attending">מגיע</option>
                          <option value="Pending">מתלבט</option>
                          <option value="Not Attending">לא מגיע</option>
                        </select>
                      ) : (
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusBadgeClassName(guest.status)}`}
                        >
                          {statusLabelMap[guest.status]}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editingPhone === guest.phoneNumber ? (
                        <input
                          className="w-24 rounded-md border border-stone-200 bg-white px-2 py-1 text-sm focus:border-amber-500 focus:outline-none"
                          min={0}
                          onChange={(event) =>
                            setEditForm((current) => ({
                              ...current,
                              partySize: Number(event.target.value),
                            }))
                          }
                          type="number"
                          value={editForm.status === 'Attending' ? editForm.partySize : 0}
                        />
                      ) : guest.status === 'Attending' ? (
                        guest.partySize
                      ) : (
                        0
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editingPhone === guest.phoneNumber ? (
                        <input
                          className="w-24 rounded-md border border-stone-200 bg-white px-2 py-1 text-sm focus:border-amber-500 focus:outline-none"
                          min={1}
                          onChange={(event) =>
                            setEditForm((current) => ({
                              ...current,
                              expectedPartySize: Number(event.target.value),
                            }))
                          }
                          type="number"
                          value={editForm.expectedPartySize}
                        />
                      ) : (
                        guest.expectedPartySize
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                          guest.messageSent ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {guest.messageSent ? 'כן' : 'לא'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {editingPhone === guest.phoneNumber ? (
                        <div className="flex flex-wrap gap-2">
                          {groups.map((group) => (
                            <label
                              className="inline-flex items-center gap-1 text-xs text-slate-700"
                              key={group.id}
                            >
                              <input
                                checked={editForm.groupIds.includes(group.id)}
                                onChange={(event) =>
                                  setEditForm((current) => {
                                    const nextSet = new Set(current.groupIds);
                                    if (event.target.checked) {
                                      nextSet.add(group.id);
                                    } else {
                                      nextSet.delete(group.id);
                                    }
                                    return { ...current, groupIds: [...nextSet] };
                                  })
                                }
                                type="checkbox"
                              />
                              <span>{group.name}</span>
                            </label>
                          ))}
                        </div>
                      ) : Array.isArray(guest.groupIds) && guest.groupIds.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {guest.groupIds.map((groupId) => (
                            <span
                              className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-900"
                              key={`${guest.id}-${groupId}`}
                            >
                              {groupNameById.get(groupId) || 'קבוצה'}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">ללא קבוצה</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {editingPhone === guest.phoneNumber ? (
                          <>
                            <button
                              className="font-medium text-emerald-700 transition hover:text-emerald-900 disabled:opacity-60"
                              disabled={savingGuest}
                              onClick={() => void saveEditingGuest(guest.phoneNumber)}
                              type="button"
                            >
                              {savingGuest ? 'טוען...' : 'שמור'}
                            </button>
                            <button
                              className="font-medium text-slate-500 transition hover:text-slate-700"
                              onClick={cancelEditingGuest}
                              type="button"
                            >
                              ביטול
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="font-medium text-amber-700 transition hover:text-amber-900"
                              onClick={() => startEditingGuest(guest)}
                              type="button"
                            >
                              ערוך
                            </button>
                            <button
                              className="font-medium text-rose-500 transition hover:text-rose-700 disabled:cursor-not-allowed disabled:text-rose-300"
                              disabled={deletingPhone === guest.phoneNumber}
                              onClick={() => void handleDeleteGuest(guest.phoneNumber)}
                              type="button"
                            >
                              {deletingPhone === guest.phoneNumber ? 'טוען...' : 'מחק'}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
