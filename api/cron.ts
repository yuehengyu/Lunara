
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
    try {
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        // Daily Digest Mode: Fetch events scheduled for the next 24 hours
        // This runs once a day (e.g., 7 AM / 8 AM Toronto Time)
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

        // Group events by device_id to send a single summary per device
        const deviceEvents: Record<string, typeof events> = {};
        for (const event of events) {
            if (!event.device_id) continue;
            if (!deviceEvents[event.device_id]) {
                deviceEvents[event.device_id] = [];
            }
            deviceEvents[event.device_id].push(event);
        }

        // Process each device
        for (const [deviceId, userEvents] of Object.entries(deviceEvents)) {
            // Fetch subscription for this device
            const { data: subs, error: subError } = await supabase
                .from('subscriptions')
                .select('*')
                .eq('device_id', deviceId);

            if (subError || !subs || subs.length === 0) continue;

            // Construct the message
            const eventCount = userEvents.length;
            const title = `📅 Daily Digest: ${eventCount} Event${eventCount > 1 ? 's' : ''} Today`;

            // Create a summary body (e.g., "1. Mom's Birthday\n2. Meeting...")
            const bodyLines = userEvents
                .slice(0, 3) // Show top 3
                .map(e => `• ${e.title} (${new Date(e.next_alert_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})})`);

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

            // Note: We DO NOT clear next_alert_at here because the event hasn't technically happened yet.
            // We rely on the Frontend App to open and recalculate the next occurrence,
            // OR we rely on the next day's cron to pick up the next cycle if it's daily.
            // If we want to force an update, we would need logic to "bump" the date, but doing that on server without Lunar library is risky.
            // For a Digest, it is safe to just Notify and let the user handle the "Checking off".
        }

        res.status(200).json({ success: true, devicesNotified: notificationsSent.length });
    } catch (error: any) {
        console.error('Cron failed:', error);
        res.status(500).json({ error: error.message });
    }
}
