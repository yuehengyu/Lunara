
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

    // Check the run mode: 'check' (default, 10 mins) or 'digest' (daily)
    const mode = req.query.type === 'digest' ? 'digest' : 'check';

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

        const deviceAlerts: Record<string, any[]> = {};
        const notificationsSent = new Set<string>();
        const eventsToDelete: string[] = [];

        // Time Config
        const nowUtc = DateTime.now().toUTC();
        const nowToronto = DateTime.now().setZone('America/Toronto');

        console.log(`[${mode.toUpperCase()}] Scanning... UTC: ${nowUtc.toFormat('HH:mm')}`);

        // --- MODE 1: INSTANT CHECK (Run every 10 mins) ---
        if (mode === 'check') {
            // Look ahead 15 mins
            const upcomingLimit = nowUtc.plus({ minutes: 30 });
            // Look back 20 mins (Safety net for delayed cron)
            const pastTolerance = nowUtc.minus({ minutes: 20 });

            for (const event of events) {
                if (!event.device_id) continue;

                // CLEANUP Check (2 hours old) - Only do cleanup in 'check' mode
                const nextAlertUtc = DateTime.fromISO(event.next_alert_at).toUTC();
                const isOneTime = !event.recurrence_rule || event.recurrence_rule.type === 'none';
                if (isOneTime && nextAlertUtc < nowUtc.minus({ hours: 2 })) {
                    eventsToDelete.push(event.id);
                    continue;
                }

                const alertBaseIso = DateTime.fromISO(event.next_alert_at);
                const reminders = event.reminders || [0];

                for (const minutesBefore of reminders) {
                    const alertMoment = alertBaseIso.minus({ minutes: minutesBefore }).toUTC();

                    // If moment is NOW (within window)
                    if (alertMoment >= pastTolerance && alertMoment <= upcomingLimit) {
                        if (!deviceAlerts[event.device_id]) deviceAlerts[event.device_id] = [];

                        const displayTime = alertMoment.setZone(event.timezone || 'America/Toronto');
                        const label = `🔔 NOW: ${event.title} (${displayTime.toFormat('HH:mm')})`;
                        const tag = `alert-${event.id}-${minutesBefore}`;

                        deviceAlerts[event.device_id].push({
                            title: '🚨 Event Reminder',
                            body: label,
                            tag: tag
                        });
                    }
                }
            }
        }

        // --- MODE 2: DAILY DIGEST (Run once a day) ---
        if (mode === 'digest') {
            const tomorrowStart = nowToronto.plus({ days: 1 }).startOf('day');
            const tomorrowEnd = nowToronto.plus({ days: 1 }).endOf('day');

            for (const event of events) {
                if (!event.device_id) continue;

                const alertBaseIso = DateTime.fromISO(event.next_alert_at);
                const reminders = event.reminders || [0];

                for (const minutesBefore of reminders) {
                    const alertMoment = alertBaseIso.minus({ minutes: minutesBefore });
                    // Convert to Toronto to check if it falls on "Tomorrow" calendar day
                    const alertMomentToronto = alertMoment.setZone('America/Toronto');

                    if (alertMomentToronto >= tomorrowStart && alertMomentToronto <= tomorrowEnd) {
                        if (!deviceAlerts[event.device_id]) deviceAlerts[event.device_id] = [];

                        const label = `📅 Tomorrow: ${event.title} at ${alertMomentToronto.toFormat('HH:mm')}`;
                        // Deduplicate strings locally
                        const exists = deviceAlerts[event.device_id].some(i => i.label === label);
                        if (!exists) {
                            deviceAlerts[event.device_id].push({
                                type: 'digest',
                                label: label
                            });
                        }
                    }
                }
            }
        }

        // Perform Cleanup (only in check mode)
        if (mode === 'check' && eventsToDelete.length > 0) {
            await supabase.from('events').delete().in('id', eventsToDelete);
        }

        // Send Pushes
        for (const [deviceId, items] of Object.entries(deviceAlerts)) {
            if (!items || items.length === 0) continue;

            const { data: subs } = await supabase.from('subscriptions').select('*').eq('device_id', deviceId);
            if (!subs || subs.length === 0) continue;

            // Processing Digest vs Instant
            const digestItems = items.filter(i => i.type === 'digest');
            const instantItems = items.filter(i => i.type !== 'digest');

            if (digestItems.length > 0) {
                const title = `📅 Tomorrow: ${digestItems.length} Events`;
                const body = digestItems.map(i => i.label).join('\n');

                for (const subRecord of subs) {
                    try {
                        await webpush.sendNotification(subRecord.subscription, JSON.stringify({
                            title,
                            body,
                            url: '/',
                            tag: 'daily-digest'
                        }));
                        notificationsSent.add(deviceId);
                    } catch(e) { console.error(e); }
                }
            }

            const sentTags = new Set();
            for (const item of instantItems) {
                if (sentTags.has(item.tag)) continue;
                sentTags.add(item.tag);

                for (const subRecord of subs) {
                    try {
                        const payload = JSON.stringify({
                            title: item.title,
                            body: item.body,
                            url: '/',
                            tag: item.tag
                        });
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
        }

        res.status(200).json({
            mode,
            success: true,
            scanned: events.length,
            notificationsSent: notificationsSent.size
        });
    } catch (error: any) {
        console.error('Cron failed:', error);
        res.status(500).json({ error: error.message });
    }
}
