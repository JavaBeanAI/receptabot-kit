# AI Receptionist + Calls App — Setup Kit

This kit gives you:

1. **An AI receptionist** that answers your phone line with xAI Grok Voice, takes messages ("For: <name>"), flags urgent calls, politely turns away telemarketers with a Do Not Call statement, and handles callers in other languages.
2. **A private Calls app** (works on phone and computer, can be added to your home screen):
   - Passcode sign-in
   - A message list, with a separate **Team Messages** section
   - A **Call screen** with three ways to call: **Call me first** (your cell rings, press 1, you're connected), **Have the AI call** (the AI makes the call for you, or you talk to it first), and **Connect me with…** (the AI calls you, puts you on hold with music, calls the other person, and connects you)
   - Texting, **Recent Calls** and **Favorites** dropdowns, call recordings, transcripts, and costs
3. **A call bridge** that sits between Twilio and Grok Voice. It sends incoming calls to your receptionist and places outgoing calls. Its safety rules: STOP/START do-not-contact, calling hours (8am–9pm by default), US numbers only, a monthly budget cap with a warning at 80%, and callbacks to the app number ring your cell for 20 seconds before going to the receptionist.

```
receptionist-kit/
├── README.md                       ← you are here
├── .env.example                    ← list of every secret you'll set
├── .gitignore
├── app/                            ← the Calls app (Cloudflare Worker + web page)
│   ├── wrangler.toml.example
│   ├── src/worker.js
│   └── public/ (index.html, sw.js, manifest, icons)
├── bridge/                         ← the call bridge (Cloudflare Worker + Durable Object)
│   ├── wrangler.toml.example
│   └── src/index.js, src/app.js
└── receptionist/
    ├── instructions-template.md    ← paste into your Grok Voice agent
    └── welcome-message.txt
```

---

## What you need first

- A computer with **Node.js 20 or newer** (download it from nodejs.org).
- A **Cloudflare** account (the free plan works): dash.cloudflare.com
- A **Twilio** account with billing turned on: twilio.com
- An **xAI** account with API access: console.x.ai
- About $5–$25 a month for phone numbers, minutes, and texts.

You'll copy a few values (IDs and keys) from these websites. Keep them in a private note. **Never put a key in a file you share or upload.**

---

## Step 1 — Buy two Twilio phone numbers

1. Sign in to console.twilio.com.
2. In the left menu, click **Phone Numbers → Manage → Buy a number**.
3. Search your area code, make sure **Voice** and **SMS** are both checked, and click **Buy**.
4. Buy a second one the same way.
   - **Number A = receptionist line.** People call this one and the AI answers.
   - **Number B = app line.** The Calls app calls and texts from this one.
5. Write both numbers down in the +1 format, for example `+15555550100`.
6. On the Twilio Console home page, copy your **Account SID** (starts with `AC`) and **Auth Token** into your private note.

## Step 2 — Register for texting (A2P 10DLC). Start now, because it takes days.

US carriers block business texts from numbers that aren't registered.

1. In Twilio, go to **Messaging → Regulatory Compliance → Onboarding** (also called "A2P 10DLC").
2. Create a **Customer Profile** (your business info), then a **Brand** registration.
3. Create a **Campaign**. Use case: "Customer care" or "Mixed". Describe how people agree to get texts from you, and include sample messages. Mention that people can reply STOP to opt out and START to opt back in. The bridge already handles both words.
4. Add **both** numbers to the campaign.
5. Wait. Approval usually takes **a few days, sometimes 1–3 weeks**. Calls work without it. Texts won't work reliably until it's approved.

## Step 3 — Create your Grok Voice receptionist

1. Sign in to console.x.ai and open **Voice → Agents → Create agent**.
2. Open `receptionist/instructions-template.md` in a text editor. Replace every `{{...}}` with your own details (business name, receptionist name, your name), delete the comment block at the top, and paste the rest into the agent's **Instructions** box.
3. Paste `receptionist/welcome-message.txt` (with your names filled in) into the **Welcome message** box.
4. Choose a voice. **Ara** is the default this kit uses.
5. Under **Phone / Telephony**, connect **Number A** using xAI's Twilio/SIP option. Your SIP address looks like `sip:+15555550100@sip.voice.x.ai;transport=tls`. Write it down.
6. Go to **API Keys**, create a key, and save it in your private note. You'll use it as `XAI_API_KEY`.

## Step 4 — Deploy the two Workers to Cloudflare

Open Terminal (Mac) or PowerShell (Windows) in the `receptionist-kit` folder.

1. Sign in to Cloudflare from the terminal:
   ```
   npx wrangler login
   ```
   A browser window opens. Click **Allow**.
2. Find your **Account ID**: in dash.cloudflare.com, click **Workers & Pages**. It's shown on the right side of that page.
3. Make the config files from the templates:
   ```
   cp app/wrangler.toml.example app/wrangler.toml
   cp bridge/wrangler.toml.example bridge/wrangler.toml
   ```
4. Create the storage the app uses for messages:
   ```
   cd app
   npx wrangler kv namespace create DB
   ```
   Copy the `id` it prints into `app/wrangler.toml`.
5. Open both `wrangler.toml` files and fill in every `<...>`:
   - Account ID, names, and both phone numbers.
   - The bridge's `APP_FROM` and `FROM_NUMBER` are Number B. `RECEPTIONIST_NUMBER` is Number A. `RECEPTIONIST_SIP` is the SIP address from Step 3.
   - Pick a name for each Worker. The app's `[[services]] service` must match the bridge's `name`, and the bridge's must match the app's `name`.
6. Deploy the bridge first, then the app:
   ```
   cd ../bridge && npx wrangler deploy
   cd ../app && npx wrangler deploy
   ```
   (The first deploy of each may warn that the other Worker doesn't exist yet. Deploy both, then deploy the bridge once more.)
   Each deploy prints a web address ending in `.workers.dev`. Save both. The app's address is what you open on your phone.

## Step 5 — Set the secrets

`.env.example` lists every secret. Make the random ones with `openssl rand -hex 32` (Mac), or any password generator that gives 64 random letters and numbers.

From the `bridge` folder, run each line and paste the value when it asks:
```
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN
npx wrangler secret put XAI_API_KEY
npx wrangler secret put BRIDGE_TOKEN
npx wrangler secret put INGEST_TOKEN
npx wrangler secret put OWNER_CELL
```
From the `app` folder:
```
npx wrangler secret put APP_PASSCODE
npx wrangler secret put SESSION_KEY
npx wrangler secret put BRIDGE_TOKEN
npx wrangler secret put INGEST_TOKEN
npx wrangler secret put OWNER_CELL
```
`BRIDGE_TOKEN`, `INGEST_TOKEN`, and `OWNER_CELL` must be **the same** in both places.

## Step 6 — Point the Twilio numbers at the bridge

In Twilio, go to **Phone Numbers → Manage → Active numbers** and click a number.

- **Number A (receptionist)**: if the xAI setup in Step 3 already connected it, leave it alone. Otherwise, under **Voice → A call comes in**, choose **Webhook**, enter `https://<your-bridge>.workers.dev/inbound` with method **HTTP POST**, and click **Save**.
- **Number B (app line)**:
  - Voice → A call comes in → Webhook: `https://<your-bridge>.workers.dev/a/voice` (HTTP POST)
  - Messaging → A message comes in → Webhook: `https://<your-bridge>.workers.dev/a/sms` (HTTP POST)
  - Click **Save configuration**.

Before you change a number that's already in use, take a screenshot of its settings so you can put them back.

## Step 7 — Test

1. Open `https://<your-bridge>.workers.dev/health`. You should see `{"ok": true}`.
2. Open the app address on your phone, enter your passcode, and add it to your home screen.
3. **Receptionist:** from another phone, call Number A, leave a message, and say it's urgent. Then check that the AI answered, took the message, and asked if there's anything else before saying goodbye.
4. **Call me first:** in the app, tap Call, enter a friend's number, and choose **Call me first**. Your cell rings and you hear "Hi <name>, I'm ready to connect your call to… Press 1 to connect." Press 1. If you don't press 1 within 8 seconds, the call is canceled.
5. **Have the AI call** and **Connect me with…**: try each one with a friend who knows a test call is coming.
6. **Texting:** send a text from the app. Have your friend reply **STOP**: the number should show up on the do-not-contact list. Then have them reply **START**.
7. **Callback:** have your friend call Number B. Your cell rings for 20 seconds, then the receptionist answers.

Always tell people before you place test calls or texts to them.

---

## How messages get into the app

The bridge adds outgoing calls, texts, and callbacks to the app on its own. Messages your **receptionist** takes on incoming calls must be sent to the app's ingest address:

```
POST https://<your-app>.workers.dev/api/messages
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json
User-Agent: anything-custom/1.0      (needed: Cloudflare blocks some default user agents)

{"name":"Jane Doe","callback":"+15555551234","reason":"Wants a quote",
 "details":"For: Sam — full message…","urgency":"urgent|normal","language":"English",
 "time":"2026-01-01T10:00:00-05:00","conversation_id":"<xAI conversation id, optional>"}
```
- Add `"line":"team"` and `"for":"<name>"` to put a message in **Team Messages**.
- Sending the same `id` again updates the existing entry.
- `DELETE /api/messages/<id>` with the same token removes an entry.

You can send messages this way with a tool or webhook on your Grok Voice agent (if your xAI plan offers one), a small scheduled script that reads new conversations from the xAI console API, or an AI assistant routine.

## Settings you can change later (in `bridge/wrangler.toml`, then `npx wrangler deploy`)

| Setting | What it does | Default |
|---|---|---|
| `AI_VOICE` | Voice for AI calls and spoken lines | `ara` |
| `CALL_HOURS_START` / `CALL_HOURS_END` | No outgoing calls outside these hours (local time) | 8 / 21 |
| `TIMEZONE` | Time zone for hours and budget months | America/New_York |
| `MAX_MONTH_USD` | Monthly spending cap (warning at 80%) | 20 |
| `MAX_CALLS_DAY` | Daily call limit | 10 |
| `HEADSUP_SMS` | `on` = text your cell about replies and the budget warning | off |

## Safety notes

- Keep `wrangler.toml` and `.env` out of any shared repo. `.gitignore` already excludes them.
- The bridge checks Twilio's signature on the app-line webhooks, so strangers can't fake calls or texts to it.
- The receptionist and AI caller both tell people the call is recorded. Check your state's recording-consent laws.
- Calls are limited to US numbers by design.
- Cost estimates in the app are rough (Grok Voice about $0.095/min, Twilio voice about $0.014/min, texts about $0.0083 each). Check your real bills.
