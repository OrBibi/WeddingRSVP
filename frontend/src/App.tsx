import { useState } from 'react';
import Dashboard from './components/Dashboard';
import RSVP from './components/RSVP';

type View = 'dashboard' | 'rsvp';

function App() {
  const [view, setView] = useState<View>('dashboard');

  return (
    <main className="min-h-screen bg-stone-100 px-4 py-6 sm:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-6 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
          <h1 className="text-2xl font-semibold text-slate-800 sm:text-3xl">מערכת אישורי הגעה לחתונה</h1>
          <p className="mt-2 text-sm text-slate-600 sm:text-base">ניהול אורחים ותזכורות במקום אחד</p>
          <div className="mt-4 flex gap-2">
            <button
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                view === 'dashboard'
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
              }`}
              onClick={() => setView('dashboard')}
              type="button"
            >
              דשבורד הזוג
            </button>
            <button
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                view === 'rsvp'
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
              }`}
              onClick={() => setView('rsvp')}
              type="button"
            >
              עמוד אישור הגעה
            </button>
          </div>
        </header>

        {view === 'dashboard' ? <Dashboard /> : <RSVP />}
      </div>
    </main>
  );
}

export default App;
