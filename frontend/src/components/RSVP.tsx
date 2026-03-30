import { useState, type FormEvent } from 'react';
import type { Guest, GuestStatus } from '../../../shared/types';
import { fetchGuests, updateRsvp } from '../api';

const statusLabelMap: Record<GuestStatus, string> = {
  Pending: 'ממתין',
  Attending: 'מגיע',
  'Not Attending': 'לא מגיע',
};

export default function RSVP() {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [status, setStatus] = useState<GuestStatus>('Pending');
  const [partySize, setPartySize] = useState(1);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState('');

  const findInvitation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setConfirmation('');
    setSelectedGuest(null);

    try {
      const guests = await fetchGuests();
      const found = guests.find((guest) => guest.phoneNumber === phoneNumber.trim());

      if (!found) {
        setError('מספר טלפון לא נמצא');
        return;
      }

      setSelectedGuest(found);
      setStatus(found.status);
      setPartySize(found.partySize);
    } catch {
      setError('לא ניתן למצוא את ההזמנה כרגע. נסו שוב בעוד רגע.');
    } finally {
      setLoading(false);
    }
  };

  const submitRsvp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedGuest) {
      return;
    }

    setSaving(true);
    setError('');

    try {
      const updated = await updateRsvp({
        phoneNumber: selectedGuest.phoneNumber,
        status,
        partySize,
      });
      setSelectedGuest(updated);
      setConfirmation('תודה! אישור ההגעה התקבל.');
    } catch {
      setError('לא ניתן לעדכן את אישור ההגעה. נסו שוב.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-xl rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="text-xl font-semibold text-slate-800">אישור הגעה</h2>
      <p className="mt-2 text-sm text-slate-600">
        הזן מספר טלפון כדי למצוא את ההזמנה שלך
      </p>

      <form className="mt-4 space-y-3" onSubmit={findInvitation}>
        <label className="block text-sm font-medium text-slate-700" htmlFor="phone-lookup">
          מספר טלפון
        </label>
        <input
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
          id="phone-lookup"
          onChange={(e) => setPhoneNumber(e.target.value)}
          placeholder="0501111111"
          required
          type="text"
          value={phoneNumber}
        />
        <button
          className="w-full rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-300"
          disabled={loading}
          type="submit"
        >
          {loading ? 'טוען...' : 'חפש הזמנה'}
        </button>
      </form>

      {selectedGuest && (
        <form className="mt-6 space-y-4 border-t border-stone-200 pt-5" onSubmit={submitRsvp}>
          <p className="text-sm text-slate-700">
            שלום <span className="font-semibold">{selectedGuest.name}</span>, נא לעדכן את פרטי ההגעה:
          </p>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="status">
              סטטוס הגעה
            </label>
            <select
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
              id="status"
              onChange={(e) => setStatus(e.target.value as GuestStatus)}
              value={status}
            >
              <option value="Pending">{statusLabelMap.Pending}</option>
              <option value="Attending">{statusLabelMap.Attending}</option>
              <option value="Not Attending">{statusLabelMap['Not Attending']}</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="party-size">
              כמות אורחים
            </label>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
              id="party-size"
              min={1}
              onChange={(e) => setPartySize(Number(e.target.value))}
              required
              type="number"
              value={partySize}
            />
          </div>

          <button
            className="w-full rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={saving}
            type="submit"
          >
            {saving ? 'טוען...' : 'שלח אישור הגעה'}
          </button>
        </form>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {confirmation && <p className="mt-4 text-sm text-emerald-700">{confirmation}</p>}
    </section>
  );
}
