import { useMemo, useState } from 'react';
import Dashboard from './components/Dashboard';
import RSVP from './components/RSVP';

type View = 'dashboard' | 'rsvp';
export type RSVPTheme = 'floral' | 'ocean' | 'classic';

function App() {
  const isPublicRsvpRoute = useMemo(() => {
    const path = window.location.pathname;
    return /^\/rsvp\/[^/]+\/[^/]+$/.test(path) || /^\/r\/[^/]+\/[^/]+$/.test(path);
  }, []);
  const isRsvpOnlyMode = import.meta.env.VITE_RSVP_ONLY === 'true';
  const [view, setView] = useState<View>('dashboard');
  const [rsvpTheme, setRsvpTheme] = useState<RSVPTheme>('floral');

  if (isPublicRsvpRoute) {
    return <RSVP theme={rsvpTheme} />;
  }

  if (isRsvpOnlyMode) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-[#f9f7f2] via-[#f7f2ea] to-[#f3ece1] px-4 py-6 sm:px-8">
        <div className="mx-auto max-w-2xl rounded-3xl border border-wedding-gold/25 bg-white/90 p-8 text-center shadow-xl">
          <h1 className="text-2xl font-semibold text-wedding-charcoal">עמוד פרטי</h1>
          <p className="mt-3 text-sm text-slate-600 sm:text-base">
            מערכת ניהול המוזמנים זמינה רק באופן מקומי.
          </p>
          <p className="mt-2 text-sm text-slate-600 sm:text-base">
            לאישור הגעה יש להיכנס דרך קישור ההזמנה האישי שנשלח בוואטסאפ.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#f9f7f2] via-[#f7f2ea] to-[#f3ece1] px-4 py-6 sm:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <header className="relative mb-6 overflow-hidden rounded-3xl border border-wedding-gold/25 bg-white/90 p-4 shadow-xl backdrop-blur-sm sm:p-6">
          <div className="pointer-events-none absolute -top-16 left-10 h-36 w-36 rounded-full bg-wedding-champagne/40 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-14 right-12 h-32 w-32 rounded-full bg-amber-100/50 blur-2xl" />
          <h1 className="relative text-2xl font-semibold tracking-wide text-wedding-charcoal sm:text-3xl">
            מערכת אישורי הגעה לחתונה
          </h1>
          <p className="mt-2 text-sm text-slate-600 sm:text-base">ניהול אורחים ותזכורות במקום אחד</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                view === 'dashboard'
                  ? 'bg-wedding-charcoal text-wedding-champagne'
                  : 'bg-amber-100 text-amber-900 hover:bg-amber-200'
              }`}
              onClick={() => setView('dashboard')}
              type="button"
            >
              דשבורד הזוג
            </button>
            <button
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                view === 'rsvp'
                  ? 'bg-wedding-charcoal text-wedding-champagne'
                  : 'bg-amber-100 text-amber-900 hover:bg-amber-200'
              }`}
              onClick={() => setView('rsvp')}
              type="button"
            >
              עמוד אישור הגעה
            </button>
          </div>
          {view === 'rsvp' && (
            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="theme-select">
                בחירת עיצוב לעמוד האורחים
              </label>
              <select
                className="w-full max-w-sm rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-wedding-gold focus:outline-none"
                id="theme-select"
                onChange={(event) => setRsvpTheme(event.target.value as RSVPTheme)}
                value={rsvpTheme}
              >
                <option value="floral">פרחוני קלאסי</option>
                <option value="ocean">אוקיינוס אלגנטי</option>
                <option value="classic">שמפניה יוקרתית</option>
              </select>
            </div>
          )}
        </header>

        {view === 'dashboard' ? <Dashboard /> : <RSVP theme={rsvpTheme} />}
      </div>
    </main>
  );
}

export default App;
