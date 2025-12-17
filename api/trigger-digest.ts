
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

// Config
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const VAPID_PUBLIC_KEY = process.env.VITE_VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const VAPID_EMAIL = process.env.VITE_VAPID_EMAIL || 'mailto:example@example.com';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

webpush.setVapidDetails(
    VAPID_EMAIL,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Allow GET or POST for manual triggering
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const now = new Date();
        // Check events for the next 24 hours
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        // Log for debugging in Vercel functions logs
        console.log(`Checking events between ${now.toISOString()} and ${tomorrow.toISOString()}`);

        const { data: events, error: eventError } = await supabase
            .from('events')
            .select('*')
            .gte('next_alert_at', now.toISOString())
            .lte('next_alert_at', tomorrow.toISOString());

        if (eventError) throw eventError;

        if (!events || events.length === 0) {
            return res.status(200).json({ message: 'No upcoming events found in the next 24 hours.' });
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

        // Process each device
        for (const [deviceId, userEvents] of Object.entries(deviceEvents)) {
            if (!userEvents || userEvents.length === 0) continue;

            // Fetch subscription for this device
            const { data: subs, error: subError } = await supabase
                .from('subscriptions')
                .select('*')
                .eq('device_id', deviceId);

            if (subError || !subs || subs.length === 0) {
                console.log(`No subscription found for device ${deviceId}`);
                continue;
            }

            // Construct the message
            const eventCount = userEvents.length;
            const title = `📅 Upcoming: ${eventCount} Event${eventCount > 1 ? 's' : ''}`;

            const bodyLines = userEvents
                .slice(0, 3)
                .map((e: any) => `• ${e.title} at ${new Date(e.next_alert_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`);

            if (userEvents.length > 3) bodyLines.push(`...and ${userEvents.length - 3} more.`);

            const body = bodyLines.join('\n');

            // Send to all subscriptions for this device
            for (const subRecord of subs) {
                try {
                    const payload = JSON.stringify({
                        title,
                        body,
                        url: '/'
                    });

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

        res.status(200).json({
            success: true,
            eventsFound: events.length,
            devicesNotified: notificationsSent.length,
            message: `Sent notifications to ${notificationsSent.length} devices.`
        });
    } catch (error: any) {
        console.error('Trigger failed:', error);
        res.status(500).json({ error: error.message });
    }
}
