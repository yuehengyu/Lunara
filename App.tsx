
import React, { useState, useEffect } from 'react';
import { Plus, Bell, Calendar as CalendarIcon, Loader2, X, Radio, Send, RotateCw } from 'lucide-react';
import { AppEvent } from './types';
import { fetchEvents, createEvent, deleteEvent, updateEvent, isSupabaseConfigured, saveSubscription, cleanupPastEvents } from './services/storage';
import { checkNotifications, getNextOccurrence, shouldUpdateRecurringEvent } from './services/timeService';
import { EventCard } from './components/EventCard';
import { AddEventModal } from './components/AddEventModal';
import { AlarmPopup } from './components/AlarmPopup';
import { DateTime } from 'luxon';

// Helper for VAPID key conversion
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const VAPID_PUBLIC_KEY = 'BDS748jbOSm0hDpwy9IHva9edOidWJHtD-Z9WT2KmKW0bsu0YcHD1dKYjJIg_WkIn1ZtvlLnTaNz_b-zWGZoH0E';

const App: React.FC = () => {
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<AppEvent | null>(null);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'all'>('upcoming');
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isLoading, setIsLoading] = useState(true);
  const [showMobileTip, setShowMobileTip] = useState(true);
  const [deviceId, setDeviceId] = useState<string>('');
  const [isTestingPush, setIsTestingPush] = useState(false);
  const [isCheckingDigest, setIsCheckingDigest] = useState(false);

  const [triggerEvent, setTriggerEvent] = useState<AppEvent | null>(null);
  const [notifiedLog, setNotifiedLog] = useState<Set<string>>(new Set());

  // Initialize Device ID
  useEffect(() => {
    let storedId = localStorage.getItem('luna_device_id');
    if (!storedId) {
      storedId = crypto.randomUUID();
      localStorage.setItem('luna_device_id', storedId);
    }
    setDeviceId(storedId);
  }, []);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      const data = await fetchEvents(deviceId);

      // Initial Cleanup on Load
      if (data.length > 0) {
        const deletedIds = await cleanupPastEvents(data);
        if (deletedIds && deletedIds.length > 0) {
          setEvents(data.filter(e => !deletedIds.includes(e.id)));
        } else {
          setEvents(data);
        }
      } else {
        setEvents([]);
      }
      setIsLoading(false);
    };

    if (isSupabaseConfigured) {
      load();
    } else {
      setIsLoading(false);
    }

    if ('Notification' in window) {
      setPermission(Notification.permission);
    }
  }, [deviceId]);

  // Push Subscription Logic
  useEffect(() => {
    const validateAndFixSubscription = async () => {
      if (permission === 'granted' && 'serviceWorker' in navigator && deviceId) {
        try {
          const registration = await navigator.serviceWorker.ready;
          const sub = await registration.pushManager.getSubscription();
          if (sub && sub.options.applicationServerKey) {
            const currentKey = arrayBufferToBase64(sub.options.applicationServerKey);
            if (currentKey !== VAPID_PUBLIC_KEY) {
              await enablePushNotifications(true);
            }
          }
        } catch (e) {
          console.error("Auto-fix check failed", e);
        }
      }
    };
    setTimeout(validateAndFixSubscription, 1000);
  }, [permission, deviceId]);

  const enablePushNotifications = async (forceReset = false) => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      alert("Push notifications are not supported on this browser.");
      return;
    }

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);

      if (perm === 'granted') {
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();

        if (forceReset && subscription) {
          await subscription.unsubscribe();
          subscription = null;
        }

        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
          });
        }

        await saveSubscription(deviceId, subscription);
      }
    } catch (error) {
      console.error("Push subscription failed", error);
    }
  };

  const handleTestPush = async () => {
    if (permission !== 'granted') return;
    setIsTestingPush(true);
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await saveSubscription(deviceId, subscription);
        } else {
          await enablePushNotifications(false);
        }
      }

      const res = await fetch('/api/test-push', {
        method: 'POST',
        body: JSON.stringify({ deviceId }),
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 403 || res.status === 404 || (data.error && data.error.includes("expired"))) {
          await enablePushNotifications(true);
          alert("Resynced keys. Try again.");
          return;
        }
        throw new Error(data.error);
      }
      alert("Sent!");
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsTestingPush(false);
    }
  };

  const handleTriggerDigest = async () => {
    setIsCheckingDigest(true);
    try {
      const res = await fetch('/api/trigger-digest', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert(`Found ${data.matchedAlerts} alerts for tomorrow.`);
        if (data.eventsDeleted > 0) {
          // Re-fetch to sync state if backend deleted things
          const newData = await fetchEvents(deviceId);
          setEvents(newData);
        }
      }
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsCheckingDigest(false);
    }
  };

  // MAIN LOOP: Check for updates every 5 seconds
  useEffect(() => {
    const intervalId = window.setInterval(async () => {

      // 1. Check Alarms
      checkNotifications(events, (event, text) => {
        const key = `${event.id}-${new Date().getMinutes()}`;
        if (!notifiedLog.has(key)) {
          setTriggerEvent(event);
          setNotifiedLog(prev => new Set(prev).add(key));
        }
      });

      // 2. IMMEDIATE UI CLEANUP: Remove past one-time events
      const deletedIds = await cleanupPastEvents(events);
      if (deletedIds.length > 0) {
        // Immediately update UI state to remove them
        setEvents(prev => prev.filter(e => !deletedIds.includes(e.id)));
      }

      // 3. Update Recurring Events (move nextAlertAt forward)
      let needsRefresh = false;
      const updatedEvents = await Promise.all(events.map(async (event) => {
        // Skip if this event was just marked for deletion
        if (deletedIds.includes(event.id)) return event;

        const newNextAlertAt = shouldUpdateRecurringEvent(event);
        if (newNextAlertAt) {
          const updatedEvent: AppEvent = {
            ...event,
            nextAlertAt: newNextAlertAt,
            updatedAt: new Date().toISOString()
          };

          await updateEvent(updatedEvent);
          needsRefresh = true;
          return updatedEvent;
        }
        return event;
      }));

      if (needsRefresh) {
        setEvents(updatedEvents);
      }
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [events, permission, notifiedLog]);

  const handleSaveEvent = async (event: AppEvent) => {
    // Add Device ID
    const eventWithMeta: AppEvent = {
      ...event,
      deviceId
    };

    if (editingEvent) {
      // Optimistic Update
      setEvents(prev => prev.map(e => e.id === event.id ? eventWithMeta : e));
      await updateEvent(eventWithMeta);
      setEditingEvent(null);
    } else {
      // Optimistic Update
      setEvents(prev => [...prev, eventWithMeta]);
      await createEvent(eventWithMeta);
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

  const displayedEvents = [...events].sort((a, b) => {
    return new Date(a.nextAlertAt).getTime() - new Date(b.nextAlertAt).getTime();
  });

  return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center py-4 px-4 sm:py-8 pb-24 sm:pb-8 font-sans">
        <AlarmPopup
            event={triggerEvent}
            onClose={() => setTriggerEvent(null)}
            onSnooze={() => setTriggerEvent(null)}
        />

        <header className="w-full max-w-3xl mb-6 flex justify-between items-center sticky top-0 bg-slate-50 z-10 py-2">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <span className="bg-indigo-600 text-white p-1.5 rounded-lg text-lg sm:text-xl shadow-sm">LR</span>
              LunaRemind
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              {isSupabaseConfigured ? 'Cloud Sync Active' : 'Offline Mode'}
            </p>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {permission === 'granted' && (
                <>
                  <button
                      onClick={handleTestPush}
                      disabled={isTestingPush}
                      className="flex items-center gap-1.5 text-xs sm:text-sm text-slate-600 bg-white px-3 py-2 rounded-full hover:bg-slate-50 border border-slate-200 transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>

                  <button
                      onClick={handleTriggerDigest}
                      disabled={isCheckingDigest}
                      className="flex items-center gap-1.5 text-xs sm:text-sm text-indigo-700 bg-indigo-50 px-3 py-2 rounded-full hover:bg-indigo-100 border border-indigo-200 transition-colors"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${isCheckingDigest ? 'animate-spin' : ''}`} />
                  </button>
                </>
            )}

            {permission !== 'granted' ? (
                <button
                    onClick={() => enablePushNotifications(false)}
                    className="flex items-center gap-2 text-xs sm:text-sm text-indigo-600 bg-indigo-50 px-3 py-2 rounded-full hover:bg-indigo-100 transition-colors border border-indigo-200"
                >
                  <Radio className="w-4 h-4" />
                  <span className="hidden sm:inline">Enable Push</span>
                </button>
            ) : (
                <div className="text-xs text-green-600 font-medium bg-green-50 px-2 py-1 rounded-md border border-green-100 flex items-center gap-1">
                  <Bell className="w-3 h-3" /> On
                </div>
            )}
          </div>
        </header>

        <main className="w-full max-w-3xl space-y-6">
          <div className="flex p-1 bg-white rounded-xl shadow-sm border border-slate-100">
            <button
                onClick={() => setActiveTab('upcoming')}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === 'upcoming' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Upcoming
            </button>
            <button
                onClick={() => setActiveTab('all')}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === 'all' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              All Events
            </button>
          </div>

          {isLoading ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin mb-3 text-indigo-500" />
                <p>Syncing events...</p>
              </div>
          ) : displayedEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200">
                <CalendarIcon className="w-12 h-12 mb-3 text-slate-200" />
                <p className="text-lg font-medium text-slate-600">No events found</p>
                <p className="text-sm">Tap the + button to create one</p>
              </div>
          ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {displayedEvents.map(event => (
                    <EventCard
                        key={event.id}
                        event={event}
                        onEdit={handleEditClick}
                        onDelete={handleDeleteEvent}
                    />
                ))}
              </div>
          )}
        </main>

        <button
            onClick={() => {
              setEditingEvent(null);
              setIsModalOpen(true);
            }}
            className="fixed bottom-6 right-6 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full p-4 shadow-xl shadow-indigo-300 transition-transform active:scale-90 z-40 flex items-center gap-2"
            aria-label="Add Event"
        >
          <Plus className="w-6 h-6" />
          <span className="font-medium pr-1 hidden sm:inline">New Event</span>
        </button>

        <AddEventModal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            onSave={handleSaveEvent}
            initialEvent={editingEvent}
        />

        {showMobileTip && (
            <div className="fixed bottom-24 left-4 right-4 bg-slate-900 text-white text-xs p-3 rounded-lg shadow-lg flex justify-between items-center z-30 sm:hidden opacity-90">
              <span>Tip: Add to Home Screen for the best experience.</span>
              <button onClick={() => setShowMobileTip(false)} className="p-1"><X className="w-4 h-4"/></button>
            </div>
        )}
      </div>
  );
};

export default App;
