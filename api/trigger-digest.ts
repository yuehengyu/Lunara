
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { DateTime } from 'luxon';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    const VAPID_EMAIL = 'mailto:yuehengyuzs1211@gmail.com';
    const VAPID_PUBLIC_KEY = 'BDS748jbOSm0hDpwy9IHva9edOidWJHtD-Z9WT2KmKW0bsu0YcHD1dKYjJIg_WkIn1ZtvlLnTaNz_b-zWGZoH0E';
    const VAPID_PRIVATE_KEY = 'iBsEE9A6-Yz5oioLYXFXhL-TlDbCiUUlJ3l-4iJWdSw';

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        return res.status(500).json({ error: 'Server Configuration Error' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    try {
        webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    } catch (err: any) {
        return res.status(500).json({ error: "VAPID Setup Error", details: err.message });
    }

    try {
        // 1. Determine "Tomorrow" in Toronto Time
        // We look ahead to find alerts that fall into the standard "Tomorrow" window for the user
        // This assumes the user base is primarily in Toronto context for the daily digest.
        const nowToronto = DateTime.now().setZone('America/Toronto');
        const targetStart = nowToronto.plus({ days: 1 }).startOf('day');
        const targetEnd = nowToronto.plus({ days: 1 }).endOf('day');

        console.log(`Manual Trigger: Scanning events for window (Toronto): ${targetStart.toFormat('yyyy-MM-dd HH:mm')} - ${targetEnd.toFormat('HH:mm')}`);

        const { data: events, error: eventError } = await supabase
            .from('events')
            .select('*');

        if (eventError) throw eventError;

        if (!events || events.length === 0) {
            return res.status(200).json({ success: true, eventsFound: 0, message: 'Database empty.' });
        }

        const notificationsSent = [];
        const deviceAlerts: Record<string, string[]> = {};
        const eventsToDelete: string[] = [];
        let matchedAlertCount = 0;

        for (const event of events) {
            // 2. Strict Cleanup Logic (Using UTC to be safe)
            // Check if next_alert_at is more than 2 hours in the past
            const nextAlertUtc = DateTime.fromISO(event.next_alert_at).toUTC();
            const nowUtc = DateTime.now().toUTC();
            const isOneTime = !event.recurrence_rule || event.recurrence_rule.type === 'none';

            if (isOneTime && nextAlertUtc < nowUtc.minus({ hours: 2 })) {
                eventsToDelete.push(event.id);
                continue;
            }

            // 3. Notification Logic
            if (!event.device_id) continue;

            // CRITICAL: Convert the stored event time (which might be +08:00) to Toronto time (-05:00)
            // This ensures we check if the moment of the alert falls on "Tomorrow Toronto Day"
            const alertBaseTime = DateTime.fromISO(event.next_alert_at).setZone('America/Toronto');

            const reminders = event.reminders || [0];

            for (const minutesBefore of reminders) {
                const alertTime = alertBaseTime.minus({ minutes: minutesBefore });

                // Check if the ALERT TIME falls within "Tomorrow" in Toronto
                if (alertTime >= targetStart && alertTime <= targetEnd) {

                    matchedAlertCount++;
                    if (!deviceAlerts[event.device_id]) deviceAlerts[event.device_id] = [];

                    let label = "";
                    // Display the time in Toronto format so the user knows when it rings locally
                    const displayTime = alertBaseTime;

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
                    if (!deviceAlerts[event.device_id].includes(label)) {
                        deviceAlerts[event.device_id].push(label);
                    }
                }
            }
        }

        // Batch delete expired events
        if (eventsToDelete.length > 0) {
            await supabase.from('events').delete().in('id', eventsToDelete);
        }

        if (matchedAlertCount === 0) {
            return res.status(200).json({
                success: true,
                eventsFound: events.length,
                eventsDeleted: eventsToDelete.length,
                matchedAlerts: matchedAlertCount,
                message: `No alerts found for tomorrow (${targetStart.toFormat('yyyy-MM-dd')}).`
            });
        }

        // Send Pushes
        for (const [deviceId, alerts] of Object.entries(deviceAlerts)) {
            if (!alerts || alerts.length === 0) continue;

            const { data: subs } = await supabase.from('subscriptions').select('*').eq('device_id', deviceId);
            if (!subs || subs.length === 0) continue;

            const title = `📅 Digest: ${alerts.length} Alert${alerts.length > 1 ? 's' : ''} for Tomorrow`;
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
            eventsFound: events.length,
            eventsDeleted: eventsToDelete.length,
            matchedAlerts: matchedAlertCount,
            devicesNotified: notificationsSent.length
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
}
