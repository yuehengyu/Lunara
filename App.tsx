import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Bell, Calendar as CalendarIcon, List, Database, Loader2 } from 'lucide-react';
import { AppEvent } from './types';
import { fetchEvents, createEvent, deleteEvent, updateEvent, isSupabaseConfigured } from './services/storage';
import { checkNotifications, getNextOccurrence, shouldUpdateRecurringEvent } from './services/timeService';
import { EventCard } from './components/EventCard';
import { AddEventModal } from './components/AddEventModal';

const App: React.FC = () => {
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<AppEvent | null>(null); // For Edit Mode
  const [activeTab, setActiveTab] = useState<'upcoming' | 'all'>('upcoming');
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isLoading, setIsLoading] = useState(true);

  const [notifiedLog, setNotifiedLog] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      const data = await fetchEvents();
      setEvents(data);
      setIsLoading(false);
    };

    load();

    if ('Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) {
      alert("This browser does not support desktop notifications");
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
  }, []);

  useEffect(() => {
    const intervalId = setInterval(async () => {
      // 1. Check Notifications
      checkNotifications(events, (event, text) => {
        const key = `${event.id}-${new Date().getMinutes()}`;
        if (!notifiedLog.has(key)) {
          if (permission === 'granted') {
            new Notification(`Reminder: ${event.title}`, {
              body: `${text} - ${event.description || ''}`,
              icon: '/icon.png'
            });
          }
          setNotifiedLog(prev => new Set(prev).add(key));
        }
      });

      // 2. Auto-Reschedule
      let needsRefresh = false;
      const updatedEvents = await Promise.all(events.map(async (event) => {
        const newStartAt = shouldUpdateRecurringEvent(event);
        if (newStartAt) {
          const updatedEvent = { ...event, startAt: newStartAt, updatedAt: new Date().toISOString() };
          await updateEvent(updatedEvent);
          needsRefresh = true;
          return updatedEvent;
        }
        return event;
      }));

      if (needsRefresh) {
        setEvents(updatedEvents);
      }

    }, 10000);

    return () => clearInterval(intervalId);
  }, [events, permission, notifiedLog]);

  const handleSaveEvent = async (event: AppEvent) => {
    if (editingEvent) {
      // Update existing
      setEvents(prev => prev.map(e => e.id === event.id ? event : e));
      await updateEvent(event);
      setEditingEvent(null);
    } else {
      // Create new
      setEvents(prev => [...prev, event]);
      await createEvent(event);
    }
    setIsModalOpen(false);
  };

  const handleEditClick = (event: AppEvent) => {
    setEditingEvent(event);
    setIsModalOpen(true);
  };

  const handleDeleteEvent = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this event?")) {
      setEvents(prev => prev.filter(e => e.id !== id));
      await deleteEvent(id);
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingEvent(null);
  };

  // Sort logic
  const displayedEvents = [...events].sort((a, b) => {
    if (activeTab === 'all') {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
    const nextA = getNextOccurrence(a).date.getTime();
    const nextB = getNextOccurrence(b).date.getTime();
    return nextA - nextB;
  });

  return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center py-4 px-4 sm:py-8 pb-24 sm:pb-8">
        <header className="w-full max-w-3xl mb-6 flex justify-between items-center sticky top-0 bg-slate-50 z-10 py-2">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <span className="bg-indigo-600 text-white p-1.5 rounded-lg text-lg sm:text-xl shadow-sm">LR</span>
              LunaRemind
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">Global events, Lunar aware.</p>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {permission !== 'granted' && (
                <button
                    onClick={requestPermission}
                    className="flex items-center gap-2 text-xs sm:text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded-full hover:bg-amber-100 transition-colors"
                >
                  <Bell className="w-4 h-4" />
                  <span className="hidden sm:inline">Enable Alerts</span>
                </button>
            )}

            <button
                onClick={() => { setEditingEvent(null); setIsModalOpen(true); }}
                className="hidden sm:flex bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg shadow-md shadow-indigo-200 transition-all items-center gap-2 font-medium"
            >
              <Plus className="w-5 h-5" />
              New Event
            </button>
          </div>
        </header>

        <main className="w-full max-w-3xl">
          {!isSupabaseConfigured && (
              <div className="mb-6 bg-orange-50 border border-orange-200 rounded-lg p-4 flex gap-3 text-orange-800 text-sm items-start">
                <Database className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Database Connection Missing</p>
                  <p className="mt-1">Please connect to Supabase (Free) to save your events permanently.</p>
                  <p className="mt-2 text-xs opacity-75">Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your Vercel Environment Variables.</p>
                </div>
              </div>
          )}

          <div className="flex gap-6 mb-4 sm:mb-6 border-b border-slate-200 sticky top-16 bg-slate-50 z-10 pt-2">
            <button
                onClick={() => setActiveTab('upcoming')}
                className={`pb-3 px-1 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors ${activeTab === 'upcoming' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              <CalendarIcon className="w-4 h-4" />
              Upcoming
            </button>
            <button
                onClick={() => setActiveTab('all')}
                className={`pb-3 px-1 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors ${activeTab === 'all' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              <List className="w-4 h-4" />
              All Events
            </button>
          </div>

          {isLoading ? (
              <div className="py-20 flex flex-col items-center text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin mb-3 text-indigo-500" />
                <p className="text-sm">Syncing with cloud...</p>
              </div>
          ) : events.length === 0 ? (
              <div className="text-center py-16 sm:py-20 bg-white rounded-2xl border border-slate-100 border-dashed mx-2 sm:mx-0">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                  <Bell className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-medium text-slate-900">No events yet</h3>
                <p className="text-slate-500 mt-1 max-w-xs mx-auto px-4">Create your first event manually.</p>
                <button
                    onClick={() => { setEditingEvent(null); setIsModalOpen(true); }}
                    className="mt-4 text-indigo-600 font-medium hover:text-indigo-700 bg-indigo-50 px-4 py-2 rounded-lg transition-colors"
                >
                  Create Event
                </button>
              </div>
          ) : (
              <div className="grid gap-4">
                {displayedEvents.map(event => (
                    <EventCard
                        key={event.id}
                        event={event}
                        onDelete={handleDeleteEvent}
                        onEdit={handleEditClick}
                    />
                ))}
              </div>
          )}
        </main>

        <button
            onClick={() => { setEditingEvent(null); setIsModalOpen(true); }}
            className="fixed bottom-6 right-6 sm:hidden bg-indigo-600 text-white p-4 rounded-full shadow-lg shadow-indigo-300 hover:bg-indigo-700 active:scale-95 transition-all z-20"
            aria-label="Add Event"
        >
          <Plus className="w-6 h-6" />
        </button>

        <AddEventModal
            isOpen={isModalOpen}
            onClose={handleCloseModal}
            onSave={handleSaveEvent}
            initialEvent={editingEvent}
        />
      </div>
  );
};

export default App;