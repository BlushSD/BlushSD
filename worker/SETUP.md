# Blush SD inquiries — setup guide

Everything here is free. No terminal needed. Plan on about 45 minutes, plus a few minutes
with Noor and her phone for Part A.

**What you're turning on**
1. Customer sends the form → it's saved securely and gets a reference number (e.g. BL-7K3Q-M9XD).
2. Noor's phone gets an alert with every detail (Telegram app).
3. Noor also gets the same inquiry by email (Formspree, as today).
4. The customer sees the Blush thank-you page, with an easy "Message Us on Instagram" option.

**Safety net:** until you do Part F, the live site keeps working exactly as it does today.
If anything ever goes wrong later, Part H turns the new system off in one edit.

> Menu names in Cloudflare, Telegram and Formspree may be worded slightly differently from
> this guide. If something doesn't match, describe what you see and I'll guide you.

---

## Part A — Phone alerts (Telegram) · with Noor

**On Noor's phone**
1. Install **Telegram** from the App Store / Google Play (free).
2. Sign up with her phone number, +1 (619) 504-2175.
3. In Telegram settings → Notifications, make sure notifications are on.

**On your phone or computer (Telegram)**
4. Search for **@BotFather** (blue check mark) and open it. Tap **Start**.
5. Send `/newbot`.
   - Name: `Blush Inquiries`
   - Username: must end in `bot`, e.g. `BlushInquiriesBot` (try variations if taken)
6. BotFather replies with a **token** like `123456789:AAH...`. This is a password:
   don't post it anywhere or send it in chat. You'll paste it into Cloudflare in Part D.
7. Optional, makes it look nicer: send `/setuserpic` to BotFather and upload the Blush "B" logo.

**Link Noor's phone to the bot**
8. On Noor's phone, open Telegram, search the bot's username, open it, tap **Start**,
   and send any message (e.g. "hi").
9. In a web browser, open this address (put your token in place of `TOKEN`):
   `https://api.telegram.org/botTOKEN/getUpdates`
10. Find `"chat":{"id":` followed by a number, e.g. `"chat":{"id":7123456789`.
    That number is **Noor's chat ID**. Write it down.
    (Empty result? Send the bot another message from Noor's phone and refresh.)

*Want alerts too?* Do step 8 from your own Telegram and note your chat ID as well.

## Part B — Spam check (Turnstile) · Cloudflare dashboard

1. Left menu → **Turnstile** → **Add widget**.
2. Name `Blush inquiries`, hostnames `blushsd.com` and `www.blushsd.com`, mode **Managed** → Create.
3. Note both keys:
   - **Site key** (public) — goes into the website file in Part F.
   - **Secret key** (private) — goes into Cloudflare in Part D. Don't share it.

## Part C — Database (D1) · Cloudflare dashboard

1. Left menu → **Storage & Databases** → **D1 SQL Database** → **Create**. Name: `blush-inquiries`.
2. Open it → **Console**. Paste the whole of `worker/schema.sql` → run it.
3. Check the table list shows `inquiries`.

## Part D — The Worker · Cloudflare dashboard

1. Left menu → **Workers & Pages** → **Create** → **Start with Hello World**.
2. Name it exactly `blush-inquiries` → **Deploy**.
3. **Edit code** → delete everything → paste the whole of `worker/index.js` → **Deploy**.
4. **Settings → Bindings → Add → D1 database**: variable name `DB`, database `blush-inquiries`.
5. **Settings → Variables and Secrets → Add**, one at a time:

| Type   | Name                 | Value |
|--------|----------------------|-------|
| Text   | `ALLOWED_ORIGINS`    | `https://blushsd.com,https://www.blushsd.com` |
| Text   | `IG_USERNAME`        | `blush.sd` |
| Text   | `RETENTION_DAYS`     | `365` |
| Text   | `TELEGRAM_CHAT_IDS`  | Noor's chat ID from Part A (add yours after a comma if you want alerts too: `7123456789, 5550001111`) |
| Secret | `TELEGRAM_BOT_TOKEN` | the bot token from Part A |
| Secret | `TURNSTILE_SECRET`   | the Turnstile secret key from Part B |
| Secret | `IP_HASH_SALT`       | any long random string, 32+ characters (a password generator works) |

6. **Settings → Trigger events → Add Cron Trigger**: `*/10 * * * *`
   (every 10 minutes it re-sends any alert that didn't go through and clears data older than a year).
7. Open `https://blush-inquiries.blushsd619.workers.dev/health` — you should see `{"ok":true}`.

## Part E — Email backup (Formspree) · formspree.io

The website now also sends each inquiry to Formspree in the background, so Noor still gets an email.

1. Log in to Formspree → open the form (`xqpkynop`) → **Settings**.
2. Turn **reCAPTCHA off** (background sending is blocked while it's on).
   Spam is still stopped by the Turnstile check and the hidden honeypot field.
3. Note: Formspree's free plan covers 50 submissions a month. Phone alerts and the database
   have no such limit, so nothing is lost if that's ever reached.

## Part F — Turn it on and upload · GitHub website

1. The switch is this line near the top of `assets/js/inquiry.js`:
   `var TURNSTILE_SITE_KEY = 'REPLACE_ME';` — the site key from Part B goes in place of `REPLACE_ME`.
2. Send Claude the Turnstile **site key** (it's public, safe to share) and it will make
   this edit and push it for you. All the other website files are already on GitHub.
3. Wait 1–2 minutes for GitHub Pages to update.

## Part G — Test it (do both forms)

On your phone, open the live **Book Florals** page and send a test inquiry with your own
name, email and phone number. Check each box:

- [ ] The Blush "Thank You" page appears with a reference number
- [ ] Noor's phone buzzes with the Telegram alert, details correct, phone number tappable
- [ ] The email arrives with "New Florals Inquiry BL-…" in the subject
- [ ] "Message Us on Instagram" shows the copied message and steps; "Open Instagram"
      opens a chat with @blush.sd and Paste works
- [ ] In Cloudflare → D1 → `blush-inquiries` → Console, run
      `SELECT reference, name, notified_at FROM inquiries;` and see your test with a
      `notified_at` time

Repeat with **Book Catering**. Then delete the test rows if you like:
`DELETE FROM inquiries WHERE email = 'your@email.com';`

**If the alert doesn't arrive:** re-check the chat ID and token, and that Noor tapped Start.
**If the email doesn't arrive:** re-check Part E (reCAPTCHA off).

## Part H — Turning it off (if ever needed)

Edit `assets/js/inquiry.js` on GitHub, put `REPLACE_ME` back as the site key, and commit.
The forms go straight back to working exactly as before (Formspree only).

---

### Private vs. public
- **Private (only in Cloudflare):** Telegram bot token, Turnstile secret key, IP hash salt, the database.
- **Public (fine on GitHub):** the Worker address, the Turnstile site key, every file in this package.
- There's no way to look up an inquiry from the website, so a reference number reveals nothing.

### Later: Phase 5 (Instagram matching)
Automatic matching of Instagram chats to inquiries needs Meta's App Review. The Instagram
button already includes the hidden matching code, so nothing on the website changes when
that's added; it's Worker-only work plus the Meta setup.
