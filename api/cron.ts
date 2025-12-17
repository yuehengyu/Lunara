
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { DateTime } from 'luxon';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    const VAPID_EMAIL = 'mailto:yuehengyuzs1211@gmail.com';
    const VAPID_PUBLIC_KEY = 'BDS748jbOSm0hDpwy9IHva9edOidWJHtD-Z9WT2KmKW0bsu0YcHD1dKYjJIg_WkIn1ZtvlLnTaNz_b-zWGZoH0E';
    const VAPID_PRIVATE_KEY = 'iBsEE9A6-Yz5oioLYXFXhL-TlDbCiUUlJ3l-4iJWdSw';

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        return res.status(500).json({ error: 'Server misconfiguration.' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    try {
        webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    } catch(err) {
        console.error("Cron VAPID Setup Error", err);
    }

    try {
        // 1. Define "Now" and "Tomorrow" (Target Window)
        const nowToronto = DateTime.now().setZone('America/Toronto');
        const targetDayStart = nowToronto.plus({ days: 1 }).startOf('day');
        const targetDayEnd = nowToronto.plus({ days: 1 }).endOf('day');

        console.log(`Cron: Scanning ALL events. Looking for alerts on ${targetDayStart.toFormat('yyyy-MM-dd')}`);

        // 2. Fetch ALL events.
        // We do this to ensure we catch "1 month before" reminders for events 1 month away, etc.
        // Also allows us to clean up old one-time events.
        const { data: events } = await supabase
            .from('events')
            .select('*');

        if (!events || events.length === 0) {
            return res.status(200).json({ message: 'Database is empty.' });
        }

        const notificationsSent = [];
        const deviceAlerts: Record<string, string[]> = {};
        const eventsToDelete: string[] = [];

        // 3. Process Events
        for (const event of events) {
            const eventTime = DateTime.fromISO(event.next_alert_at).setZone('America/Toronto');
            const isOneTime = !event.recurrence_rule || event.recurrence_rule.type === 'none';

            // --- CLEANUP LOGIC ---
            // If it's a one-time event and the time is completely in the past (before today), delete it.
            // We use 'nowToronto' to be safe.
            if (isOneTime && eventTime < nowToronto.minus({ hours: 12 })) {
                console.log(`Marking expired event for deletion: ${event.title}`);
                eventsToDelete.push(event.id);
                continue; // Skip notification check for dead events
            }

            // --- NOTIFICATION LOGIC ---
            if (!event.device_id) continue;

            const reminders = event.reminders || [0];

            for (const minutesBefore of reminders) {
                // Calculate the exact moment the user should be notified
                const alertTime = eventTime.minus({ minutes: minutesBefore });

                // Check if that moment falls within "Tomorrow" (00:00 - 23:59)
                if (alertTime >= targetDayStart && alertTime <= targetDayEnd) {

                    if (!deviceAlerts[event.device_id]) deviceAlerts[event.device_id] = [];

                    let label = "";

                    if (minutesBefore === 0) {
                        label = `• ${alertTime.toFormat('HH:mm')} - ${event.title}`;
                    } else if (minutesBefore === 1440) {
                        // Exactly 24h before
                        label = `• ${event.title} is tomorrow! (at ${eventTime.toFormat('HH:mm')})`;
                    } else if (minutesBefore > 1440) {
                        const days = Math.round(minutesBefore / 1440);
                        label = `• Heads up: ${event.title} in ${days} days`;
                    } else {
                        label = `• Reminder: ${event.title} (at ${eventTime.toFormat('HH:mm')})`;
                    }

                    // Deduplicate
                    if (!deviceAlerts[event.device_id].includes(label)) {
                        deviceAlerts[event.device_id].push(label);
                    }
                }
            }
        }

        // 4. Batch Delete Expired Events
        if (eventsToDelete.length > 0) {
            await supabase.from('events').delete().in('id', eventsToDelete);
            console.log(`Cleaned up ${eventsToDelete.length} expired events.`);
        }

        // 5. Send Notifications
        for (const [deviceId, alerts] of Object.entries(deviceAlerts)) {
            if (!alerts || alerts.length === 0) continue;

            const { data: subs } = await supabase
                .from('subscriptions')
                .select('*')
                .eq('device_id', deviceId);

            if (!subs || subs.length === 0) continue;

            const title = `📅 Daily Digest: ${alerts.length} Alert${alerts.length > 1 ? 's' : ''}`;
            const body = alerts.slice(0, 4).join('\n') + (alerts.length > 4 ? `\n...and ${alerts.length - 4} more` : '');

            for (const subRecord of subs) {
                try {
                    const payload = JSON.stringify({ title, body, url: '/' });
                    await webpush.sendNotification(subRecord.subscription, payload);
                    notificationsSent.push(deviceId);
                } catch (err: any) {
                    console.error(`Failed to push to device ${deviceId}`, err);
                    if (err.statusCode === 410 || err.statusCode === 404 || err.statusCode === 403) {
                        await supabase.from('subscriptions').delete().eq('id', subRecord.id);
                    }
                }
            }
        }

        res.status(200).json({
            success: true,
            eventsDeleted: eventsToDelete.length,
            devicesNotified: notificationsSent.length
        });
    } catch (error: any) {
        console.error('Cron failed:', error);
        res.status(500).json({ error: error.message });
    }
}
