
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
        const { data: events } = await supabase.from('events').select('*');
        if (!events || events.length === 0) {
            return res.status(200).json({ message: 'Database is empty.' });
        }

        const deviceAlerts: Record<string, string[]> = {};
        const notificationsSent = new Set<string>();
        const eventsToDelete: string[] = [];

        // --- TIME WINDOWS ---
        // 1. Tomorrow Digest Window (Toronto Time)
        const nowToronto = DateTime.now().setZone('America/Toronto');
        const tomorrowStart = nowToronto.plus({ days: 1 }).startOf('day');
        const tomorrowEnd = nowToronto.plus({ days: 1 }).endOf('day');

        // 2. Instant Alert Window (Universal UTC)
        // Check for alerts due in the next 15 minutes (or recently passed within 2 mins to catch delayed crons)
        const nowUtc = DateTime.now().toUTC();
        const upcomingLimit = nowUtc.plus({ minutes: 15 });
        const pastTolerance = nowUtc.minus({ minutes: 2 });

        console.log(`Scanning... Now(UTC): ${nowUtc.toFormat('HH:mm')}, UpcomingLimit: ${upcomingLimit.toFormat('HH:mm')}`);

        for (const event of events) {
            if (!event.device_id) continue;

            // CLEANUP Check (2 hours old)
            const nextAlertUtc = DateTime.fromISO(event.next_alert_at).toUTC();
            const isOneTime = !event.recurrence_rule || event.recurrence_rule.type === 'none';
            if (isOneTime && nextAlertUtc < nowUtc.minus({ hours: 2 })) {
                eventsToDelete.push(event.id);
                continue;
            }

            // Base Alert Time (UTC for calculation, Zone for display)
            const alertBaseIso = DateTime.fromISO(event.next_alert_at); // keeps offset
            const reminders = event.reminders || [0];

            for (const minutesBefore of reminders) {
                // Calculate the specific alarm moment
                const alertMoment = alertBaseIso.minus({ minutes: minutesBefore }).toUTC();

                // --- LOGIC A: Instant Push (Server Wake Up) ---
                // If the event is happening NOW (or next 15 mins), send a push immediately.
                // This solves the "Locked Phone" issue if this API is hit frequently.
                if (alertMoment >= pastTolerance && alertMoment <= upcomingLimit) {
                    if (!deviceAlerts[event.device_id]) deviceAlerts[event.device_id] = [];

                    // Format for user friendly time
                    const displayTime = alertMoment.setZone(event.timezone || 'America/Toronto');
                    const label = `🔔 NOW: ${event.title} (${displayTime.toFormat('HH:mm')})`;

                    // Add to send list
                    if (!deviceAlerts[event.device_id].includes(label)) {
                        deviceAlerts[event.device_id].push(label);
                    }
                }

                // --- LOGIC B: Daily Digest (Tomorrow) ---
                // Only run this check if we are near the "Daily Digest" time (e.g. 11pm Toronto)
                // Or just run it always, deduplication handles spam.
                // Actually, to prevent spamming the "Tomorrow" digest every 10 minutes,
                // we should restrict this to the daily cron schedule (23:00).
                // For now, let's allow it but label it clearly.
                const alertMomentToronto = alertMoment.setZone('America/Toronto');
                if (alertMomentToronto >= tomorrowStart && alertMomentToronto <= tomorrowEnd) {
                    // Only include digest if this script is running around 11PM Toronto time (approx 4AM UTC)
                    // This prevents the digest from sending every 10 mins if user sets up high freq cron
                    if (nowToronto.hour === 23) {
                        if (!deviceAlerts[event.device_id]) deviceAlerts[event.device_id] = [];
                        const label = `📅 Tomorrow: ${event.title} at ${alertMomentToronto.toFormat('HH:mm')}`;
                        if (!deviceAlerts[event.device_id].includes(label)) {
                            deviceAlerts[event.device_id].push(label);
                        }
                    }
                }
            }
        }

        // Cleanup
        if (eventsToDelete.length > 0) {
            await supabase.from('events').delete().in('id', eventsToDelete);
        }

        // Send Pushes
        for (const [deviceId, alerts] of Object.entries(deviceAlerts)) {
            if (!alerts || alerts.length === 0) continue;

            const { data: subs } = await supabase.from('subscriptions').select('*').eq('device_id', deviceId);
            if (!subs || subs.length === 0) continue;

            // Group alerts
            const title = alerts.some(a => a.includes('NOW')) ? '🚨 Event Reminder' : '📅 Daily Digest';
            const body = alerts.join('\n');

            for (const subRecord of subs) {
                try {
                    const payload = JSON.stringify({ title, body, url: '/' });
                    await webpush.sendNotification(subRecord.subscription, payload);
                    notificationsSent.add(deviceId);
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
            scanned: events.length,
            notificationsSent: notificationsSent.size
        });
    } catch (error: any) {
        console.error('Cron failed:', error);
        res.status(500).json({ error: error.message });
    }
}
