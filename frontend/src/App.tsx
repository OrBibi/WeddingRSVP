import { useEffect, useMemo, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import Dashboard from './components/Dashboard';
import RSVP from './components/RSVP';
import { bootstrapAuth, setApiAuthToken } from './api';
import { firebaseAuth } from './firebase';

type View = 'dashboard' | 'rsvp';
export type RSVPTheme = 'floral' | 'ocean' | 'classic';

function App() {
  const isPublicRsvpRoute = useMemo(() => /^\/rsvp\/[^/]+\/[^/]+/.test(window.location.pathname), []);
  const [view, setView] = useState<View>('dashboard');
  const [rsvpTheme, setRsvpTheme] = useState<RSVPTheme>('floral');
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(!isPublicRsvpRoute);
  const [authError, setAuthError] = useState('');
  const [authForm, setAuthForm] = useState({ email: '', password: '' });
  const [registerMode, setRegisterMode] = useState(false);

  useEffect(() => {
    if (isPublicRsvpRoute) {
      return;
    }
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (currentUser) => {
      if (!currentUser) {
        setUser(null);
        setApiAuthToken(null);
        setAuthLoading(false);
        return;
      }

      const token = await currentUser.getIdToken();
      setApiAuthToken(token);
      await bootstrapAuth();
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, [isPublicRsvpRoute]);

  const submitAuth = async () => {
    setAuthError('');
    try {
      if (registerMode) {
        await createUserWithEmailAndPassword(
          firebaseAuth,
          authForm.email.trim(),
          authForm.password
        );
      } else {
        await signInWithEmailAndPassword(firebaseAuth, authForm.email.trim(), authForm.password);
      }
    } catch {
      setAuthError('התחברות נכשלה. בדקו אימייל/סיסמה ונסו שוב.');
    }
  };

  const logout = async () => {
    await signOut(firebaseAuth);
    setUser(null);
    setApiAuthToken(null);
  };

  if (isPublicRsvpRoute) {
    return <RSVP theme={rsvpTheme} />;
  }

  if (authLoading) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-[#f9f7f2] via-[#f7f2ea] to-[#f3ece1] px-4 py-6 sm:px-8">
        <div className="mx-auto max-w-md rounded-3xl border border-wedding-gold/25 bg-white/90 p-6 text-center shadow-xl">
          טוען...
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-[#f9f7f2] via-[#f7f2ea] to-[#f3ece1] px-4 py-6 sm:px-8">
        <div className="mx-auto max-w-md rounded-3xl border border-wedding-gold/25 bg-white/90 p-6 shadow-xl">
          <h1 className="text-2xl font-semibold text-wedding-charcoal">כניסה למערכת הזוג</h1>
          <p className="mt-2 text-sm text-slate-600">כל זוג מנהל חתונה משלו עם רשימת אורחים נפרדת</p>
          <div className="mt-5 space-y-3">
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
              onChange={(event) => setAuthForm((curr) => ({ ...curr, email: event.target.value }))}
              placeholder="אימייל"
              type="email"
              value={authForm.email}
            />
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
              onChange={(event) => setAuthForm((curr) => ({ ...curr, password: event.target.value }))}
              placeholder="סיסמה"
              type="password"
              value={authForm.password}
            />
            <button
              className="w-full rounded-lg bg-wedding-charcoal px-4 py-2 text-sm font-medium text-wedding-champagne transition hover:bg-slate-900"
              onClick={() => void submitAuth()}
              type="button"
            >
              {registerMode ? 'הרשמה' : 'התחברות'}
            </button>
            <button
              className="w-full rounded-lg border border-amber-200 bg-white px-4 py-2 text-sm text-amber-900 transition hover:bg-amber-50"
              onClick={() => setRegisterMode((curr) => !curr)}
              type="button"
            >
              {registerMode ? 'יש לי חשבון - להתחברות' : 'אין לי חשבון - להרשמה'}
            </button>
            {authError && <p className="text-sm text-rose-700">{authError}</p>}
          </div>
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
            <button
              className="rounded-full bg-rose-100 px-4 py-2 text-sm font-medium text-rose-900 transition hover:bg-rose-200"
              onClick={() => void logout()}
              type="button"
            >
              התנתק
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
