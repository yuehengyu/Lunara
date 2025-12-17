
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Since we are using Supabase directly from the client to store subscriptions
// (for simplicity in this MVP), this endpoint is just a health check or
// could be used for server-side validation later.

export default function handler(req: VercelRequest, res: VercelResponse) {
    res.status(200).json({ message: 'Use Supabase client to store subscriptions directly.' });
}
