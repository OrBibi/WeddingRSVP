import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Guest } from '../../../shared/types';
import {
  createGuest,
  fetchGuests,
  fetchWhatsAppStatus,
  sendWhatsAppNotifications,
  triggerNotifications,
} from '../api';

const defaultForm = {
  name: '',
  phoneNumber: '',
  partySize: 1,
};

const statusLabelMap: Record<Guest['status'], string> = {
  Pending: 'ממתין',
  Attending: 'מגיע',
  'Not Attending': 'לא מגיע',
};

export default function Dashboard() {
  const [guests, setGuests] = useState<Guest[]>([]);
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
  const [notificationSchedule, setNotificationSchedule] = useState('');
  const [notificationLink, setNotificationLink] = useState('http://localhost:5173');
  const [notificationError, setNotificationError] = useState('');
  const [whatsAppReady, setWhatsAppReady] = useState(false);
  const [whatsAppQrDataUrl, setWhatsAppQrDataUrl] = useState<string | null>(null);
  const [whatsAppStatusMessage, setWhatsAppStatusMessage] = useState('טוען מצב התחברות לוואטסאפ...');

  const sortedGuests = useMemo(
    () => [...guests].sort((a, b) => a.name.localeCompare(b.name)),
    [guests]
  );

  const loadGuests = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchGuests();
      setGuests(data);
    } catch {
      setError('לא ניתן לטעון את רשימת האורחים. בדקו שהשרת פועל.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadGuests();
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

    if (!notificationMessage.trim()) {
      setNotificationError('יש להזין תוכן להודעה לפני השליחה.');
      return;
    }

    setSendingNotifications(true);
    try {
      const payload = {
        messageTemplate: notificationMessage.trim(),
        statusFilter: notificationFilter,
        scheduledTime: notificationSchedule ? new Date(notificationSchedule).toISOString() : null,
        rsvpLink: notificationLink.trim(),
      };
      console.log('Submitting WhatsApp notification payload:', payload);
      const result = await sendWhatsAppNotifications(payload);
      alert(
        result.queuedCount > 0
          ? `ההודעות תוזמנו בהצלחה. ${result.queuedCount} הודעות בתור.`
          : `ההודעות נשלחו בהצלחה. ${result.sentCount} הודעות נשלחו.`
      );
    } catch (submitError: unknown) {
      setNotificationError('לא ניתן לשלוח הודעות וואטסאפ כרגע. ודאו שהחיבור פעיל ונסו שוב.');
      if (submitError instanceof Error) {
        console.error('WhatsApp notification request failed:', submitError.message);
      }
    } finally {
      setSendingNotifications(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <h2 className="text-xl font-semibold text-slate-800">רשימת אורחים</h2>
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

      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
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
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-800">מרכז התראות וואטסאפ</h3>
        <div className="mb-5 rounded-xl border border-stone-200 bg-stone-50 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-700">חיבור וואטסאפ</p>
            <button
              className="rounded-md border border-stone-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-stone-100"
              onClick={() => void loadWhatsAppStatus()}
              type="button"
            >
              רענן קוד
            </button>
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
              ניתן להשתמש במשתנים: {'{{name}}'} ו-{'{{link}}'}
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="wa-schedule">
                תזמן הודעה (השאר ריק לשליחה מיידית)
              </label>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
                id="wa-schedule"
                onChange={(e) => setNotificationSchedule(e.target.value)}
                type="datetime-local"
                value={notificationSchedule}
              />
            </div>
          </div>

          <button
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-300"
            disabled={sendingNotifications}
            type="submit"
          >
            {sendingNotifications ? 'טוען...' : 'שלח הודעות וואטסאפ'}
          </button>
        </form>
        {notificationError && <p className="mt-3 text-sm text-red-600">{notificationError}</p>}
      </div>

      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-right text-sm">
            <thead className="bg-stone-100 text-slate-700">
              <tr>
                <th className="px-4 py-3 font-semibold">שם</th>
                <th className="px-4 py-3 font-semibold">טלפון</th>
                <th className="px-4 py-3 font-semibold">סטטוס הגעה</th>
                <th className="px-4 py-3 font-semibold">כמות אורחים</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-4 py-4 text-slate-500" colSpan={4}>
                    טוען...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td className="px-4 py-4 text-red-600" colSpan={4}>
                    {error}
                  </td>
                </tr>
              ) : sortedGuests.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-slate-500" colSpan={4}>
                    אין אורחים כרגע.
                  </td>
                </tr>
              ) : (
                sortedGuests.map((guest) => (
                  <tr className="border-t border-slate-100" key={guest.id}>
                    <td className="px-4 py-3">{guest.name}</td>
                    <td className="px-4 py-3">{guest.phoneNumber}</td>
                    <td className="px-4 py-3">{statusLabelMap[guest.status]}</td>
                    <td className="px-4 py-3">{guest.partySize}</td>
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
