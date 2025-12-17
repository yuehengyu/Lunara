import { AppEvent, NextOccurrence } from '../types';
import { Lunar } from 'lunar-javascript';
import { DateTime } from 'luxon';

/**
 * Calculates the next occurrence of an event based on its recurrence rule and timezone.
 * Returns a detailed NextOccurrence object.
 */
export const getNextOccurrence = (event: AppEvent): NextOccurrence => {
  const now = DateTime.now(); // Local system time

  // 1. Parse the original start time in its ORIGINAL timezone
  const startDt = DateTime.fromISO(event.startAt, { zone: event.timezone });

  let targetDt = startDt;

  // If the event has no recurrence, the target is just the start time
  if (!event.recurrenceRule || event.recurrenceRule.type === 'none') {
    // targetDt remains startDt
  } else {
    // If start date is in the future, that's the next occurrence.
    // If in past, calculate next based on rule.
    if (startDt < now) {
      targetDt = calculateRecurringDate(startDt, event.recurrenceRule, now, event.timezone);
    }
  }

  // Calculate formatted strings for UI
  const diff = targetDt.diff(now, ['days', 'hours', 'minutes']).toObject();
  let remainingText = '';

  if (targetDt < now) {
    remainingText = 'Past';
  } else if (diff.days && diff.days > 0) {
    remainingText = `in ${Math.ceil(diff.days)} days`;
  } else if (diff.hours && diff.hours > 0) {
    remainingText = `in ${Math.ceil(diff.hours)} hours`;
  } else if (diff.minutes && diff.minutes > 0) {
    remainingText = `in ${Math.ceil(diff.minutes)} mins`;
  } else {
    remainingText = 'Soon';
  }

  return {
    date: targetDt.toJSDate(),
    isoString: targetDt.toISO() || '',
    displayString: targetDt.setZone('system').toLocaleString(DateTime.DATETIME_MED), // Convert to user's local time for display
    remainingText,
    isToday: targetDt.hasSame(now, 'day'),
    originalTimezone: event.timezone
  };
};

const calculateRecurringDate = (start: DateTime, rule: any, now: DateTime, timezone: string): DateTime => {
  if (rule.type === 'yearly_lunar' && rule.lunarData) {
    return calculateNextLunarDate(rule.lunarData, start, now, timezone);
  }

  let currentCandidate = start;
  let safetyCounter = 0;

  // Standard Solar Recurrences
  // Loop until we find a date that is effectively "in the future" relative to NOW.
  while (currentCandidate < now && safetyCounter < 2000) {
    safetyCounter++;

    switch (rule.type) {
      case 'daily':
        currentCandidate = currentCandidate.plus({ days: 1 });
        break;
      case 'weekly':
        currentCandidate = currentCandidate.plus({ weeks: 1 });
        break;
      case 'monthly':
        currentCandidate = currentCandidate.plus({ months: 1 });
        break;
      case 'yearly_solar':
        currentCandidate = currentCandidate.plus({ years: 1 });
        break;
      case 'custom':
        if (rule.interval && rule.unit) {
          const amount = rule.interval;
          switch (rule.unit) {
            case 'hour': currentCandidate = currentCandidate.plus({ hours: amount }); break;
            case 'day': currentCandidate = currentCandidate.plus({ days: amount }); break;
            case 'week': currentCandidate = currentCandidate.plus({ weeks: amount }); break;
            case 'month': currentCandidate = currentCandidate.plus({ months: amount }); break;
            case 'year': currentCandidate = currentCandidate.plus({ years: amount }); break;
          }
        } else {
          // Fallback if data is missing
          return start;
        }
        break;
      default:
        return start;
    }
  }

  return currentCandidate;
};

const calculateNextLunarDate = (lunarData: {month: number, day: number}, originalStart: DateTime, now: DateTime, timezone: string): DateTime => {
  let searchYear = now.setZone(timezone).year;

  // Try current year and next 2 years to find the next occurrence
  for (let i = 0; i < 3; i++) {
    const y = searchYear + i;
    try {
      const lunar = Lunar.fromYmd(y, lunarData.month, lunarData.day);
      const solar = lunar.getSolar();

      const candidate = DateTime.fromObject({
        year: solar.getYear(),
        month: solar.getMonth(),
        day: solar.getDay(),
        hour: originalStart.hour,
        minute: originalStart.minute,
        second: 0
      }, { zone: timezone });

      if (candidate > now) {
        return candidate;
      }
    } catch (e) {
      // Lunar date might not exist in that specific year (e.g. leap month issues), skip
    }
  }
  return originalStart;
};

// Check for active notifications (Browser Notifications)
export const checkNotifications = (events: AppEvent[], notifyCallback: (event: AppEvent, title: string) => void) => {
  const now = DateTime.now();

  events.forEach(event => {
    const nextOccurrence = getNextOccurrence(event);
    const nextDt = DateTime.fromJSDate(nextOccurrence.date);

    if (event.reminders && event.reminders.length > 0) {
      event.reminders.forEach(minutesBefore => {
        const notifyTime = nextDt.minus({ minutes: minutesBefore });
        const diff = Math.abs(now.diff(notifyTime, 'seconds').seconds);

        if (diff < 15) { // 15 second window
          let reminderText = "Happening now!";
          if (minutesBefore > 0) {
            if (minutesBefore >= 1440) reminderText = `in ${Math.ceil(minutesBefore/1440)} days`;
            else if (minutesBefore >= 60) reminderText = `in ${Math.ceil(minutesBefore/60)} hours`;
            else reminderText = `in ${minutesBefore} minutes`;
          }
          notifyCallback(event, reminderText);
        }
      });
    }
  });
};

export const shouldUpdateRecurringEvent = (event: AppEvent): string | null => {
  if (!event.recurrenceRule || event.recurrenceRule.type === 'none') return null;

  const now = DateTime.now();
  const startDt = DateTime.fromISO(event.startAt, { zone: event.timezone });

  const bufferMinutes = 1;
  if (startDt.plus({ minutes: bufferMinutes }) < now) {
    const nextOccurrence = getNextOccurrence(event);
    if (nextOccurrence.isoString !== event.startAt) {
      return nextOccurrence.isoString;
    }
  }
  return null;
};