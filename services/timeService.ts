
import { AppEvent, NextOccurrence } from '../types';
import { Lunar } from 'lunar-javascript';
import { DateTime } from 'luxon';

/**
 * Calculates the display details for the event.
 * Since we now only store 'nextAlertAt', this is mostly formatting.
 */
export const getNextOccurrence = (event: AppEvent): NextOccurrence => {
  const now = DateTime.now();

  // The DB stores the absolute correct next time. Trust it.
  const targetDt = DateTime.fromISO(event.nextAlertAt).setZone(event.timezone);

  // Calculate formatted strings for UI
  const diff = targetDt.diff(now, ['days', 'hours', 'minutes']).toObject();
  let remainingText = '';

  // Add a small buffer (e.g., -1 minute) to allow "Now" to show before "Past"
  if (targetDt < now.minus({ minutes: 1 })) {
    remainingText = 'Past';
  } else if (diff.days && diff.days > 0) {
    remainingText = `${Math.ceil(diff.days)} days left`;
  } else if (diff.hours && diff.hours > 0) {
    remainingText = `${Math.ceil(diff.hours)} hours left`;
  } else if (diff.minutes && diff.minutes > 0) {
    remainingText = `${Math.ceil(diff.minutes)} mins left`;
  } else {
    remainingText = 'Upcoming';
  }

  return {
    date: targetDt.toJSDate(),
    isoString: targetDt.toISO() || '',
    displayString: targetDt.setZone('system').toLocaleString(DateTime.DATETIME_MED),
    remainingText,
    isToday: targetDt.hasSame(now, 'day'),
    originalTimezone: event.timezone
  };
};

// Check for active notifications (Browser Notifications)
export const checkNotifications = (events: AppEvent[], notifyCallback: (event: AppEvent, title: string) => void) => {
  const now = DateTime.now();

  events.forEach(event => {
    const nextDt = DateTime.fromISO(event.nextAlertAt).setZone(event.timezone);

    if (event.reminders && event.reminders.length > 0) {
      event.reminders.forEach(minutesBefore => {
        const notifyTime = nextDt.minus({ minutes: minutesBefore });
        const diff = Math.abs(now.diff(notifyTime, 'seconds').seconds);

        // Window of 30 seconds to catch the event
        if (diff < 30) {
          let reminderText = "Now!";
          if (minutesBefore > 0) {
            if (minutesBefore >= 1440) reminderText = `${Math.ceil(minutesBefore/1440)} days left`;
            else if (minutesBefore >= 60) reminderText = `${Math.ceil(minutesBefore/60)} hours left`;
            else reminderText = `${minutesBefore} mins left`;
          }
          notifyCallback(event, reminderText);
        }
      });
    }
  });
};

// Calculates the NEW nextAlertAt after the current one has passed
export const shouldUpdateRecurringEvent = (event: AppEvent): string | null => {
  if (!event.recurrenceRule || event.recurrenceRule.type === 'none') return null;

  const now = DateTime.now();
  const currentAlertDt = DateTime.fromISO(event.nextAlertAt).setZone(event.timezone);

  // If the current alert time has passed by 1 minute, calculate the next one
  if (currentAlertDt.plus({ minutes: 1 }) < now) {
    const nextDt = calculateNextRecurringDate(currentAlertDt, event.recurrenceRule, now, event.timezone);

    // Safety: Ensure new date is actually different and in future(ish)
    if (nextDt.toISO() !== event.nextAlertAt) {
      return nextDt.toISO(); // This string should preserve the timezone offset
    }
  }
  return null;
};

const calculateNextRecurringDate = (anchor: DateTime, rule: any, now: DateTime, timezone: string): DateTime => {
  // If it's yearly lunar, we recalculate based on lunar logic
  if (rule.type === 'yearly_lunar' && rule.lunarData) {
    return calculateNextLunarDate(rule.lunarData, anchor, now, timezone);
  }

  let currentCandidate = anchor;
  let safetyCounter = 0;

  // Loop until we find a date that is in the future relative to NOW
  while (currentCandidate < now && safetyCounter < 1000) {
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
          return anchor;
        }
        break;
      default:
        return anchor;
    }
  }

  return currentCandidate;
};

const calculateNextLunarDate = (lunarData: {month: number, day: number}, anchor: DateTime, now: DateTime, timezone: string): DateTime => {
  let searchYear = now.setZone(timezone).year;

  // Try current year and next 2 years
  for (let i = 0; i < 3; i++) {
    const y = searchYear + i;
    try {
      const lunar = Lunar.fromYmd(y, lunarData.month, lunarData.day);
      const solar = lunar.getSolar();

      const candidate = DateTime.fromObject({
        year: solar.getYear(),
        month: solar.getMonth(),
        day: solar.getDay(),
        hour: anchor.hour,
        minute: anchor.minute,
        second: 0
      }, { zone: timezone });

      if (candidate > now) {
        return candidate;
      }
    } catch (e) {
      // invalid lunar date in this year
    }
  }
  return anchor;
};
