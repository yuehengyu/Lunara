
import { createClient } from '@supabase/supabase-js';
import { AppEvent } from '../types';
import { DateTime } from 'luxon';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = (supabaseUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey)
    : null;

export const isSupabaseConfigured = !!supabase;

// Helper to map DB snake_case columns to App camelCase properties
const mapFromDb = (row: any): AppEvent => ({
  id: row.id,
  title: row.title,
  description: row.description,
  startAt: row.start_at,
  endAt: row.end_at,
  isAllDay: row.is_all_day,
  timezone: row.timezone || 'America/Toronto',
  recurrenceRule: row.recurrence_rule,
  reminders: row.reminders || [],
  nextAlertAt: row.next_alert_at,
  deviceId: row.device_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// Helper to map App properties to DB columns
const mapToDb = (event: AppEvent) => ({
  id: event.id,
  title: event.title,
  description: event.description,
  start_at: event.startAt,
  end_at: event.endAt,
  is_all_day: event.isAllDay,
  timezone: event.timezone,
  recurrence_rule: event.recurrenceRule,
  reminders: event.reminders,
  next_alert_at: event.nextAlertAt, // Critical for Cron Job
  device_id: event.deviceId,       // Critical for targeting
});

export const fetchEvents = async (deviceId?: string): Promise<AppEvent[]> => {
  if (!supabase) return [];

  let query = supabase
      .from('events')
      .select('*')
      .order('created_at', { ascending: false });

  // If we have a deviceId, simpler apps might filter by it,
  // but for now we fetch all (shared mode) or you can uncomment below to isolate:
  // if (deviceId) query = query.eq('device_id', deviceId);

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching events:', error);
    return [];
  }

  return data ? data.map(mapFromDb) : [];
};

// NEW: Clean up expired one-time events from the frontend on load
export const cleanupPastEvents = async (events: AppEvent[]) => {
  if (!supabase) return;

  const now = DateTime.now();
  const toDelete: string[] = [];

  events.forEach(e => {
    // If it has NO recurrence rule
    if (!e.recurrenceRule || e.recurrenceRule.type === 'none') {
      const eventTime = DateTime.fromISO(e.startAt, { zone: e.timezone });
      // Reduce buffer to 2 hours
      if (eventTime.plus({ hours: 2 }) < now) {
        toDelete.push(e.id);
      }
    }
  });

  if (toDelete.length > 0) {
    console.log(`Auto-deleting ${toDelete.length} past events...`);
    const { error } = await supabase.from('events').delete().in('id', toDelete);
    if (error) console.error("Auto-delete failed:", error);
    return toDelete; // Return IDs so UI can update state locally
  }
  return [];
};

export const createEvent = async (event: AppEvent) => {
  if (!supabase) return;

  const payload = mapToDb(event);
  const { error } = await supabase
      .from('events')
      .insert(payload);

  if (error) console.error('Error creating event:', error);
};

export const deleteEvent = async (id: string) => {
  if (!supabase) return;

  const { error } = await supabase
      .from('events')
      .delete()
      .eq('id', id);

  if (error) console.error('Error deleting event:', error);
};

export const updateEvent = async (event: AppEvent) => {
  if (!supabase) return;

  const { error } = await supabase
      .from('events')
      .update(mapToDb(event))
      .eq('id', event.id);

  if (error) console.error('Error updating event:', error);
};

// New: Save Push Subscription
export const saveSubscription = async (deviceId: string, subscription: PushSubscription) => {
  if (!supabase) return;

  // Basic upsert logic: delete old for this device, insert new
  // In a real app with Auth, you'd tie this to User ID.
  await supabase.from('subscriptions').delete().eq('device_id', deviceId);

  const { error } = await supabase.from('subscriptions').insert({
    device_id: deviceId,
    subscription: subscription.toJSON()
  });

  if (error) console.error('Failed to save subscription', error);
};
