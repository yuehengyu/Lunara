
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
        // STRICT "Tomorrow Calendar Day" Logic (Toronto Time)
        const nowToronto = DateTime.now().setZone('America/Toronto');
        const targetStart = nowToronto.plus({ days: 1 }).startOf('day');
        const targetEnd = nowToronto.plus({ days: 1 }).endOf('day');

        console.log(`Cron: Scanning events. Target Window (Toronto): ${targetStart.toFormat('yyyy-MM-dd HH:mm')} - ${targetEnd.toFormat('HH:mm')}`);

        // We only need next_alert_at now.
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
            // CLEANUP LOGIC:
            const nowUtc = DateTime.now().toUTC();
            // Use next_alert_at strictly
            const nextAlertUtc = DateTime.fromISO(event.next_alert_at).toUTC();
            const isOneTime = !event.recurrence_rule || event.recurrence_rule.type === 'none' || !event.recurrence_rule.type;

            // Delete if passed > 2 hours ago (server side safety net, client deletes at 1 min)
            if (isOneTime && nextAlertUtc < nowUtc.minus({ hours: 2 })) {
                eventsToDelete.push(event.id);
                continue;
            }

            // NOTIFICATION LOGIC:
            if (!event.device_id) continue;

            // Base time for calculation. Strictly use next_alert_at
            const alertBaseTime = DateTime.fromISO(event.next_alert_at).setZone('America/Toronto');

            const reminders = event.reminders || [0];

            for (const minutesBefore of reminders) {
                // When should the alarm ring?
                const alertTime = alertBaseTime.minus({ minutes: minutesBefore });

                // Does this alarm ring "Tomorrow"?
                if (alertTime >= targetStart && alertTime <= targetEnd) {

                    if (!deviceAlerts[event.device_id]) deviceAlerts[event.device_id] = [];

                    let label = "";
                    const displayTime = alertBaseTime; // Show the Event Time in the notification

                    if (minutesBefore === 0) {
                        label = `• ${displayTime.toFormat('HH:mm')} - ${event.title}`;
                    } else if (minutesBefore === 1440) {
                        label = `• Reminder: ${event.title} is coming up on ${displayTime.toFormat('MMM dd')}`;
                    } else if (minutesBefore > 1440) {
                        const days = Math.round(minutesBefore / 1440);
                        label = `• In ${days} days: ${event.title}`;
                    } else {
                        label = `• Reminder: ${event.title} (${displayTime.toFormat('HH:mm')})`;
                    }

                    // Deduplicate
                    if (!deviceAlerts[event.device_id].includes(label)) {
                        deviceAlerts[event.device_id].push(label);
                    }
                }
            }
        }

        if (eventsToDelete.length > 0) {
            const { error: delError } = await supabase.from('events').delete().in('id', eventsToDelete);
            if(delError) console.error("Deletion failed:", delError);
        }

        for (const [deviceId, alerts] of Object.entries(deviceAlerts)) {
            if (!alerts || alerts.length === 0) continue;

            const { data: subs } = await supabase
                .from('subscriptions')
                .select('*')
                .eq('device_id', deviceId);

            if (!subs || subs.length === 0) continue;

            const title = `📅 Daily Digest: ${alerts.length} Alert${alerts.length > 1 ? 's' : ''} for Tomorrow`;
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
