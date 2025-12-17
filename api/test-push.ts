
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // 1. Extract Config
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    const VAPID_PUBLIC_KEY = process.env.VITE_VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
    const VAPID_EMAIL = process.env.VITE_VAPID_EMAIL || 'mailto:yuehengyuzs1211@gmail.com';

    // 2. Validate Config
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        return res.status(500).json({
            error: 'Configuration Error',
            details: 'Missing SUPABASE_URL. Please Redeploy Vercel project.'
        });
    }

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
        return res.status(500).json({ error: 'Configuration Error', details: 'Missing VAPID Keys.' });
    }

    // 3. Init
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const { deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'Missing deviceId' });

    try {
        const { data: subs, error } = await supabase
            .from('subscriptions')
            .select('*')
            .eq('device_id', deviceId);

        if (error || !subs || subs.length === 0) {
            return res.status(404).json({ error: 'No subscription found for this device. Try refreshing the page and clicking Enable Push again.' });
        }

        let sentCount = 0;
        for (const subRecord of subs) {
            try {
                await webpush.sendNotification(subRecord.subscription, JSON.stringify({
                    title: '🔔 Test Notification',
                    body: 'Success! Your device is configured correctly.',
                    url: '/'
                }));
                sentCount++;
            } catch (err: any) {
                console.error('Push failed', err);
                if (err.statusCode === 410 || err.statusCode === 404) {
                    await supabase.from('subscriptions').delete().eq('id', subRecord.id);
                }
            }
        }

        if (sentCount === 0) {
            return res.status(500).json({ error: 'Found subscription but failed to send. Keys might be invalid.' });
        }

        res.status(200).json({ success: true, count: sentCount });
    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
}
