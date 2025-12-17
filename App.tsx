
import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Bell, Calendar as CalendarIcon, List, Database, Loader2, Info, X, Radio, Send, RotateCw, RefreshCw } from 'lucide-react';
import { AppEvent } from './types';
import { fetchEvents, createEvent, deleteEvent, updateEvent, isSupabaseConfigured, saveSubscription, cleanupPastEvents } from './services/storage';
import { checkNotifications, getNextOccurrence, shouldUpdateRecurringEvent } from './services/timeService';
import { EventCard } from './components/EventCard';
import { AddEventModal } from './components/AddEventModal';
import { AlarmPopup } from './components/AlarmPopup';

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
  // Convert standard Base64 to URL-Safe Base64 to match VAPID convention
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// HARDCODED PUBLIC KEY (Must match the Private Key in Backend)
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
      setEvents(data);
      setIsLoading(false);

      // Auto-Cleanup Trigger
      if (data.length > 0) {
        const deletedIds = await cleanupPastEvents(data);
        if (deletedIds && deletedIds.length > 0) {
          setEvents(prev => prev.filter(e => !deletedIds.includes(e.id)));
        }
      }
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

  // AUTO-FIX: On mount, check if current subscription matches hardcoded key. If not, re-subscribe.
  useEffect(() => {
    const validateAndFixSubscription = async () => {
      if (permission === 'granted' && 'serviceWorker' in navigator && deviceId) {
        try {
          const registration = await navigator.serviceWorker.ready;
          const sub = await registration.pushManager.getSubscription();
          if (sub && sub.options.applicationServerKey) {
            const currentKey = arrayBufferToBase64(sub.options.applicationServerKey);
            if (currentKey !== VAPID_PUBLIC_KEY) {
              console.log("Key mismatch detected. Current:", currentKey, "Expected:", VAPID_PUBLIC_KEY);
              // Silent upgrade
              await enablePushNotifications(true);
            }
          }
        } catch (e) {
          console.error("Auto-fix check failed", e);
        }
      }
    };
    // Small delay to ensure browser ready
    setTimeout(validateAndFixSubscription, 1000);
  }, [permission, deviceId]);

  // Request Notification & Subscribe to Push
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

        // If forcing reset (e.g. keys changed), unsubscribe first
        if (forceReset && subscription) {
          console.log("Unsubscribing old subscription...");
          await subscription.unsubscribe();
          subscription = null;
        }

        if (!subscription) {
          console.log("Creating new subscription with current key...");
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
          });
        }

        // Save to Supabase
        await saveSubscription(deviceId, subscription);

        if (forceReset) {
          console.log("Push reset complete.");
        }
      }
    } catch (error) {
      console.error("Push subscription failed", error);
      alert("Failed to enable push notifications. Check console for details.");
    }
  };

  const handleTestPush = async () => {
    if (permission !== 'granted') {
      alert("Please enable push notifications first.");
      return;
    }
    setIsTestingPush(true);
    try {
      // Force sync first
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

      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await res.text();
        throw new Error(`Server returned non-JSON response (${res.status}). Response: ${text.slice(0, 100)}`);
      }

      const data = await res.json();

      if (!res.ok) {
        // AUTO-HEALING
        if (res.status === 403 || res.status === 404 || (data.error && data.error.includes("expired"))) {
          console.warn("Detected invalid subscription (403/404). Auto-healing...");
          await enablePushNotifications(true);
          alert("Your push configuration was outdated and has been reset. Please click Test again!");
          setIsTestingPush(false);
          return;
        }
        throw new Error(data.error || `Server Error ${res.status}`);
      }

      if (data.success) {
        alert("Test notification sent! Check your notification center.");
      } else {
        alert("Failed to send test: " + (data.error || 'Unknown error'));
      }
    } catch (e: any) {
      console.error(e);
      alert(`Error: ${e.message}`);
    } finally {
      setIsTestingPush(false);
    }
  };

  const handleTriggerDigest = async () => {
    if (permission !== 'granted') {
      alert("Please enable push notifications first.");
      return;
    }
    setIsCheckingDigest(true);
    try {
      const res = await fetch('/api/trigger-digest', {
        method: 'POST',
      });

      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await res.text();
        throw new Error(`Server Error. Response: ${text.slice(0, 100)}...`);
      }

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Server Error ${res.status}`);
      }

      if (data.success) {
        let msg = `Check complete.`;
        if (data.eventsFound > 0) msg += ` Scanned ${data.eventsFound} events.`;
        if (data.eventsDeleted > 0) msg += ` Cleaned up ${data.eventsDeleted} past events.`;
        if (data.matchedAlerts > 0) msg += ` Found ${data.matchedAlerts} relevant alerts.`;
        else msg += ` No alerts for tomorrow.`;

        alert(msg);
      } else {
        alert("Check completed: " + (data.message || data.error));
      }
    } catch (e: any) {
      console.error(e);
      alert(`Error Triggering Check: ${e.message}`);
    } finally {
      setIsCheckingDigest(false);
    }
  };

  // Local Polling
  useEffect(() => {
    const intervalId = window.setInterval(async () => {
      // 1. Check Foreground Notifications
      checkNotifications(events, (event, text) => {
        const key = `${event.id}-${new Date().getMinutes()}`;
        if (!notifiedLog.has(key)) {
          setTriggerEvent(event);
          setNotifiedLog(prev => new Set(prev).add(key));
        }
      });

      // 2. Auto-update recurring events
      let needsRefresh = false;
      const updatedEvents = await Promise.all(events.map(async (event) => {
        const newStartAt = shouldUpdateRecurringEvent(event);
        if (newStartAt) {
          const tempEvent = { ...event, startAt: newStartAt };
          const nextOcc = getNextOccurrence(tempEvent);

          const updatedEvent: AppEvent = {
            ...event,
            startAt: newStartAt,
            nextAlertAt: nextOcc.isoString,
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
    const nextOcc = getNextOccurrence(event);

    const eventWithMeta: AppEvent = {
      ...event,
      deviceId,
      nextAlertAt: nextOcc.isoString
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
            {/* Test & Actions */}
            {permission === 'granted' && (
                <>
                  <button
                      onClick={handleTestPush}
                      disabled={isTestingPush}
                      className="flex items-center gap-1.5 text-xs sm:text-sm text-slate-600 bg-white px-3 py-2 rounded-full hover:bg-slate-50 border border-slate-200 transition-colors"
                      title="Send a sample notification now"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{isTestingPush ? 'Sending...' : 'Test'}</span>
                  </button>

                  <button
                      onClick={handleTriggerDigest}
                      disabled={isCheckingDigest}
                      className="flex items-center gap-1.5 text-xs sm:text-sm text-indigo-700 bg-indigo-50 px-3 py-2 rounded-full hover:bg-indigo-100 border border-indigo-200 transition-colors"
                      title="Check for upcoming events now"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${isCheckingDigest ? 'animate-spin' : ''}`} />
                    <span className="hidden sm:inline">{isCheckingDigest ? 'Check' : 'Check'}</span>
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
                // Hidden Reset Button (Only shows if permission granted)
                <button
                    onClick={() => enablePushNotifications(true)}
                    className="flex items-center justify-center p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
                    title="Reset Push Connection"
                >
                  <RefreshCw className="w-4 h-4" />
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
                  <p className="mt-1">Backend push requires Supabase connection.</p>
                </div>
              </div>
          )}

          {showMobileTip && (
              <div className="mb-4 bg-blue-50 border border-blue-100 rounded-lg p-3 sm:p-4 flex gap-3 text-blue-800 relative">
                <Info className="w-5 h-5 shrink-0 mt-0.5 text-blue-600" />
                <div className="pr-4">
                  <p className="text-sm font-semibold">Real Push Notifications</p>
                  <p className="text-xs sm:text-sm mt-1 text-blue-700/80">
                    Click "Enable Push" to receive notifications even when the app is closed. If you have issues, try clicking the small refresh icon top right.
                  </p>
                </div>
                <button
                    onClick={() => setShowMobileTip(false)}
                    className="absolute top-2 right-2 text-blue-400 hover:text-blue-600 p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
          )}

          {/* Existing List UI ... */}
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
                <button
                    onClick={() => { setEditingEvent(null); setIsModalOpen(true); }}
                    className="mt-4 text-indigo-600 font-medium hover:text-indigo-700 bg-indigo-50 px-4 py-2 rounded-lg transition-colors"
                >
                  New Event
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
            onClose={() => { setIsModalOpen(false); setEditingEvent(null); }}
            onSave={handleSaveEvent}
            initialEvent={editingEvent}
        />
      </div>
  );
};

export default App;
