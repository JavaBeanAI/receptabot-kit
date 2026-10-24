# ReceptaBot by JbAI — Setup Kit

ReceptaBot by JbAI was designed by JavaBeanAI. This kit gives you:

1. **An AI receptionist** that answers your phone line with xAI Grok Voice, takes messages ("For: <name>"), flags urgent calls, politely turns away telemarketers with a Do Not Call statement, and handles callers in other languages.
2. **A call bridge** that connects that phone line to the receptionist. It is a small program Cloudflare runs for you on the web (this kind of program is called a Worker).
3. **A Calls app**, if you want it. You can skip it and add it later.

Pick one path below: **Receptionist only**, or **Receptionist + Calls app**.

```
receptabot-kit/
├── README.md                       ← you are here
├── .env.example                    ← list of every secret you'll set
├── .gitignore
├── app/                            ← the Calls app (Cloudflare Worker + web page)
│   ├── wrangler.toml.example
│   ├── src/worker.js
│   └── public/ (index.html, sw.js, manifest, icons)
├── bridge/                         ← the call bridge (Cloudflare Worker)
│   ├── wrangler.toml.example
│   └── src/index.js, src/app.js
└── receptionist/
    ├── instructions-template.md    ← paste into your Grok Voice agent
    └── welcome-message.txt
```

---

## What is the Calls app?

The Calls app is a private web page. You open it on your phone or computer, and you can add it to your home screen like an app. A passcode keeps other people out.

It shows every message the receptionist took.

It also lets you call from your business number instead of your cell:

- **Call me first** rings your cell. You press 1, and it connects you to the person. They see your business number.
- **Have the AI call** lets the AI place a call for you and report back.
- **Connect me with** has the AI call someone, put you on hold with music, and connect you once they answer.

It sends and receives texts from the business number. It keeps Recent Calls, Favorites, recordings, transcripts, and costs.

You do not need the Calls app for the receptionist to work.

---

## What you need first

- A computer with **Node.js 22 or newer**. Go to nodejs.org and click the big **LTS** download button, then install it like any other program. To check, open a terminal and run `node -v`. You want v22 or a higher number.
- A **Cloudflare** account (the free plan works): dash.cloudflare.com
- A **Twilio** account with billing turned on: twilio.com
- An **xAI** account with API access: console.x.ai
- A small monthly budget for phone numbers, minutes, and texts. Check each provider's pricing page for current prices.
- Your **ReceptaBot** chat in Grok Bot, if you are doing Receptionist only. That chat is where messages show up when you skip the Calls app.

You'll copy a few values (IDs and keys) from these websites. Keep them in a private note. **Never put a key in a file you share or upload.**

First, get the kit: on https://github.com/JavaBeanAI/receptabot-kit click the green **Code** button, then **Download ZIP**. Double-click the ZIP to unpack it. The folder may be called `receptabot-kit-main`; that's fine.

Then open a terminal in that folder:

- **Mac:** open the **Terminal** app, type `cd ` (with a space), drag the folder into the window, and press Return.
- **Windows:** open the folder, click the address bar, type `powershell`, and press Enter.

A few words this guide uses:

- **E.164** means +1, then the 10 digits, with no spaces or dashes. Example: `+15555550100`.
- A **SIP address** is an internet address for phone calls. xAI shows it to you.
- A **webhook** is a web address that receives a call, a text, or a message.
- **KV** is a simple storage box where the Calls app keeps your messages. Receptionist only does not use it.

---

## Receptionist only

Use this path for one phone number and an AI that answers it. Messages show up in your ReceptaBot chat. You do not deploy the Calls app, and you do not set secrets yet.

The bridge can answer this line with its link to the app left off. Those link lines are the last three lines of `bridge/wrangler.toml` (`[[services]]`, `binding = "APP"`, and `service = ...`). Leave a `#` at the start of each one. The bridge then skips the app. Do not put a `#` on the lines above those three.

### 1. Buy one Twilio number

1. Sign in to console.twilio.com.
2. In the left menu, click **Phone Numbers → Manage → Buy a number**.
3. Search your area code, make sure **Voice** and **SMS** are both checked, and click **Buy**.
4. This number is your **receptionist line**. People call it and the AI answers.
5. Write it down in E.164 format.
6. On the Twilio Console home page, copy your **Account SID** (starts with `AC`) and **Auth Token** into your private note. You will not paste them into the bridge until you add the Calls app.

You can skip texting registration for now. Calls work without it. You will need it later if you add the Calls app and want texts to go through.

### 2. Create your Grok Voice receptionist

1. Sign in to console.x.ai and open **Voice → Agents → Create agent**.
2. Open `receptionist/instructions-template.md` in a text editor. Replace every `{{...}}` with your own details (business name, receptionist name, your name), delete the comment block at the top, and paste the rest into the agent's **Instructions** box.
3. Paste `receptionist/welcome-message.txt` (with your names filled in) into the **Welcome message** box.
4. Choose a voice. **Ara** is the default this kit uses.
5. Under **Phone / Telephony**, connect your receptionist number using xAI's Twilio/SIP option. Your SIP address (an internet address for phone calls; xAI shows it to you) looks like `sip:+15555550100@sip.voice.x.ai;transport=tls`. Write it down.

### 3. Deploy the call bridge

A Worker is a small program Cloudflare runs for you on the web. This step publishes the bridge and nothing else.

1. Sign in to Cloudflare from the terminal:
   ```
   npx wrangler login
   ```
   A browser window opens. Click **Allow**.
2. Find your **Account ID**: run `npx wrangler whoami`. It prints a table; copy the long code under **Account ID**.
3. Make the bridge config file from the template:
   ```
   cp bridge/wrangler.toml.example bridge/wrangler.toml
   ```
4. Open `bridge/wrangler.toml` in a text editor (TextEdit on Mac, Notepad on Windows). Fill in:
   - `name` — a short name for the bridge, such as `my-call-bridge` (letters, numbers, and dashes; no `<` or `>`).
   - `account_id` — the Account ID from the step above.
   - `RECEPTIONIST_NUMBER` — your receptionist number, in E.164 format.
   - `RECEPTIONIST_SIP` — the SIP address from step 2.
5. Put a `#` at the start of these three lines, then save:
   ```
   [[services]]
   binding = "APP"
   service = ...
   ```
   A `#` turns a line into a note, so the bridge does not look for an app. Leave every other line alone. You can leave the other `<...>` values until you add the Calls app.
6. Deploy the bridge:
   ```
   cd bridge
   npx wrangler deploy
   ```
   If this is your first Worker ever, Cloudflare may ask you to pick a **workers.dev subdomain** (any short name). Pick one and continue.
   The deploy prints a web address ending in `.workers.dev`. Save it. That is your bridge address.

### 4. Point the Twilio number at the bridge

A webhook here is the web address Twilio sends each call to.

In Twilio, go to **Phone Numbers → Manage → Active numbers** and click your receptionist number.

- If the xAI setup in step 2 already connected it, leave the voice settings alone.
- Otherwise, under **Voice → A call comes in**, choose **Webhook**, enter `https://<your-bridge>.workers.dev/inbound` with method **HTTP POST**, and click **Save**.

Before you change a number that's already in use, take a screenshot of its settings so you can put them back.

### 5. Send messages to your ReceptaBot

The bridge does not store the words the receptionist hears. Your ReceptaBot (a Grok Bot) does, through its message webhook. That webhook is a private web address that wakes the bot when a message arrives.

1. Open your ReceptaBot chat in Grok Bot. Ask it to add a webhook routine that receives receptionist messages and shows them in the chat.
2. On a computer, open that routine. Under **Webhook**, copy **POST to** and the **key**. The header to send is `Authorization: Bearer` plus that key.
3. If your xAI plan lets the voice agent call a web address (a tool or webhook), point it at **POST to**. Send the caller's name, callback number, who the message is for, the reason, and whether it is urgent.
4. When that address answers `200`, the bot accepted the message. Open the ReceptaBot chat to read it. `200` means the bot started, so give it a moment to reply in the chat.

If the voice agent cannot call a web address, ask your ReceptaBot to read new conversations from the xAI console and write the messages into the chat.

### 6. Forward missed calls from your cell

Your cell can send calls you miss, decline, or can't take to the receptionist number. Your phone still rings first. Follow [Forward your cell's missed calls to the receptionist](#forward-your-cells-missed-calls-to-the-receptionist).

### 7. Test

1. Open `https://<your-bridge>.workers.dev/health`. You should see `{"ok": true}`.
2. From another phone, call your receptionist number, leave a message, and say it's urgent. The AI should answer, take the message, and ask if there's anything else before saying goodbye.
3. Check your ReceptaBot chat for that message.

Always tell people before you place test calls to them.

---

## Receptionist + Calls app

Use this path when you want the receptionist and the Calls app together. You need two phone numbers.

### 1. Buy two Twilio phone numbers

1. Sign in to console.twilio.com.
2. In the left menu, click **Phone Numbers → Manage → Buy a number**.
3. Search your area code, make sure **Voice** and **SMS** are both checked, and click **Buy**.
4. Buy a second one the same way.
   - **Number A = receptionist line.** People call this one and the AI answers.
   - **Number B = app line.** The Calls app calls and texts from this one.
5. Write both numbers down in E.164 format (+1, then the 10 digits, no spaces or dashes), for example `+15555550100`.
6. On the Twilio Console home page, copy your **Account SID** (starts with `AC`) and **Auth Token** into your private note.

### 2. Register for texting (A2P 10DLC). Start now, because it takes days.

US carriers block business texts from numbers that aren't registered.

1. In Twilio, go to **Messaging → Regulatory Compliance → Onboarding** (also called "A2P 10DLC").
2. Create a **Customer Profile** (your business info), then a **Brand** registration.
3. Create a **Campaign**. Use case: "Customer care" or "Mixed". Describe how people agree to get texts from you, and include sample messages. Mention that people can reply STOP to opt out and START to opt back in. The bridge already handles both words.
4. Add **both** numbers to the campaign.
5. Wait. Approval usually takes **a few days, sometimes 1–3 weeks**. Calls work without it. Texts won't work reliably until it's approved.

### 3. Create your Grok Voice receptionist

1. Sign in to console.x.ai and open **Voice → Agents → Create agent**.
2. Open `receptionist/instructions-template.md` in a text editor. Replace every `{{...}}` with your own details (business name, receptionist name, your name), delete the comment block at the top, and paste the rest into the agent's **Instructions** box.
3. Paste `receptionist/welcome-message.txt` (with your names filled in) into the **Welcome message** box.
4. Choose a voice. **Ara** is the default this kit uses.
5. Under **Phone / Telephony**, connect **Number A** using xAI's Twilio/SIP option. Your SIP address (an internet address for phone calls; xAI shows it to you) looks like `sip:+15555550100@sip.voice.x.ai;transport=tls`. Write it down.
6. Go to **API Keys**, create a key, and save it in your private note. You'll use it as `XAI_API_KEY`.

### 4. Fill in the config files, then create storage

Do this from the kit folder you opened above.

1. Sign in to Cloudflare from the terminal:
   ```
   npx wrangler login
   ```
   A browser window opens. Click **Allow**.
2. Find your **Account ID**: run `npx wrangler whoami`. It prints a table; copy the long code under **Account ID**.
3. Make the config files from the templates:
   ```
   cp app/wrangler.toml.example app/wrangler.toml
   cp bridge/wrangler.toml.example bridge/wrangler.toml
   ```
4. Open both `wrangler.toml` files and fill in every `<...>` except the KV id (you get that in the next step):
   - Your Account ID, your first name, business name, receptionist name, the AI caller name, and both phone numbers (E.164 format).
   - The bridge's `APP_FROM` and `FROM_NUMBER` are Number B. `RECEPTIONIST_NUMBER` is Number A. `RECEPTIONIST_SIP` is the SIP address from step 3.
   - Pick a short name for each Worker (letters, numbers, and dashes). The app's `service` line must match the bridge's `name`, and the bridge's `service` line must match the app's `name`.
5. In `bridge/wrangler.toml`, put a `#` at the start of the last three lines (`[[services]]`, `binding = "APP"`, `service = ...`). Save. Those lines are the link to the app. The bridge has to go up once without that link, because the app does not exist yet.
6. Create the storage the app uses for messages. KV is a simple storage box. Your terminal must be in the kit folder, and the app's `name` must already be filled in (the command fails while the name still has `<...>` in it):
   ```
   cd app
   npx wrangler kv namespace create DB
   ```
   Copy the long `id` it prints and paste it in place of `<KV_NAMESPACE_ID>` in `app/wrangler.toml`. Save.

### 5. Deploy in three short steps

The app and bridge link to each other, so the bridge has to go up once without that link. Your terminal is inside the `app` folder from the last step.

1. Deploy the bridge, then the app:
   ```
   cd ../bridge
   npx wrangler deploy
   cd ../app
   npx wrangler deploy
   ```
2. Remove the three `#` marks you added in `bridge/wrangler.toml`, save, and deploy the bridge again:
   ```
   cd ../bridge
   npx wrangler deploy
   ```
3. If this is your first Worker ever, Cloudflare may ask you to pick a **workers.dev subdomain** (any short name). Pick one and continue.

Each deploy prints a web address ending in `.workers.dev`. Save both. The app's address is what you open on your phone.

### 6. Set the secrets

`.env.example` lists every secret.

`OWNER_CELL` is your own cell number in E.164 format. `APP_PASSCODE` is the passcode you will type to open the app. `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `XAI_API_KEY` are the values you copied from Twilio and xAI.

For `BRIDGE_TOKEN`, `INGEST_TOKEN`, and `SESSION_KEY` you need long random passwords. On Mac, run `openssl rand -hex 32`. On Windows, use any password generator set to 64 letters and numbers. Make each one once and keep it in your private note, because `BRIDGE_TOKEN` and `INGEST_TOKEN` get typed in twice. When `secret put` asks for a value, paste it and press Enter. Nothing shows as you type. That is normal.

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

### 7. Point the Twilio numbers at the bridge

A webhook is the web address Twilio sends each call or text to.

In Twilio, go to **Phone Numbers → Manage → Active numbers** and click a number.

- **Number A (receptionist)**: if the xAI setup in step 3 already connected it, leave it alone. Otherwise, under **Voice → A call comes in**, choose **Webhook**, enter `https://<your-bridge>.workers.dev/inbound` with method **HTTP POST**, and click **Save**.
- **Number B (app line)**:
  - Voice → A call comes in → Webhook: `https://<your-bridge>.workers.dev/a/voice` (HTTP POST)
  - Messaging → A message comes in → Webhook: `https://<your-bridge>.workers.dev/a/sms` (HTTP POST)
  - Click **Save configuration**.

Before you change a number that's already in use, take a screenshot of its settings so you can put them back.

### 8. Send receptionist messages to the app

The bridge adds outgoing calls, texts, and callbacks to the app on its own. Messages the receptionist takes on incoming calls are not in the bridge. Point the voice agent's tool or webhook at the app, using the steps in **How messages get into the app** below.

### 9. Forward missed calls from your cell

Your cell can send calls you miss, decline, or can't take to Number A, the receptionist number. Your phone still rings first. Follow [Forward your cell's missed calls to the receptionist](#forward-your-cells-missed-calls-to-the-receptionist).

### 10. Test

1. Open `https://<your-bridge>.workers.dev/health`. You should see `{"ok": true}`.
2. Open the app address on your phone, enter your passcode, and add it to your home screen.
3. **Receptionist:** from another phone, call Number A, leave a message, and say it's urgent. Then check that the AI answered, took the message, and asked if there's anything else before saying goodbye.
4. **Call me first:** in the app, tap Call, enter a friend's number, and choose **Call me first**. Your cell rings and you hear "Hi <name>, I'm ready to connect your call to… Press 1 to connect." Press 1. If you don't press 1 within 8 seconds, the call is canceled.
5. **Have the AI call** and **Connect me with…**: try each one with a friend who knows a test call is coming.
6. **Texting:** send a text from the app. Have your friend reply **STOP**: the number should show up on the do-not-contact list. Then have them reply **START**.
7. **Callback:** have your friend call Number B. Your cell rings for 20 seconds, then the receptionist answers.

Always tell people before you place test calls or texts to them.

---

## Add the Calls app later

Start here if the receptionist is already working and you now want the Calls app. Your bridge is already deployed, with the three app-link lines still turned off (`#` at the start).

1. Buy a second Twilio number the same way as the first. This is **Number B**, the app line. Keep your receptionist number as Number A. Write Number B in E.164 format.
2. If you want texts, start **A2P 10DLC** now (see step 2 under Receptionist + Calls app). Add **both** numbers to the campaign. Calls work while you wait. Texts wait until it is approved.
3. Open a terminal in the kit folder (the same folder as the first time).
4. Open `bridge/wrangler.toml`. Set `APP_FROM` and `FROM_NUMBER` to Number B. Leave the three `#` lines in place until the app deploy below has finished. The bridge can link to the app only after the app exists.
5. Make the app config and fill it in, except the KV id:
   ```
   cp app/wrangler.toml.example app/wrangler.toml
   ```
   Fill in your Account ID, names, Number B, and the bridge's `name` on the app's `service` line. Pick a short `name` for the app.
6. Create storage, then deploy the app. From the kit folder:
   ```
   cd app
   npx wrangler kv namespace create DB
   ```
   Copy the long `id` it prints and paste it in place of `<KV_NAMESPACE_ID>` in `app/wrangler.toml`. Save. Then:
   ```
   npx wrangler deploy
   ```
   Save the app address (it ends in `.workers.dev`).
7. Turn the bridge link back on. In `bridge/wrangler.toml`, remove the three `#` marks. Set that `service` line to the app's `name`. Save, and deploy the bridge again:
   ```
   cd ../bridge
   npx wrangler deploy
   ```
8. Set the secrets. Use the same list as step 6 under Receptionist + Calls app, including the random passwords and the note that pasted values do not show as you type. Set them on the bridge and on the app. `BRIDGE_TOKEN`, `INGEST_TOKEN`, and `OWNER_CELL` must match in both places. You also need `XAI_API_KEY` from console.x.ai if you did not create one yet.
9. Point **Number B** at the bridge:
   - Voice → A call comes in → Webhook: `https://<your-bridge>.workers.dev/a/voice` (HTTP POST)
   - Messaging → A message comes in → Webhook: `https://<your-bridge>.workers.dev/a/sms` (HTTP POST)
   Leave Number A as it is.
10. Switch message delivery to the app, or send to both places.
   - **App:** point the voice agent tool at `https://<your-app>.workers.dev/api/messages` with `Authorization: Bearer` and your `INGEST_TOKEN`. Details are in **How messages get into the app**.
   - **Both:** if the tool can call two addresses, keep the ReceptaBot webhook and also call the app address. The Calls app then shows the message, and your ReceptaBot chat still gets it.
11. Open the app on your phone, enter the passcode, and add it to your home screen. Then run the tests in step 10 under Receptionist + Calls app.

---

## Forward your cell's missed calls to the receptionist

This sends calls you miss, decline, or can't take (your phone is off, or it has no signal) on your existing cell to your receptionist's Twilio number. Callers reach the receptionist instead of your voicemail. Your cell still rings first, so you can answer when you want to.

This is not "send every call." Do not turn on a setting that forwards all calls. If you do, your cell will not ring at all.

Use the receptionist number you bought above (Number A if you have two numbers). You will need its 10 digits. Some codes also want a `1` in front of those 10 digits.

Turning this on usually costs nothing extra, but a forwarded call can still count on your plan the way a normal call does. Check your plan. [Verizon](https://www.verizon.com/support/call-forwarding-faqs/) says most plans have no monthly fee, and some older plans do. If you do not have unlimited minutes, Verizon bills the forwarded call as if you answered it. [AT&T](https://www.att.com/support/article/wireless/KM1011513/) bills the length of the forwarded call, and long distance or roaming can apply.

### T-Mobile

You may see `**004*` plus the number as one code for every missed-call case. T-Mobile's [short-code list](https://www.t-mobile.com/support/plans-features/self-service-short-codes) does not publish that turn-on code. Dial these three codes, one at a time, and press Call after each. If the receptionist number's 10 digits were `5555550100`, the first code would be `**61*15555550100#`.

- You don't answer: `**61*1` + the 10 digits + `#`
- Your line is busy: `**67*1` + the 10 digits + `#`. T-Mobile describes this as when you are already on a call. They do not list a separate code for when you decline.
- Phone is off or has no signal: `**62*1` + the 10 digits + `#`

To put those three back to T-Mobile's usual setting (often voicemail), dial `##004#` and press Call. T-Mobile's [calling troubleshooting page](https://www.t-mobile.com/support/devices/device-troubleshooting/cant-call-dropped-calls-and-other-calling-issues) says that resets busy, unreachable, and no-answer forwarding. It does not turn off "forward every call." To turn off just one of the three, dial `##61#`, `##67#`, or `##62#`.

Do not dial `**21*` plus the number. That forwards every call, and your phone will not ring. If you turned that on, dial `##21#` to turn it off.

Some plans do not support every short code. If a code does nothing, check T-Mobile's page or call them.

### AT&T

AT&T's wireless help does not publish the T-Mobile codes above. The dial code on AT&T's [call forwarding article](https://www.att.com/device-support/article/147973/) forwards every call: dial `*21*`, then the 10-digit number, then `#` (their example looks like `*21*1234567890#`). Dial `#21#` to turn that off. Do not use it for this. Your cell would stop ringing.

On many phones, AT&T's [device steps](https://www.att.com/device-support/article/140337/) show separate choices. Use these three, and enter the receptionist number for each:

- **When unanswered** — you don't pick up
- **When busy** — you are already on a call
- **When unreachable** — the phone is off, in airplane mode, or has no signal

Do not turn on **Always forward**. That sends every call away.

AT&T says you can change this only from the phone, not on the website. More is on their [call forwarding page](https://www.att.com/support/article/wireless/KM1011513/). If your phone does not show those three choices, check that page or call AT&T.

### Verizon

Verizon's missed-call feature is called conditional call forwarding (no answer / busy). From your Verizon cell, dial `*71` and then the 10-digit receptionist number, with no `1` in front, and press Call. If that number were `5555550100`, you would dial `*715555550100`. Wait for the beeps and let the call end by itself.

Verizon says this sends the call on when you are busy or you do not answer after about 3 to 6 rings, instead of voicemail. Their page does not list a separate code for a phone that is off or has no signal. If you need that case, check [Verizon's turn-on page](https://www.verizon.com/support/knowledge-base-181139/) or call Verizon.

Verizon also says you can turn on this no-answer/busy forwarding in the My Verizon app. Steps are in [Verizon's call forwarding article](https://www.verizon.com/articles/verizon-unlimited-plans/call-forwarding-everything-you-need-to-know/).

Do not dial `*72`. That forwards every call, and your phone will not ring.

To turn forwarding off, dial `*73` and wait for the confirmation. Details are on [Verizon's turn-off page](https://www.verizon.com/support/knowledge-base-17268/) and the [call forwarding FAQs](https://www.verizon.com/support/call-forwarding-faqs/).

### Other carriers, or a prepaid phone

Check that carrier's call forwarding help page, or call them. Ask for forwarding when you do not answer, when you are busy or you decline, and when the phone is off or has no signal. Ask them not to forward every call.

### iPhone

On an iPhone, **Settings > Phone > Call Forwarding** forwards all calls. On a newer iPhone the same switch is under **Settings > Apps > Phone > Call Forwarding**. That is not what you want: your cell would not ring. Apple's [call forwarding guide](https://support.apple.com/guide/iphone/set-up-call-forwarding-iph7405291c4/ios) says to ask your carrier if you want forwarding only when the line is busy or not in service. Use the carrier steps above instead of that switch.

### Try it

From another phone, call your cell and decline. The receptionist should answer, not your voicemail. Then call your cell and answer, to confirm your phone still rings.

---

## How messages get into the app

Use this with **Receptionist + Calls app**, or after **Add the Calls app later**. Receptionist only uses your ReceptaBot webhook instead.

The bridge adds outgoing calls, texts, and callbacks to the app on its own. Messages your **receptionist** takes on incoming calls must be sent to the app's message address:

```
POST https://<your-app>.workers.dev/api/messages
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json
User-Agent: anything-custom/1.0      (recommended: some tools' default user agents get blocked)

{"name":"Jane Doe","callback":"+15555551234","reason":"Wants a quote",
 "details":"For: Sam — full message…","urgency":"urgent|normal","language":"English",
 "time":"2026-01-01T10:00:00-05:00","conversation_id":"<xAI conversation id, optional>"}
```

- Add `"line":"team"` and `"for":"<name>"` to put a message in **Team Messages**.
- Sending the same `id` again updates the existing entry.
- `DELETE /api/messages/<id>` with the same token removes an entry.

You can send messages this way with a tool or webhook on your Grok Voice agent (if your xAI plan offers one). To also notify your ReceptaBot, send the same message to that bot's webhook.

## Settings you can change later (in `bridge/wrangler.toml`, then `npx wrangler deploy`)

These limits apply when the Calls app places calls and texts. The receptionist can still answer incoming calls.

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

---

## License

Free to use and modify, including in your own business, but you may not resell it. See LICENSE (MIT with Commons Clause).

## Need help?

Questions, or want a guided "set up with you" session (remote or in person)? Email receptabot@agentmail.to.
