import { createClient } from '@supabase/supabase-js';
import { AppEvent } from '../types';

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
  // location removed
  startAt: row.start_at,
  endAt: row.end_at,
  isAllDay: row.is_all_day,
  timezone: row.timezone || 'America/Toronto',
  recurrenceRule: row.recurrence_rule,
  reminders: row.reminders || [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// Helper to map App properties to DB columns
const mapToDb = (event: AppEvent) => ({
  id: event.id,
  title: event.title,
  description: event.description,
  // location removed
  start_at: event.startAt,
  end_at: event.endAt,
  is_all_day: event.isAllDay,
  timezone: event.timezone,
  recurrence_rule: event.recurrenceRule,
  reminders: event.reminders,
});

export const fetchEvents = async (): Promise<AppEvent[]> => {
  if (!supabase) return [];

  const { data, error } = await supabase
      .from('events')
      .select('*')
      .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching events:', error);
    return [];
  }

  return data ? data.map(mapFromDb) : [];
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