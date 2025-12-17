export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly_solar' | 'yearly_lunar' | 'custom';

export interface RecurrenceRule {
  type: RecurrenceType;
  // For 'weekly': [1, 5] means Mon, Fri
  days?: number[];
  // For 'yearly_lunar': { month: 8, day: 15 }
  lunarData?: {
    month: number;
    day: number;
    leap?: boolean;
  };
  // For 'custom': interval details
  interval?: number;
  unit?: 'hour' | 'day' | 'week' | 'month' | 'year';
}

export interface AppEvent {
  id: string;
  title: string;
  description?: string;
  // location field removed as per user request

  // Stored as ISO string with offset (timestamptz in DB)
  startAt: string;
  endAt?: string;
  isAllDay: boolean;

  // IANA Timezone string. UI will restrict to 'Asia/Shanghai' or 'America/Toronto'
  timezone: string;

  recurrenceRule: RecurrenceRule | null;

  // Array of minutes before event to notify
  reminders: number[];

  createdAt: string;
  updatedAt: string;
}

export interface NextOccurrence {
  date: Date; // JS Date object for easy rendering/comparison
  isoString: string;
  displayString: string;
  remainingText: string;
  isToday: boolean;
  originalTimezone: string;
}