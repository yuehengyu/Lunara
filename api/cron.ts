
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

// Config
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!; // Must use Service Role to read all subs
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
    // Security: Only Vercel Cron can call this (automatically handled by Vercel usually, but good to check headers if needed)

    try {
        const now = new Date();

        // 1. Fetch Events that are due (next_alert_at <= now)
        // We only fetch events that haven't been processed yet.
        // Optimization: In a real app, you'd mark them as "processing" or update next_alert_at immediately.
        // Here, we assume the frontend pre-calculated `next_alert_at`.
        // We fetch events due in the last minute or future (if slight drift).

        const { data: events, error: eventError } = await supabase
            .from('events')
            .select('*')
            .lte('next_alert_at', now.toISOString())
            .gt('next_alert_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()); // Don't fetch extremely old missed ones

        if (eventError) throw eventError;

        if (!events || events.length === 0) {
            return res.status(200).json({ message: 'No events due.' });
        }

        const notificationsSent = [];

        // 2. For each due event, find the subscription for that device
        for (const event of events) {
            if (!event.device_id) continue;

            const { data: subs, error: subError } = await supabase
                .from('subscriptions')
                .select('*')
                .eq('device_id', event.device_id);

            if (subError || !subs) continue;

            for (const subRecord of subs) {
                try {
                    const payload = JSON.stringify({
                        title: `Reminder: ${event.title}`,
                        body: event.description || 'It is time!',
                        url: '/'
                    });

                    await webpush.sendNotification(subRecord.subscription, payload);
                    notificationsSent.push(event.title);
                } catch (err: any) {
                    console.error(`Failed to push to device ${event.device_id}`, err);
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        // Subscription is dead, clean it up
                        await supabase.from('subscriptions').delete().eq('id', subRecord.id);
                    }
                }
            }

            // 3. IMPORTANT: Update the event's next_alert_at to null or the NEXT occurrence
            // Since calculating Lunar dates on server is hard without library,
            // we just set it to NULL so it doesn't trigger again immediately.
            // The FRONTEND is responsible for re-calculating the next occurrence when the user opens the app,
            // OR we can implement a basic "add 1 day" logic here if strictly needed.
            // For this MVP, setting to null prevents loop. The user must open app to schedule next loop.
            // Alternatively: If it's a simple daily solar event, we could add logic here.

            await supabase
                .from('events')
                .update({ next_alert_at: null }) // Stop alerting until app re-syncs
                .eq('id', event.id);
        }

        res.status(200).json({ success: true, sent: notificationsSent });
    } catch (error: any) {
        console.error('Cron failed:', error);
        res.status(500).json({ error: error.message });
    }
}
