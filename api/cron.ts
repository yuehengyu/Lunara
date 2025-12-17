
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // 1. Extract Config
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    const VAPID_PUBLIC_KEY = process.env.VITE_VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
    const VAPID_EMAIL = process.env.VITE_VAPID_EMAIL || 'mailto:yuehengyuzs1211@gmail.com';

    // 2. Validate Config
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        console.error("Cron failed: Missing Supabase Config");
        return res.status(500).json({ error: 'Server misconfiguration: Missing SUPABASE_URL.' });
    }

    // 3. Init
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
        webpush.setVapidDetails(
            VAPID_EMAIL,
            VAPID_PUBLIC_KEY,
            VAPID_PRIVATE_KEY
        );
    }

    try {
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        // Daily Digest Mode
        const { data: events, error: eventError } = await supabase
            .from('events')
            .select('*')
            .gte('next_alert_at', now.toISOString())
            .lte('next_alert_at', tomorrow.toISOString());

        if (eventError) throw eventError;

        if (!events || events.length === 0) {
            return res.status(200).json({ message: 'No upcoming events for today.' });
        }

        const notificationsSent = [];
        const deviceEvents: Record<string, any[]> = {};

        for (const event of events) {
            if (!event.device_id) continue;
            if (!deviceEvents[event.device_id]) {
                deviceEvents[event.device_id] = [];
            }
            deviceEvents[event.device_id].push(event);
        }

        for (const [deviceId, userEvents] of Object.entries(deviceEvents)) {
            if (!userEvents || userEvents.length === 0) continue;

            const { data: subs, error: subError } = await supabase
                .from('subscriptions')
                .select('*')
                .eq('device_id', deviceId);

            if (subError || !subs || subs.length === 0) continue;

            const eventCount = userEvents.length;
            const title = `📅 Daily Digest: ${eventCount} Event${eventCount > 1 ? 's' : ''} Today`;

            const bodyLines = userEvents
                .slice(0, 3)
                .map((e: any) => `• ${e.title} (${new Date(e.next_alert_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})})`);

            if (userEvents.length > 3) bodyLines.push(`...and ${userEvents.length - 3} more.`);

            const body = bodyLines.join('\n');

            for (const subRecord of subs) {
                try {
                    const payload = JSON.stringify({ title, body, url: '/' });
                    await webpush.sendNotification(subRecord.subscription, payload);
                    notificationsSent.push(deviceId);
                } catch (err: any) {
                    console.error(`Failed to push to device ${deviceId}`, err);
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        await supabase.from('subscriptions').delete().eq('id', subRecord.id);
                    }
                }
            }
        }

        res.status(200).json({ success: true, devicesNotified: notificationsSent.length });
    } catch (error: any) {
        console.error('Cron failed:', error);
        res.status(500).json({ error: error.message });
    }
}
