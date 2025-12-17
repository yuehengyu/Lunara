
import React, { useState, useEffect, useRef } from 'react';
import { Plus, Bell, Calendar as CalendarIcon, Loader2, X, Radio, Send, RotateCw, Zap, ZapOff, Copy, Info, Github } from 'lucide-react';
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
  const [showDevInfo, setShowDevInfo] = useState(false);

  // Wake Lock State
  const [wakeLock, setWakeLock] = useState<WakeLockSentinel | null>(null);
  const [isStandbyMode, setIsStandbyMode] = useState(false);

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

  // Wake Lock Management
  const toggleStandbyMode = async () => {
    if (!('wakeLock' in navigator)) {
      alert("Wake Lock is not supported on this browser.");
      return;
    }

    try {
      if (wakeLock) {
        await wakeLock.release();
        setWakeLock(null);
        setIsStandbyMode(false);
      } else {
        const sentinel = await navigator.wakeLock.request('screen');
        setWakeLock(sentinel);
        setIsStandbyMode(true);
        sentinel.addEventListener('release', () => {
          setWakeLock(null);
          setIsStandbyMode(false);
        });
      }
    } catch (err: any) {
      console.error(`${err.name}, ${err.message}`);
      alert("Could not activate Standby Mode (Battery Saver might be on)");
    }
  };

  // Re-acquire Wake Lock on visibility change
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && isStandbyMode && !wakeLock) {
        try {
          const sentinel = await navigator.wakeLock.request('screen');
          setWakeLock(sentinel);
        } catch (e) {
          console.error("Failed to re-acquire wake lock", e);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isStandbyMode, wakeLock]);


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
        alert(`Server Scan: ${data.matchedAlerts} alerts upcoming.\n(Use this to check if server-side push works)`);
        if (data.eventsDeleted > 0) {
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

  const handleCopyHost = () => {
    // Copy only the origin, e.g., https://my-app.vercel.app
    const url = window.location.origin;
    navigator.clipboard.writeText(url).then(() => {
      alert(`Copied Project URL: ${url}\n\nNow go to GitHub -> Settings -> Secrets -> Actions -> New Secret\nName: VERCEL_PROJECT_URL\nValue: (Paste this URL)`);
    });
  };

  // MAIN LOOP: Check for updates every 5 seconds
  useEffect(() => {
    const intervalId = window.setInterval(async () => {

      // 1. Check Alarms
      checkNotifications(events, async (event, text) => {
        const key = `${event.id}-${new Date().getMinutes()}`;
        if (!notifiedLog.has(key)) {
          // A. Trigger In-App UI
          setTriggerEvent(event);
          setNotifiedLog(prev => new Set(prev).add(key));

          // B. Trigger System Notification (Works if app is backgrounded but not frozen)
          if (Notification.permission === 'granted' && 'serviceWorker' in navigator) {
            try {
              const registration = await navigator.serviceWorker.ready;
              registration.showNotification(`🔔 ${event.title}`, {
                body: `${text}. ${event.description || ''}`,
                icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🌙</text></svg>',
                tag: key, // Prevent duplicates
                requireInteraction: true,
                vibrate: [200, 100, 200]
              } as any);
            } catch (e) {
              console.error("System notification failed", e);
            }
          }
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
      setEvents(prev => prev.map(e => e.id === event.id ? eventWithMeta : e));
      await updateEvent(eventWithMeta);
      setEditingEvent(null);
    } else {
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

  // Filter and Sort Events
  const displayedEvents = events
      .filter(event => {
        if (activeTab === 'all') return true;
        if (activeTab === 'upcoming') {
          const now = DateTime.now();
          const eventDate = DateTime.fromISO(event.nextAlertAt);
          const diffInDays = eventDate.diff(now, 'days').days;
          return diffInDays >= -0.1 && diffInDays <= 7;
        }
        return true;
      })
      .sort((a, b) => {
        return new Date(a.nextAlertAt).getTime() - new Date(b.nextAlertAt).getTime();
      });

  return (
      <div className={`min-h-screen flex flex-col items-center py-4 px-4 sm:py-8 pb-24 sm:pb-8 font-sans transition-colors duration-500 ${isStandbyMode ? 'bg-black text-slate-200' : 'bg-slate-50 text-slate-900'}`}>
        <AlarmPopup
            event={triggerEvent}
            onClose={() => setTriggerEvent(null)}
            onSnooze={() => setTriggerEvent(null)}
        />

        <header className={`w-full max-w-3xl mb-6 flex justify-between items-center sticky top-0 z-10 py-2 transition-colors ${isStandbyMode ? 'bg-black' : 'bg-slate-50'}`}>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
              <span className="bg-indigo-600 text-white p-1.5 rounded-lg text-lg sm:text-xl shadow-sm">LR</span>
              LunaRemind
            </h1>
            <p className={`text-xs sm:text-sm mt-1 flex items-center gap-2 ${isStandbyMode ? 'text-green-400' : 'text-slate-500'}`}>
              {isStandbyMode ? <><Zap className="w-3 h-3"/> Standby Active (Screen On)</> : (isSupabaseConfigured ? 'Cloud Sync Active' : 'Offline Mode')}
            </p>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Standby Toggle */}
            <button
                onClick={toggleStandbyMode}
                className={`flex items-center gap-1.5 text-xs sm:text-sm px-3 py-2 rounded-full border transition-colors ${
                    isStandbyMode
                        ? 'bg-amber-900/50 text-amber-200 border-amber-800 hover:bg-amber-900'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
                title="Keep screen on (for alarms)"
            >
              {isStandbyMode ? <Zap className="w-4 h-4 text-amber-400 fill-amber-400" /> : <ZapOff className="w-4 h-4" />}
            </button>

            {permission === 'granted' && (
                <>
                  <button
                      onClick={handleTestPush}
                      disabled={isTestingPush}
                      className={`flex items-center gap-1.5 text-xs sm:text-sm px-3 py-2 rounded-full border transition-colors ${isStandbyMode ? 'bg-gray-800 border-gray-700 text-gray-300' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                      title="Test Server Push"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </>
            )}

            <button
                onClick={() => setShowDevInfo(!showDevInfo)}
                className={`flex items-center gap-1.5 text-xs sm:text-sm px-3 py-2 rounded-full border transition-colors ${isStandbyMode ? 'bg-gray-800 border-gray-700 text-gray-300' : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'}`}
                title="Developer Settings"
            >
              <Info className="w-4 h-4" />
            </button>

            {permission !== 'granted' && (
                <button
                    onClick={() => enablePushNotifications(false)}
                    className="flex items-center gap-2 text-xs sm:text-sm text-indigo-600 bg-indigo-50 px-3 py-2 rounded-full hover:bg-indigo-100 transition-colors border border-indigo-200"
                >
                  <Radio className="w-4 h-4" />
                  <span className="hidden sm:inline">Enable Push</span>
                </button>
            )}
          </div>
        </header>

        {showDevInfo && (
            <div className="w-full max-w-3xl mb-4 p-4 bg-slate-100 rounded-xl border border-slate-200 animate-in slide-in-from-top-2">
              <h3 className="font-bold text-slate-700 text-sm mb-2 flex items-center gap-2">
                <Github className="w-4 h-4"/> 1. GitHub Action Setup (One-time)
              </h3>
              <ol className="text-xs text-slate-600 mb-4 list-decimal pl-5 space-y-1">
                <li>Go to your GitHub Repository</li>
                <li>Go to <b>Settings</b> &rarr; <b>Secrets and variables</b> &rarr; <b>Actions</b></li>
                <li>Click <b>New repository secret</b></li>
                <li>Name: <code className="bg-slate-200 px-1 rounded">VERCEL_PROJECT_URL</code></li>
                <li>Value: Your app URL (copy button below)</li>
              </ol>

              <div className="flex gap-2 mb-4">
                <button
                    onClick={handleCopyHost}
                    className="flex items-center gap-1.5 text-xs sm:text-sm px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Copy App URL
                </button>
              </div>

              <h3 className="font-bold text-slate-700 text-sm mb-2 flex items-center gap-2">
                <RotateCw className="w-3 h-3"/> 2. Test Connection
              </h3>
              <div className="flex gap-2">
                <button
                    onClick={handleTriggerDigest}
                    disabled={isCheckingDigest}
                    className="flex items-center gap-1.5 text-xs sm:text-sm px-3 py-2 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 transition-colors"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${isCheckingDigest ? 'animate-spin' : ''}`} />
                  Test Server Scan
                </button>
              </div>
            </div>
        )}

        <main className="w-full max-w-3xl space-y-6">
          <div className={`flex p-1 rounded-xl shadow-sm border transition-colors ${isStandbyMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-slate-100'}`}>
            <button
                onClick={() => setActiveTab('upcoming')}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                    activeTab === 'upcoming'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : (isStandbyMode ? 'text-gray-400 hover:text-gray-200' : 'text-slate-500 hover:text-slate-700')
                }`}
            >
              Upcoming (7 Days)
            </button>
            <button
                onClick={() => setActiveTab('all')}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                    activeTab === 'all'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : (isStandbyMode ? 'text-gray-400 hover:text-gray-200' : 'text-slate-500 hover:text-slate-700')
                }`}
            >
              All Events
            </button>
          </div>

          {isLoading ? (
              <div className="flex flex-col items-center justify-center py-20 opacity-50">
                <Loader2 className="w-8 h-8 animate-spin mb-3 text-indigo-500" />
                <p>Syncing events...</p>
              </div>
          ) : displayedEvents.length === 0 ? (
              <div className={`flex flex-col items-center justify-center py-16 rounded-2xl border border-dashed transition-colors ${isStandbyMode ? 'bg-gray-900 border-gray-700 text-gray-500' : 'bg-white border-slate-200 text-slate-400'}`}>
                <CalendarIcon className="w-12 h-12 mb-3 opacity-50" />
                <p className="text-lg font-medium">
                  {activeTab === 'upcoming' ? 'No upcoming events this week' : 'No events found'}
                </p>
                <p className="text-sm opacity-70">Tap the + button to create one</p>
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

        {showMobileTip && !isStandbyMode && (
            <div className="fixed bottom-24 left-4 right-4 bg-slate-900 text-white text-xs p-3 rounded-lg shadow-lg flex justify-between items-center z-30 sm:hidden opacity-90">
              <span>Tip: Use Standby Mode to ensure alarms ring at night.</span>
              <button onClick={() => setShowMobileTip(false)} className="p-1"><X className="w-4 h-4"/></button>
            </div>
        )}
      </div>
  );
};

export default App;
