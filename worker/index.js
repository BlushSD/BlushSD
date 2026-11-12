/**
 * Blush SD — inquiry backend (Cloudflare Worker)
 *
 * Routes
 *   POST /inquiry   receive a website inquiry, save it, return a reference number
 *   GET  /health    simple "is it up" check
 *
 * Bindings and settings (configured in the Cloudflare dashboard, never in this file)
 *   DB                 D1 database binding (blush-inquiries)
 *   TURNSTILE_SECRET   secret — Turnstile secret key
 *   IP_HASH_SALT       secret — any long random string
 *   TELEGRAM_BOT_TOKEN secret — from @BotFather
 *   TELEGRAM_CHAT_IDS_FLORALS   variable — who gets FLORAL alerts, comma-separated chat IDs (Noor)
 *   TELEGRAM_CHAT_IDS_CATERING  variable — who gets CATERING alerts, comma-separated chat IDs (Noor, Aseel)
 *   TELEGRAM_CHAT_IDS           variable — optional fallback for any type without its own list
 *   ALLOWED_ORIGINS    variable — comma-separated, e.g. https://blushsd.com,https://www.blushsd.com
 *   IG_USERNAME        variable — blush.sd
 *   RETENTION_DAYS     variable — optional, default 365
 *
 * Phone alerts: each new inquiry is sent through a Telegram bot to the phones on
 * that service's list (florals → Noor; catering → Noor and Aseel)
 * (free). If that fails, the scheduled job retries. The email copy is sent by the
 * website itself through Formspree, so either channel works without the other.
 *
 * Phase 5 (Instagram webhook) adds to this file later.
 */

const LIMITS = {
  bodyBytes: 16 * 1024,
  name: 100,
  email: 254,
  venue: 200,
  phone: 30,
  message: 3000,
  maxGuests: 5000,
  perIpPerHour: 5,
  notifyMaxAttempts: 6,
};

// Crockford base32: no I, L, O or U, so codes are easy to read aloud and type.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    }

    try {
      if (url.pathname === '/health' && request.method === 'GET') {
        return json({ ok: true }, 200, cors);
      }
      if (url.pathname === '/inquiry' && request.method === 'POST') {
        if (!cors) return json({ ok: false, error: 'forbidden' }, 403);
        return await handleInquiry(request, env, ctx, cors);
      }
      return json({ ok: false, error: 'not_found' }, 404, cors);
    } catch (err) {
      console.error('Unhandled error', err && err.stack ? err.stack : err);
      return json({ ok: false, error: 'server_error' }, 500, cors);
    }
  },

  // Runs on a schedule (Cron Trigger "*/10 * * * *"): retry missed phone alerts,
  // then clean up old data.
  async scheduled(event, env, ctx) {
    await retryNotifications(env);

    const days = clampInt(env.RETENTION_DAYS, 30, 3650) || 365;
    await env.DB.prepare(
      `DELETE FROM inquiries WHERE created_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)`
    ).bind(`-${days} days`).run();
    // Rate-limit fingerprints are only needed for an hour; blank them after a day.
    await env.DB.prepare(
      `UPDATE inquiries SET ip_hash = NULL
         WHERE ip_hash IS NOT NULL AND created_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day')`
    ).run();
  },
};

/* ---------------------------------------------------------------- inquiry */

async function handleInquiry(request, env, ctx, cors) {
  const type = request.headers.get('Content-Type') || '';
  if (!type.includes('application/json')) {
    return json({ ok: false, error: 'bad_request' }, 415, cors);
  }
  const raw = await request.text();
  if (raw.length > LIMITS.bodyBytes) {
    return json({ ok: false, error: 'too_large' }, 413, cors);
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400, cors);
  }
  if (!body || typeof body !== 'object') {
    return json({ ok: false, error: 'bad_request' }, 400, cors);
  }

  // Honeypot: real people never fill this hidden field. Pretend success, store nothing.
  if (clean(body._gotcha, 200)) {
    return json({ ok: true, reference: makeReference(), ig_link: igLink(env, null) }, 200, cors);
  }

  // Idempotency: the same form load re-sending (double tap, retry) gets the same answer.
  const submissionId = typeof body.submission_id === 'string' ? body.submission_id : '';
  if (!/^[A-Za-z0-9-]{16,64}$/.test(submissionId)) {
    return json({ ok: false, error: 'bad_request' }, 400, cors);
  }
  const existing = await env.DB.prepare(
    'SELECT reference, ig_token FROM inquiries WHERE submission_id = ?'
  ).bind(submissionId).first();
  if (existing) {
    return json({ ok: true, reference: existing.reference, ig_link: igLink(env, existing.ig_token) }, 200, cors);
  }

  const result = validate(body);
  if (!result.ok) {
    return json({ ok: false, error: 'invalid', fields: result.fields }, 422, cors);
  }
  const data = result.data;

  const ip = request.headers.get('CF-Connecting-IP') || '';

  // Spam check (Cloudflare Turnstile).
  const human = await verifyTurnstile(body.turnstile_token, ip, env);
  if (!human) {
    return json({ ok: false, error: 'verification_failed' }, 403, cors);
  }

  // Rate limit: a few inquiries per visitor per hour is plenty.
  const ipHash = ip ? await sha256Hex(`${env.IP_HASH_SALT || ''}|${ip}`) : null;
  if (ipHash) {
    const recent = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM inquiries
        WHERE ip_hash = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 hour')`
    ).bind(ipHash).first();
    if (recent && recent.n >= LIMITS.perIpPerHour) {
      return json({ ok: false, error: 'rate_limited' }, 429, cors);
    }
  }

  // Save. Retry once on the (astronomically unlikely) chance a random code collides.
  for (let attempt = 0; attempt < 3; attempt++) {
    const reference = makeReference();
    const igToken = randomToken(24);
    try {
      await env.DB.prepare(
        `INSERT INTO inquiries
           (reference, ig_token, submission_id, service, name, email, phone, event_date, venue, guests, message, ip_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        reference, igToken, submissionId, data.service, data.name, data.email, data.phone,
        data.event_date, data.venue, data.guests, data.message, ipHash
      ).run();

      // Send the phone alert after replying, so the customer never waits on it.
      ctx.waitUntil(notifyOwner(env, reference).catch((err) => console.error('notify failed', err)));

      return json({ ok: true, reference, ig_link: igLink(env, igToken) }, 201, cors);
    } catch (err) {
      const msg = String(err && err.message);
      if (msg.includes('UNIQUE') && msg.includes('submission_id')) {
        // A parallel request with the same submission won the race — return its result.
        const row = await env.DB.prepare(
          'SELECT reference, ig_token FROM inquiries WHERE submission_id = ?'
        ).bind(submissionId).first();
        if (row) return json({ ok: true, reference: row.reference, ig_link: igLink(env, row.ig_token) }, 200, cors);
      }
      if (!msg.includes('UNIQUE')) throw err;
    }
  }
  throw new Error('Could not generate a unique reference');
}

/* ------------------------------------------------------------- validation */

function validate(body) {
  const fields = {};
  const service = body.service === 'florals' || body.service === 'catering' ? body.service : null;
  if (!service) fields.service = 'invalid';

  const name = clean(body.name, LIMITS.name + 1);
  if (!name) fields.name = 'required';
  else if (name.length > LIMITS.name) fields.name = 'too_long';

  const email = clean(body.email, LIMITS.email + 1).toLowerCase() || null;
  if (email && (email.length > LIMITS.email || !/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(email))) {
    fields.email = 'invalid';
  }

  const phone = clean(body.phone, LIMITS.phone + 1) || null;
  if (!phone) fields.phone = 'required';
  else {
    const digits = phone.replace(/\D/g, '');
    if (phone.length > LIMITS.phone || !/^[0-9+().\-\s]+$/.test(phone) || digits.length < 7 || digits.length > 15) {
      fields.phone = 'invalid';
    }
  }

  let eventDate = clean(body.event_date, 20) || null;
  if (eventDate && !isReasonableDate(eventDate)) fields.event_date = 'invalid';

  let venue = null;
  let guests = null;
  if (service === 'florals') {
    venue = clean(body.venue, LIMITS.venue + 1) || null;
    if (venue && venue.length > LIMITS.venue) fields.venue = 'too_long';
  }
  if (service === 'catering') {
    const g = clean(String(body.guests ?? ''), 10);
    if (g) {
      guests = /^\d+$/.test(g) ? Number(g) : NaN;
      if (!(guests >= 1 && guests <= LIMITS.maxGuests)) fields.guests = 'invalid';
    }
  }

  const message = clean(body.message, LIMITS.message + 1, true) || null;
  if (message && message.length > LIMITS.message) fields.message = 'too_long';

  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, data: { service, name, email, phone, event_date: eventDate, venue, guests, message } };
}

// Trim, cap length, and strip invisible control characters (keeps newlines in the message).
function clean(value, max, keepNewlines = false) {
  if (typeof value !== 'string') return '';
  let s = value.normalize('NFC');
  s = keepNewlines
    ? s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    : s.replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ');
  s = s.trim();
  return s.length > max ? s.slice(0, max) : s;
}

function isReasonableDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return false;
  const now = Date.now();
  const day = 86400000;
  return d.getTime() > now - 2 * day && d.getTime() < now + 3 * 366 * day;
}

/* ---------------------------------------------------------- phone alerts */

async function notifyOwner(env, reference) {
  const row = await env.DB.prepare(
    'SELECT * FROM inquiries WHERE reference = ? AND notified_at IS NULL'
  ).bind(reference).first();
  if (!row) return true;

  const ok = await sendTelegram(env, formatAlert(row), row.service);
  if (ok) {
    await env.DB.prepare(
      `UPDATE inquiries SET notified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), notify_attempts = notify_attempts + 1
        WHERE id = ? AND notified_at IS NULL`
    ).bind(row.id).run();
  } else {
    await env.DB.prepare('UPDATE inquiries SET notify_attempts = notify_attempts + 1 WHERE id = ?')
      .bind(row.id).run();
  }
  return ok;
}

async function retryNotifications(env) {
  const { results } = await env.DB.prepare(
    `SELECT reference FROM inquiries
      WHERE notified_at IS NULL AND notify_attempts < ?
        AND created_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 days')
      ORDER BY created_at LIMIT 20`
  ).bind(LIMITS.notifyMaxAttempts).all();
  for (const r of results || []) {
    await notifyOwner(env, r.reference);
  }
}

// Who gets an alert: the service's own list (TELEGRAM_CHAT_IDS_FLORALS or
// TELEGRAM_CHAT_IDS_CATERING), else the shared TELEGRAM_CHAT_IDS list.
function chatsFor(env, service) {
  const own = service === 'florals' ? env.TELEGRAM_CHAT_IDS_FLORALS
    : service === 'catering' ? env.TELEGRAM_CHAT_IDS_CATERING
    : '';
  const list = String(own || env.TELEGRAM_CHAT_IDS || '');
  return [...new Set(list.split(',').map((s) => s.trim()).filter(Boolean))];
}

// Sends to every chat on the list. Succeeds if at least one arrives, so one
// person's phone being unreachable never blocks the other's alert.
async function sendTelegram(env, html, service) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chats = chatsFor(env, service);
  if (!token || !chats.length) {
    console.error('Telegram is not configured');
    return false;
  }
  let delivered = 0;
  for (const chatId of chats) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: html,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out.ok) delivered++;
      else console.error('Telegram error', res.status, out && out.description);
    } catch (err) {
      console.error('Telegram request failed', err);
    }
  }
  return delivered > 0;
}

function formatAlert(row) {
  const fl = row.service === 'florals';
  const first = String(row.name).split(/\s+/)[0];
  const lines = [
    `🌸 <b>New ${fl ? 'Floral' : 'Catering'} Inquiry</b>`,
    `Ref ${esc(row.reference)}`,
    '',
    `<b>Name:</b> ${esc(row.name)}`,
    `<b>Phone:</b> ${esc(row.phone || 'not given')}`,
    `<b>Email:</b> ${row.email ? esc(row.email) : 'not given'}`,
    `<b>Event date:</b> ${row.event_date ? esc(longDate(row.event_date)) : 'not given'}`,
  ];
  if (fl) lines.push(`<b>Venue:</b> ${row.venue ? esc(row.venue) : 'not given'}`);
  else lines.push(`<b>Guests:</b> ${row.guests ? esc(String(row.guests)) : 'not given'}`);
  if (row.message) {
    // Telegram allows 4,096 characters; keep the quote well under that.
    let m = esc(row.message);
    if (m.length > 2500) m = m.slice(0, 2500).replace(/&[a-z]*$/, '') + '… (full message saved in Cloudflare)';
    lines.push('', `<i>“${m}”</i>`);
  }
  lines.push('', row.phone
    ? `Tap the phone number to call or text ${esc(first)}.`
    : `Reply to ${esc(first)} by email.`);
  return lines.join('\n');
}

function longDate(s) {
  const d = new Date(`${s}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* --------------------------------------------------------------- helpers */

async function verifyTurnstile(token, ip, env) {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  if (!env.TURNSTILE_SECRET) {
    console.error('TURNSTILE_SECRET is not set');
    return false;
  }
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });
    const out = await res.json();
    return out && out.success === true;
  } catch (err) {
    console.error('Turnstile verification failed', err);
    return false;
  }
}

function corsHeaders(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!origin || !allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status, extra) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(extra || {}),
    },
  });
}

function igLink(env, token) {
  const user = env.IG_USERNAME || 'blush.sd';
  return token ? `https://ig.me/m/${user}?ref=${token}` : `https://ig.me/m/${user}`;
}

function makeReference() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let code = '';
  for (const b of bytes) code += CODE_ALPHABET[b & 31];
  return `BL-${code.slice(0, 4)}-${code.slice(4)}`;
}

// URL-safe random token using only characters Instagram's ref parameter allows.
function randomToken(bytes) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function clampInt(v, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}
