/**
 * Vercel Serverless Function: /api/sos
 * Emergency SOS WhatsApp Dispatcher for Argus.AI
 * 
 * Capabilities:
 * 1. Validates and normalizes phone numbers in E.164 international format (e.g. +91...).
 * 2. Provides safe Test Mode (simulates emergency events without contacting real people).
 * 3. Integrates with Twilio WhatsApp API using server-side environment variables.
 * 4. Honest delivery state reporting (queued/accepted vs delivered).
 * 5. Rejects hardcoded coordinates; attaches real location link only when provided.
 */

const fs = require('fs');
const path = require('path');

// Auto-load fallback .env locally if not in Vercel production environment
function loadLocalEnv() {
    if (process.env.TWILIO_ACCOUNT_SID) return;
    const candidates = [
        path.join(process.cwd(), '.env'),
        path.join(process.cwd(), 'Visual Explanation', 'Visual Explanation', '.env'),
        path.join(__dirname, '..', '.env'),
        path.join(__dirname, '..', 'Visual Explanation', 'Visual Explanation', '.env')
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            try {
                const lines = fs.readFileSync(p, 'utf-8').split('\n');
                for (const line of lines) {
                    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
                    if (match) {
                        const key = match[1];
                        let val = (match[2] || '').trim();
                        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
                        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
                        if (!process.env[key]) process.env[key] = val;
                    }
                }
            } catch (e) {
                // Ignore fallback read errors
            }
        }
    }
}

loadLocalEnv();

module.exports = async function handler(req, res) {
    // 1. Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            error: 'Method Not Allowed. Use POST.'
        });
    }

    // 2. Parse and Validate Request Body
    let body = req.body;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch (e) {
            return res.status(400).json({
                success: false,
                error: 'Invalid JSON payload.'
            });
        }
    }

    const {
        contactName = 'Emergency Contact',
        phoneNumber,
        location = null,
        isTestMode = false
    } = body || {};

    if (!phoneNumber || typeof phoneNumber !== 'string') {
        return res.status(400).json({
            success: false,
            error: 'Missing required field: phoneNumber.'
        });
    }

    // Normalize phone number (remove spaces, dashes, parentheses)
    const normalizedPhone = phoneNumber.replace(/[\s\-()]/g, '');

    // Validate E.164 international format: must start with + and contain 8 to 15 digits
    const e164Regex = /^\+[1-9]\d{7,14}$/;
    if (!e164Regex.test(normalizedPhone)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid phone number format. Must include country code (e.g. +91 for India) and 8-15 digits.'
        });
    }

    const timestamp = new Date().toISOString();
    const formattedDate = new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'medium'
    });

    // 3. Location String Construction (Only if valid coordinates supplied)
    let locationText = "Location: Not available or permission denied.";
    let hasRealCoordinates = false;
    if (location && typeof location.latitude === 'number' && typeof location.longitude === 'number') {
        const lat = location.latitude.toFixed(6);
        const lng = location.longitude.toFixed(6);
        const acc = location.accuracy ? ` (Accuracy: ±${Math.round(location.accuracy)}m)` : '';
        locationText = `Location: https://maps.google.com/?q=${lat},${lng}${acc}`;
        hasRealCoordinates = true;
    }

    // 4. Test Mode Handling (Never contact real people or external services)
    if (isTestMode) {
        return res.status(200).json({
            success: true,
            status: 'test_mode_success',
            isTestMode: true,
            recipient: normalizedPhone,
            contactName: contactName.trim(),
            hasLocation: hasRealCoordinates,
            message: 'TEST MODE: Simulated SOS event processed successfully. No real WhatsApp message was dispatched.',
            timestamp
        });
    }

    // 5. Live WhatsApp Provider Configuration Check
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromWhatsApp = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886'; // Twilio sandbox default

    if (!accountSid || !authToken) {
        return res.status(503).json({
            success: false,
            status: 'not_configured',
            isConfigured: false,
            error: 'Real WhatsApp alerts not configured on server. Vercel environment variables (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER) must be configured in Vercel to dispatch real WhatsApp messages. Use Test Mode for safe simulation.',
            recipient: normalizedPhone
        });
    }

    // 6. Build Emergency WhatsApp Message
    const messageBody = `🚨 *EMERGENCY SOS ALERT — Argus.AI* 🚨\n\n` +
        `The user has triggered an emergency alert.\n` +
        `• Contact: ${contactName.trim()}\n` +
        `• Time: ${formattedDate} (IST)\n` +
        `• ${locationText}\n\n` +
        `Please contact the user immediately or dial 112 for local emergency services if they cannot be reached.`;

    const formattedTo = `whatsapp:${normalizedPhone}`;
    const formattedFrom = fromWhatsApp.startsWith('whatsapp:') ? fromWhatsApp : `whatsapp:${fromWhatsApp}`;

    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const authHeader = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const formParams = new URLSearchParams();
    formParams.append('To', formattedTo);
    formParams.append('From', formattedFrom);
    formParams.append('Body', messageBody);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const twilioRes = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formParams.toString(),
            signal: controller.signal
        });

        clearTimeout(timeout);

        const data = await twilioRes.json();

        if (twilioRes.ok) {
            // Note: Twilio returns 'queued' or 'accepted' on successful submission.
            // We report 'accepted_by_provider' honestly; we do NOT falsely claim 'delivered'.
            return res.status(200).json({
                success: true,
                status: 'accepted_by_provider',
                provider: 'Twilio WhatsApp',
                messageSid: data.sid,
                providerStatus: data.status,
                recipient: normalizedPhone,
                hasLocation: hasRealCoordinates,
                message: 'Emergency alert accepted by WhatsApp messaging provider. Delivery is in progress.',
                timestamp
            });
        } else {
            console.error('[Twilio Error]', data);
            let detail = data.message || `Provider responded with error ${twilioRes.status}`;
            if (data.code === 21608) {
                detail = `Recipient ${normalizedPhone} has not joined your Twilio WhatsApp Sandbox. For sandbox testing, send "join <code-word>" to ${fromWhatsApp} from WhatsApp first.`;
            }

            return res.status(twilioRes.status).json({
                success: false,
                status: 'provider_error',
                error: detail,
                code: data.code,
                recipient: normalizedPhone
            });
        }

    } catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') {
            return res.status(504).json({
                success: false,
                status: 'timeout',
                error: 'Network timeout contacting WhatsApp messaging provider.'
            });
        }

        console.error('[SOS API Exception]', err);
        return res.status(500).json({
            success: false,
            status: 'server_error',
            error: `Internal server error: ${err.message}`
        });
    }
};
