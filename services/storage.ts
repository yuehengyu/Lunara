
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
  // START_AT IS REMOVED. Map next_alert_at to the primary time field.
  nextAlertAt: row.next_alert_at,
  endAt: row.end_at,
  isAllDay: row.is_all_day,
  timezone: row.timezone || 'America/Toronto',
  recurrenceRule: row.recurrence_rule,
  reminders: row.reminders || [],
  deviceId: row.device_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// Helper to map App properties to DB columns
const mapToDb = (event: AppEvent) => ({
  id: event.id,
  title: event.title,
  description: event.description,
  // START_AT IS REMOVED. strictly use next_alert_at
  next_alert_at: event.nextAlertAt,
  end_at: event.endAt,
  is_all_day: event.isAllDay,
  timezone: event.timezone,
  recurrence_rule: event.recurrenceRule,
  reminders: event.reminders,
  device_id: event.deviceId,
});

export const fetchEvents = async (deviceId?: string): Promise<AppEvent[]> => {
  if (!supabase) return [];

  let query = supabase
      .from('events')
      .select('*')
      .order('next_alert_at', { ascending: true }); // Order by next alert time directly

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching events:', error);
    return [];
  }

  return data ? data.map(mapFromDb) : [];
};

// Clean up expired one-time events
// Returns the IDs of deleted events so UI can update immediately
export const cleanupPastEvents = async (events: AppEvent[]): Promise<string[]> => {
  if (!supabase) return [];

  // Compare in UTC to be absolute, but based on the event's specific moment
  const now = DateTime.now().toUTC();
  const toDelete: string[] = [];

  events.forEach(e => {
    // Only delete if NO recurrence rule (One-time events)
    if (!e.recurrenceRule || e.recurrenceRule.type === 'none') {

      // Strict parsing of the Next Alert Time
      const eventTime = DateTime.fromISO(e.nextAlertAt).setZone(e.timezone).toUTC();

      if (!eventTime.isValid) return;

      // Delete immediately if 1 minute has passed
      if (eventTime.plus({ minutes: 1 }) < now) {
        toDelete.push(e.id);
      }
    }
  });

  if (toDelete.length > 0) {
    console.log(`[Storage] Identifying ${toDelete.length} past events for deletion.`);
    // Fire and forget the DB delete, but return IDs for UI to update NOW
    supabase.from('events').delete().in('id', toDelete).then(({ error }) => {
      if (error) console.error("DB Auto-delete failed:", error);
    });
    return toDelete;
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

export const saveSubscription = async (deviceId: string, subscription: PushSubscription) => {
  if (!supabase) return;

  await supabase.from('subscriptions').delete().eq('device_id', deviceId);
  const { error } = await supabase.from('subscriptions').insert({
    device_id: deviceId,
    subscription: subscription.toJSON()
  });
  if (error) console.error('Failed to save subscription', error);
};
