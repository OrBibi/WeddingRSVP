import { useEffect, useState, type FormEvent } from 'react';
import type { Guest, GuestStatus } from '../../../shared/types';
import {
  fetchPublicInvitation,
  fetchPublicInvitationBySlug,
  submitPublicRsvp,
  submitPublicRsvpBySlug,
} from '../api';
import type { RSVPTheme } from '../App';

const statusLabelMap: Record<GuestStatus, string> = {
  Pending: 'מתלבט',
  Attending: 'מגיע',
  'Not Attending': 'לא מגיע',
};

interface RSVPProps {
  theme: RSVPTheme;
}

const themeClassMap: Record<
  RSVPTheme,
  {
    section: string;
    card: string;
    buttonPrimary: string;
    buttonSecondary: string;
  }
> = {
  floral: {
    section: 'rsvp-theme-floral',
    card: 'border-wedding-gold/30 bg-white/86',
    buttonPrimary:
      'bg-wedding-charcoal text-wedding-champagne hover:shadow-wedding-gold/20 disabled:bg-slate-500 disabled:text-slate-200',
    buttonSecondary:
      'bg-wedding-gold text-wedding-charcoal hover:shadow-wedding-gold/30 disabled:bg-amber-200 disabled:text-slate-500',
  },
  ocean: {
    section: 'rsvp-theme-ocean',
    card: 'border-sky-300/45 bg-white/86',
    buttonPrimary:
      'bg-sky-900 text-sky-100 hover:shadow-sky-200/50 disabled:bg-slate-500 disabled:text-slate-200',
    buttonSecondary:
      'bg-sky-300 text-sky-950 hover:shadow-sky-300/40 disabled:bg-sky-100 disabled:text-slate-500',
  },
  classic: {
    section: 'rsvp-theme-classic',
    card: 'border-amber-400/40 bg-white/88',
    buttonPrimary:
      'bg-amber-900 text-amber-100 hover:shadow-amber-300/40 disabled:bg-slate-500 disabled:text-slate-200',
    buttonSecondary:
      'bg-amber-500 text-amber-950 hover:shadow-amber-300/40 disabled:bg-amber-200 disabled:text-slate-500',
  },
};

export default function RSVP({ theme }: RSVPProps) {
  const longPathMatch = window.location.pathname.match(/^\/rsvp\/([^/]+)\/([^/]+)$/);
  const shortPathMatch = window.location.pathname.match(/^\/r\/([^/]+)\/([^/]+)$/);
  const weddingIdFromPath = longPathMatch?.[1] ?? shortPathMatch?.[1] ?? null;
  const guestIdFromPath = longPathMatch?.[2] ?? null;
  const slugFromPath = shortPathMatch?.[2] ?? null;
  const tokenFromQuery = new URLSearchParams(window.location.search).get('token');
  const hasDirectInvitation = Boolean(
    weddingIdFromPath && tokenFromQuery && (guestIdFromPath || slugFromPath)
  );

  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [status, setStatus] = useState<GuestStatus>('Pending');
  const [partySize, setPartySize] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const selectedTheme = themeClassMap[theme];

  const loadDirectInvitation = async () => {
    if (!weddingIdFromPath || !tokenFromQuery || (!guestIdFromPath && !slugFromPath)) {
      return;
    }
    setLoading(true);
    setError('');
    setConfirmation('');
    setSelectedGuest(null);
    try {
      const invitation = slugFromPath
        ? await fetchPublicInvitationBySlug(weddingIdFromPath, slugFromPath, tokenFromQuery)
        : await fetchPublicInvitation(weddingIdFromPath, guestIdFromPath!, tokenFromQuery);
      setSelectedGuest({
        id: invitation.id,
        weddingId: invitation.weddingId,
        name: invitation.name,
        phoneNumber: '',
        status: invitation.status,
        expectedPartySize: 1,
        partySize: invitation.partySize,
        groupIds: [],
      });
      setStatus(invitation.status);
      setPartySize('');
    } catch {
      setError('לא ניתן לטעון את ההזמנה האישית. בדקו שהקישור תקין.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (hasDirectInvitation) {
      void loadDirectInvitation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDirectInvitation]);

  const submitRsvp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedGuest) {
      return;
    }

    setSaving(true);
    setError('');

    try {
      if (!weddingIdFromPath || !tokenFromQuery || (!guestIdFromPath && !slugFromPath)) {
        throw new Error('Missing invitation details.');
      }
      const trimmedPartySize = partySize.trim();
      if (status === 'Attending') {
        const parsedForAttending = Number(trimmedPartySize);
        if (!trimmedPartySize || !Number.isFinite(parsedForAttending) || parsedForAttending <= 0) {
          setError('כדי לאשר הגעה צריך להזין מספר אורחים גדול מ-0.');
          return;
        }
      }
      const parsedPartySize = Number(trimmedPartySize);
      const normalizedPartySize =
        Number.isFinite(parsedPartySize) && parsedPartySize > 0 ? Math.floor(parsedPartySize) : 1;
      const updated = slugFromPath
        ? await submitPublicRsvpBySlug(weddingIdFromPath, slugFromPath, {
            token: tokenFromQuery,
            status,
            partySize: normalizedPartySize,
          })
        : await submitPublicRsvp(weddingIdFromPath, guestIdFromPath!, {
            token: tokenFromQuery,
            status,
            partySize: normalizedPartySize,
          });
      setSelectedGuest(updated);
      setPartySize(String(updated.partySize ?? ''));
      setConfirmation('תודה! אישור ההגעה התקבל.');
    } catch {
      setError('לא ניתן לעדכן את אישור ההגעה. נסו שוב.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={`relative min-h-screen overflow-hidden px-4 py-8 sm:px-6 ${selectedTheme.section}`}>
      <div className="pointer-events-none absolute inset-0 opacity-55">
        <div className="absolute right-8 top-10 h-32 w-32 rounded-full bg-white/60 blur-2xl" />
        <div className="absolute bottom-14 left-10 h-44 w-44 rounded-full bg-[#f7e7ce]/55 blur-3xl" />
        <div className="absolute left-1/2 top-8 h-28 w-28 -translate-x-1/2 rounded-full bg-white/35 blur-2xl" />
      </div>
      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-2xl items-center justify-center">
        <div
          className={`w-full animate-fade-in animate-float rounded-3xl border p-8 shadow-2xl backdrop-blur-xl sm:p-12 ${selectedTheme.card} text-base sm:text-lg`}
        >
          <h2 className="animate-slide-up text-4xl font-semibold tracking-wide text-wedding-charcoal sm:text-5xl lg:text-6xl">
            נשמח לראותכם
          </h2>
          <p className="mt-4 animate-slide-up font-sans text-lg text-slate-600 sm:text-xl">
            אישור הגעה דרך הזמנה אישית
          </p>

          <div className="mt-8 animate-slide-up">
            {loading && <p className="text-lg text-slate-600 sm:text-xl">טוען הזמנה אישית...</p>}
            {!loading && !hasDirectInvitation && (
              <p className="text-lg text-rose-800 sm:text-xl">
                לא נמצאו פרטי הזמנה בקישור. יש להיכנס דרך קישור ההזמנה שקיבלתם בוואטסאפ.
              </p>
            )}
          </div>

          {selectedGuest && (
            <form className="mt-10 animate-slide-up space-y-6 border-t border-wedding-gold/20 pt-8" onSubmit={submitRsvp}>
              <p className="text-lg text-slate-700 sm:text-xl">
                שלום <span className="font-semibold text-wedding-charcoal">{selectedGuest.name}</span>, נא לעדכן את פרטי ההגעה:
              </p>

              <div>
                <label className="mb-2 block text-lg font-medium text-slate-700 sm:text-xl" htmlFor="status">
                  סטטוס הגעה
                </label>
                <select
                  className="w-full rounded-xl border border-slate-200/90 bg-white/80 px-4 py-4 text-lg text-slate-800 transition-all duration-300 focus:border-wedding-gold focus:outline-none focus:ring-2 focus:ring-wedding-gold sm:text-xl"
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
                <label className="mb-2 block text-lg font-medium text-slate-700 sm:text-xl" htmlFor="party-size">
                  כמות אורחים
                </label>
                <input
                  className="w-full rounded-xl border border-slate-200/90 bg-white/80 px-4 py-4 text-lg text-slate-800 transition-all duration-300 focus:border-wedding-gold focus:outline-none focus:ring-2 focus:ring-wedding-gold sm:text-xl"
                  id="party-size"
                  min={1}
                  onChange={(e) => setPartySize(e.target.value)}
                  type="number"
                  value={partySize}
                />
              </div>

              <button
                className={`w-full transform rounded-xl px-4 py-4 text-lg font-semibold transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed sm:text-xl ${selectedTheme.buttonSecondary}`}
                disabled={saving}
                type="submit"
              >
                {saving ? 'טוען...' : 'שלח אישור הגעה'}
              </button>
            </form>
          )}

          {error && <p className="mt-6 text-lg text-rose-800 sm:text-xl">{error}</p>}
          {confirmation && <p className="mt-6 text-lg text-emerald-800 sm:text-xl">{confirmation}</p>}
        </div>
      </div>
    </section>
  );
}
