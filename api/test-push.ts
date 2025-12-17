
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // 1. Supabase Config
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    // 2. Hardcoded VAPID Config
    const VAPID_EMAIL = 'mailto:yuehengyuzs1211@gmail.com';
    const VAPID_PUBLIC_KEY = 'BDS748jbOSm0hDpwy9IHva9edOidWJHtD-Z9WT2KmKW0bsu0YcHD1dKYjJIg_WkIn1ZtvlLnTaNz_b-zWGZoH0E';
    const VAPID_PRIVATE_KEY = 'iBsEE9A6-Yz5oioLYXFXhL-TlDbCiUUlJ3l-4iJWdSw';

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        return res.status(500).json({ error: 'Configuration Error', details: 'Missing SUPABASE_URL.' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    try {
        webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    } catch (err: any) {
        return res.status(500).json({ error: 'VAPID Setup Failed', details: err.message });
    }

    const { deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'Missing deviceId' });

    try {
        const { data: subs, error } = await supabase
            .from('subscriptions')
            .select('*')
            .eq('device_id', deviceId);

        if (error || !subs || subs.length === 0) {
            return res.status(404).json({ error: 'No subscription found. Client will auto-fix.' });
        }

        let sentCount = 0;
        const errors = [];

        for (const subRecord of subs) {
            try {
                await webpush.sendNotification(subRecord.subscription, JSON.stringify({
                    title: '🔔 Test Notification',
                    body: 'Success! Your keys are matched.',
                    url: '/'
                }));
                sentCount++;
            } catch (err: any) {
                console.error('Push failed', err);
                errors.push(err.message || 'Unknown error');

                // CLEANUP: If the subscription is invalid (410 Gone, 404 Not Found) OR the keys don't match (403 Forbidden/BadJwtToken)
                // we should delete it so the client knows to create a new one.
                if (err.statusCode === 410 || err.statusCode === 404 || err.statusCode === 403) {
                    console.log(`Deleting invalid subscription ${subRecord.id} (Status: ${err.statusCode})`);
                    await supabase.from('subscriptions').delete().eq('id', subRecord.id);
                }
            }
        }

        if (sentCount === 0) {
            // Return 403/410/404 based on the last error to help client decide logic
            // If we deleted the sub, returning 410/403 tells client to resubscribe.
            return res.status(403).json({
                error: 'Subscription invalid or expired',
                details: errors.join(', '),
                shouldResubscribe: true
            });
        }

        res.status(200).json({ success: true, count: sentCount });
    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
}
