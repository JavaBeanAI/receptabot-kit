// Calls-app features on the app number (APP_FROM): call me first, have the AI call, talk to the AI,
// connect me with, texting, inbound callbacks + texts, do-not-contact, calling hours, monthly budget.
// All names/numbers come from env vars (see wrangler.toml.example); configure(env) loads them.
export let APP_FROM = "", OWNER_CELL_NUM = "", TEAM_SIP = "", OWNER = "Owner", BIZ = "", AI = "AI caller", TZ = "America/New_York", OPEN_H = 8, CLOSE_H = 21, RECEPTION_NUM = "";
export function configure(E) { APP_FROM = E.APP_FROM || ""; OWNER_CELL_NUM = E.OWNER_CELL || ""; TEAM_SIP = E.RECEPTIONIST_SIP || ""; OWNER = E.OWNER_NAME || "Owner"; BIZ = E.BUSINESS_NAME || ""; AI = E.AI_CALLER_NAME || "AI caller"; TZ = E.TIMEZONE || "America/New_York"; OPEN_H = +(E.CALL_HOURS_START || 8); CLOSE_H = +(E.CALL_HOURS_END || 21); RECEPTION_NUM = E.RECEPTIONIST_NUMBER || ""; }
const FOR = () => BIZ ? ` at ` : OWNER;
const AI_RATE = 0.095, LEG_RATE = 0.014, SMS_RATE = 0.0083, ALERT_AT = 0.8;
const BYE = "No problem, I'll cancel the call. Goodbye.", NOTICE = "This call is recorded.";
const HOLD = "http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical";
const xml = (s) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${s}</Response>`, { headers: { "Content-Type": "text/xml" } });
const x = (s) => String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
export const fmt = (n) => { const d = String(n || "").replace(/\D/g, "").replace(/^1/, ""); return d.length === 10 ? `${d.slice(0,3)} ${d.slice(3,6)} ${d.slice(6)}` : n; };
export const digits = (n) => { const d = String(n || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, ""); return d.length === 10 ? [d.slice(0,3), d.slice(3,6), d.slice(6)].map((g) => g.split("").join(" ")).join(", ") : d.split("").join(" "); };
export const toE164 = (n) => { const d = String(n || "").replace(/\D/g, ""); return d.length === 10 ? "+1" + d : d.length === 11 && d[0] === "1" ? "+" + d : ""; };
const STOPW = /^(stop|stopall|unsubscribe|cancel|end|quit|revoke|optout|opt out)$/i, STARTW = /^(start|unstop|yes)$/i;
function et() { const d = new Date(); const g = (o) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, ...o }).format(d);
  return { day: g({ year: "numeric", month: "2-digit", day: "2-digit" }), month: g({ year: "numeric", month: "2-digit" }),
    hour: +new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(d) }; }
const tw = (E, path, params, method = "POST") => fetch(`https://api.twilio.com/2010-04-01/Accounts/${E.TWILIO_ACCOUNT_SID}${path}`,
  { method, headers: { Authorization: "Basic " + btoa(`${E.TWILIO_ACCOUNT_SID}:${E.TWILIO_AUTH_TOKEN}`) }, body: params ? new URLSearchParams(params) : undefined });

// Twilio webhook signature check (HMAC-SHA1 of URL + sorted POST params, keyed by auth token)
export async function twilioSigOk(req, E, url, form) {
  const sig = req.headers.get("x-twilio-signature") || ""; if (!sig || !E.TWILIO_AUTH_TOKEN) return false;
  let data = url; for (const k of [...new Set([...form.keys()])].sort()) for (const v of form.getAll(k)) data += k + v;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(E.TWILIO_AUTH_TOKEN), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)))));
  if (mac.length !== sig.length) return false; let r = 0; for (let i = 0; i < mac.length; i++) r |= mac.charCodeAt(i) ^ sig.charCodeAt(i); return r === 0;
}

export class AppLine {
  constructor(hub) { this.h = hub; this.E = hub.env; }
  // ---------- AI voice (xAI TTS, default "ara") for spoken lines, cached in DO storage; Polly.Joanna fallback ----------
  async ttsKey(text) { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode((this.E.AI_VOICE || "ara") + "|" + text)); return [...new Uint8Array(h)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join(""); }
  tts(text) { // returns promise of key or null; dedupes in-flight work
    this.h.ttsP = this.h.ttsP || new Map();
    const run = async () => { const k = await this.ttsKey(text);
      if (await this.h.state.storage.get(`tts:${k}`)) return k;
      if (this.h.ttsP.has(k)) return this.h.ttsP.get(k);
      const pr = (async () => { try { const t0 = Date.now();
        const r = await fetch("https://api.x.ai/v1/tts", { method: "POST", headers: { Authorization: `Bearer ${this.E.XAI_API_KEY}`, "content-type": "application/json" },
          body: JSON.stringify({ text, voice_id: (this.E.AI_VOICE || "ara"), language: "en", output_format: { codec: "mp3", sample_rate: 22050, bit_rate: 64000 } }) });
        if (!r.ok || !(r.headers.get("content-type") || "").includes("audio")) { console.error("tts", r.status); return null; }
        const buf = new Uint8Array(await r.arrayBuffer()); if (buf.length < 1000 || buf.length > 1800000) return null;
        await this.h.state.storage.put(`tts:${k}`, buf); this.h.lastTtsMs = Date.now() - t0; return k; } catch (e) { console.error("tts", e); return null; } finally { this.h.ttsP.delete(k); } })();
      this.h.ttsP.set(k, pr); return pr; };
    return run();
  }
  async say(text, host, waitMs = 0) { // <Play> the xAI voice if ready (optionally wait), else <Say> Joanna and warm the cache
    const pr = this.tts(text);
    const k = await Promise.race([pr, new Promise((r) => setTimeout(() => r(null), waitMs))]);
    return k ? `<Play>https://${host}/a/tts/${k}.mp3</Play>` : `<Say voice="Polly.Joanna">${x(text)}</Say>`;
  }
  async spend() { const p = et(), log = await this.h.get("call-log", { calls: [] }), t = await this.h.get("text-log", { texts: [] });
    return log.calls.filter((c) => c.month === p.month).reduce((s, c) => s + (c.est_cost || 0), 0) + t.texts.filter((c) => c.month === p.month).reduce((s, c) => s + (c.est_cost || 0), 0); }
  async budget() { const s = await this.spend(), cap = +this.E.MAX_MONTH_USD || 20;
    return { spent: +s.toFixed(2), cap, alert: s >= cap * ALERT_AT, over: s >= cap }; }
  // checks for the OTHER person (the owner's own cell is never checked)
  async check(to, { ai = false, text = false } = {}) {
    if (!/^\+1[2-9]\d{9}$/.test(to)) return "US numbers only";
    if (to === APP_FROM || (RECEPTION_NUM && to === RECEPTION_NUM)) return "That's one of our own lines";
    const dnc = await this.h.get("do-not-call", { numbers: [] });
    if ((dnc.numbers || []).includes(to)) return "That number is on the do-not-contact list";
    const h = et().hour; if (h < OPEN_H || h >= CLOSE_H) return `Outside calling hours (${OPEN_H}:00–${CLOSE_H}:00 local time)`;
    const b = await this.budget(), need = text ? SMS_RATE : (ai ? 5 * AI_RATE : 5 * LEG_RATE * 2);
    if (b.spent + need > b.cap) return `Monthly budget reached ($${b.spent.toFixed(2)} of $${b.cap})`;
    const log = await this.h.get("call-log", { calls: [] });
    if (!text && log.calls.filter((c) => c.day === et().day).length >= +this.E.MAX_CALLS_DAY + 10) return "Daily call limit reached";
    return null;
  }
  async logCall(entry) { const p = et(), log = await this.h.get("call-log", { calls: [] });
    log.calls.push({ day: p.day, month: p.month, started: new Date().toISOString(), status: "placed", app: true, ...entry }); await this.h.put("call-log", log); }
  async post(entry) { // to the the receptionist Calls app (service binding), never throws
    if (!this.E.APP || !this.E.INGEST_TOKEN) return;
    try { await this.E.APP.fetch("https://app.internal/api/messages", { method: "POST",
      headers: { authorization: `Bearer ${this.E.INGEST_TOKEN}`, "content-type": "application/json", "user-agent": "call-bridge/1.0" }, body: JSON.stringify(entry) }); } catch (e) { console.error("post", e); }
  }
  async smsOwner(body) { // heads-ups to the owner; off until the owner OKs a test (HEADSUP_SMS="on")
    if (this.E.HEADSUP_SMS !== "on") return false;
    const r = await tw(this.E, "/Messages.json", { From: APP_FROM, To: OWNER_CELL_NUM, Body: body.slice(0, 600) }); return r.ok; }
  async budgetAlert() { const b = await this.budget(), p = et(), k = `budget-alert-${p.month}`;
    if (b.alert && !(await this.h.get(k, false))) { await this.h.put(k, true);
      await this.post({ id: `budget-${p.month}`, line: "alert", name: "Spending alert", reason: `Calling and texting are at $${b.spent.toFixed(2)} of the $${b.cap} monthly budget.`, urgency: "urgent", time: new Date().toISOString() });
      await this.smsOwner(`calling/texting spend is $${b.spent.toFixed(2)} of your $${b.cap} monthly budget.`); } }

  // ---------- public API (bearer-protected; called by the app worker) ----------
  async api(req, url, host) {
    const b = await req.json().catch(() => ({})), E = this.E, dry = !!b.dry_run;
    if (url.pathname === "/app/warm") return json(await this.warm());
    if (url.pathname === "/app/state") return json({ budget: await this.budget(), dnc: (await this.h.get("do-not-call", { numbers: [] })).numbers, from: APP_FROM, headsup_sms: E.HEADSUP_SMS === "on" });
    if (url.pathname === "/app/dnc") { const d = await this.h.get("do-not-call", { numbers: [] }), n = toE164(b.number); if (!n) return json({ error: "bad number" }, 400);
      d.numbers = (d.numbers || []).filter((v) => v !== n); if (b.add !== false) d.numbers.push(n); await this.h.put("do-not-call", d); return json({ ok: true, dnc: d.numbers }); }
    if (url.pathname === "/app/text") {
      const to = toE164(b.to), body = String(b.body || "").trim().slice(0, 1200); if (!to || !body) return json({ error: "Need a number and a message" }, 400);
      const why = await this.check(to, { text: true }); if (why) return json({ error: why }, 403);
      const segs = Math.ceil(body.length / 153) || 1, cost = +(segs * SMS_RATE).toFixed(4);
      if (dry) return json({ ok: true, dry_run: true, would: { from: APP_FROM, to, chars: body.length, segments: segs, est_cost: cost } });
      const r = await tw(E, "/Messages.json", { From: APP_FROM, To: to, Body: body, StatusCallback: `https://${host}/a/smsstatus` }), j = await r.json();
      if (!r.ok) return json({ error: j.message || "Twilio error" }, 502);
      const p = et(), t = await this.h.get("text-log", { texts: [] }); t.texts.push({ sid: j.sid, to, dir: "out", month: p.month, day: p.day, est_cost: cost, time: new Date().toISOString() }); await this.h.put("text-log", t);
      await this.post({ id: `sms-${j.sid}`, line: "text", direction: "outgoing", name: `Text to ${fmt(to)}`, to, callback: to, details: body, est_cost: cost, sid: j.sid, status: j.status, time: new Date().toISOString() });
      await this.budgetAlert(); return json({ ok: true, sid: j.sid });
    }
    if (url.pathname !== "/app/call") return json({ error: "not found" }, 404);
    const mode = b.mode, to = toE164(b.to), name = String(b.name || "").slice(0, 120), why_txt = String(b.instructions || "").trim().slice(0, 4000);
    if (!["me-first", "ai-call", "talk", "connect"].includes(mode)) return json({ error: "bad mode" }, 400);
    if (mode !== "talk" && !to) return json({ error: "Need a number" }, 400);
    if (mode === "ai-call" && !why_txt) return json({ error: `Tell ${AI} what the call is about` }, 400);
    if (to) { const why = await this.check(to, { ai: mode !== "me-first" }); if (why) return json({ error: why }, 403); }
    else { const bd = await this.budget(); if (bd.over) return json({ error: "Monthly budget reached" }, 403); }
    const plan = { mode, to, name, instructions: why_txt };
    if (dry) return json({ ok: true, dry_run: true, plan, steps: this.describe(plan), twiml: mode === "me-first" ? await this.meFirstTwiml(host, "DRYRUN", to, name, 4000) : null, tts_ms: this.h.lastTtsMs ?? null, budget: await this.budget() });
    return json(await this.start(plan, host));
  }
  describe({ mode, to, name }) { const who = name || fmt(to) || "the person you name";
    return { "me-first": [`Your cell ${fmt(OWNER_CELL_NUM)} rings from ${fmt(APP_FROM)}`, `You hear "Hi ${OWNER}, I'm ready to connect your call to ${who}. Press 1 to connect."`, `You press 1 (no key in 8 seconds: "No problem, I'll cancel the call. Goodbye.")`, `${who} is dialed from ${fmt(APP_FROM)}; they hear "This call is recorded"`, "You're connected; the call is recorded"],
      "ai-call": [`${AI} calls ${who} from ${fmt(APP_FROM)} with your instructions`, "Recording notice in the opening", "Transcript, recording and cost land in the app"],
      talk: [`${AI} calls your cell ${fmt(OWNER_CELL_NUM)}`, `You tell ${AI} who and why; he reads it back`, `${AI} places the call from ${fmt(APP_FROM)}; your instruction call is recorded and attached`],
      connect: [`${AI} calls your cell ${fmt(OWNER_CELL_NUM)} and asks who and why`, "You're put on hold", `${AI} calls ${who}, gives the recording notice, says "I'm connecting you to ${OWNER} now", and bridges you`, `No answer or voicemail: ${AI} comes back to you — leave a message, try later, or hang up`] }[mode]; }

  greetText(to, name) { return `Hi ${OWNER}, I'm ready to connect your call to ${name || digits(to)}. Press 1 to connect.`; }
  async meFirstTwiml(host, id, to, name, waitMs = 0) {
    return `<Gather numDigits="1" timeout="8" action="https://${host}/a/mefirst?id=${id}">${await this.say(this.greetText(to, name), host, waitMs)}</Gather>${await this.say(BYE, host, 1500)}<Hangup/>`; }

  async start(plan, host) {
    const E = this.E, id = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    if (plan.mode === "ai-call") return this.placeAi({ id, to: plan.to, name: plan.name, purpose: plan.instructions, persona: "ai-out" }, host);
    if (plan.mode === "me-first") {
      await this.h.put(`job:${id}`, plan); this.tts(this.greetText(plan.to, plan.name)); this.tts(BYE); this.tts(NOTICE); // warm while the phone rings
      const r = await tw(E, "/Calls.json", { To: OWNER_CELL_NUM, From: APP_FROM, Url: `https://${host}/a/greet?id=${id}`, Method: "POST", TimeLimit: "3600",
        StatusCallback: `https://${host}/a/legstatus?id=${id}&leg=owner&rate=${LEG_RATE}`, StatusCallbackEvent: "completed" }), j = await r.json();
      if (!r.ok) return { error: j.message || "Twilio error" };
      await this.logCall({ sid: j.sid, to: plan.to, type: "app-me-first", purpose: "Call me first", est_cost: +(5 * LEG_RATE * 2).toFixed(3), app_id: id });
      await this.post({ id: `out-${j.sid}`, direction: "outgoing", sid: j.sid, name: `Call to ${plan.name || fmt(plan.to)}`, to: plan.to, call_type: "Call me first", purpose: `You talked; ${AI} connected the call`, status: "ringing you", recording: true, them_ch: 1, time: new Date().toISOString() });
      return { ok: true, sid: j.sid, message: "Your cell is ringing. Press 1 to connect." };
    }
    // talk / connect: the AI caller calls the owner first
    return this.placeAi({ id, to: OWNER_CELL_NUM, persona: plan.mode === "talk" ? "intake" : "connect-intake", target: plan.to, target_name: plan.name, purpose: plan.instructions }, host);
  }

  // AI call through the existing bridge media path. info.persona picks instructions/tools.
  async placeAi(o, host, extra = {}) {
    const E = this.E, token = o.token || crypto.randomUUID().replace(/-/g, "");
    const info = { token, to: o.to, type: `app-${o.persona}`, purpose: o.purpose || "", maxMin: 5, on_behalf_of: FOR(), contact_name: o.name || "", notes: "", opener: "", transcript: [], host, ...o };
    this.h.live.set(token, info);
    const r = await tw(E, "/Calls.json", { To: o.to, From: APP_FROM, Twiml: `<Response><Connect><Stream url="wss://${host}/media"><Parameter name="t" value="${token}"/></Stream></Connect></Response>`,
      TimeLimit: String(o.persona === "connect-callee" || o.persona === "connect-intake" ? 3600 : 300),
      StatusCallback: `https://${host}/status?t=${token}`, StatusCallbackEvent: "completed",
      Record: "true", RecordingChannels: "dual", RecordingStatusCallback: `https://${host}/recstatus?t=${token}`, RecordingStatusCallbackEvent: "completed", ...extra }), j = await r.json();
    if (!r.ok) { this.h.live.delete(token); return { error: j.message || "Twilio error" }; }
    info.sid = j.sid;
    await this.logCall({ sid: j.sid, token, to: o.to, type: info.type, purpose: info.purpose, est_cost: +(5 * AI_RATE).toFixed(3), app_id: o.id, parent: o.intake_sid || o.owner_sid || null });
    const label = { "ai-out": `Have ${AI} call`, intake: `Talk to ${AI} (your instructions)`, "connect-intake": `Connect me with… (${AI} with you)`, "connect-callee": `Connect me with… (${AI} calling them)` }[o.persona];
    await this.post({ id: `out-${j.sid}`, direction: "outgoing", sid: j.sid, name: o.to === OWNER_CELL_NUM ? `${AI} → you${o.target ? " about " + (o.target_name || fmt(o.target)) : ""}` : `Call to ${o.name || fmt(o.to)}`,
      to: o.to, call_type: label, purpose: o.purpose || `(${AI} will ask you)`, status: "placed", recording: true, them_ch: 0, linked_sid: o.intake_sid || o.owner_sid || "", time: new Date().toISOString() });
    return { ok: true, sid: j.sid, token, message: o.to === OWNER_CELL_NUM ? `${AI} is calling your cell now.` : `${AI} is calling ${o.name || fmt(o.to)}.` };
  }

  // ---------- AI session config per persona (used by CallHub.bridge) ----------
  session(info) {
    const tgt = info.target ? `${info.target_name ? info.target_name + " at " : ""}${fmt(info.target)}` : "";
    const fn = (name, description, props = {}, req = []) => ({ type: "function", name, description, parameters: { type: "object", properties: props, required: req } });
    const S = { type: "string" };
    if (info.persona === "ai-out") return { opener: `Hi, this is ${AI}, an AI assistant calling for ${FOR()}. This call is recorded.`, instructions: null };
    if (info.persona === "intake") return {
      opener: `Hi ${OWNER}, it's ${AI}. This call is recorded. ${tgt ? `I have ${tgt}. What should I tell them?` : "Who should I call, and what's it about?"}`,
      instructions: `You are ${AI}, ${OWNER}'s AI calling assistant, on the phone with ${OWNER} (your boss). Get who to call (a US phone number${tgt ? `; you already have ${tgt}` : ""}) and exactly what the call should accomplish. Read the number back digit by digit and summarize the purpose in one sentence; when ${OWNER} confirms, call place_call. Tell ${OWNER} the result of place_call (if it fails, say why). Then say goodbye and call end_call. Be brief.`,
      tools: [fn("place_call", `Place the outgoing call ${OWNER} asked for`, { to: { ...S, description: "US number, digits" }, name: S, purpose: { ...S, description: "Full instructions for the call" } }, ["purpose"])] };
    if (info.persona === "connect-intake") return {
      opener: `Hi ${OWNER}, it's ${AI}. This call is recorded. ${tgt ? `Want me to connect you with ${tgt}? What's it about?` : "Who should I connect you with, and what's it about?"}`,
      instructions: `You are ${AI}, ${OWNER}'s AI calling assistant, on the phone with ${OWNER}. Find out who to connect him with (a US phone number${tgt ? `; you already have ${tgt}` : ""}) and a one-line reason. Read the number back. When ${OWNER} confirms, say "Okay, I'll put you on hold while I reach them," and call connect_now. If connect_now fails, tell ${OWNER} why and ask what to do. Be brief.`,
      tools: [fn("connect_now", `Hold ${OWNER} and call the person`, { to: S, name: S, reason: S }, ["reason"])] };
    if (info.persona === "connect-callee") return {
      opener: `Hi, this is ${AI}, an AI assistant calling for ${FOR()}. This call is recorded.`,
      instructions: `You are ${AI}, calling ${info.name || "someone"} for ${FOR()}. Reason: ${info.purpose}. ${OWNER} is on hold waiting.
If a live person answers: in one short sentence say why ${OWNER} is calling, then say "I'm connecting you to ${OWNER} now," and call bridge_now. If they say it's a bad time or they don't want to talk, be polite and call declined with their reason. If they ask not to be called again, call do_not_call then declined.
If you reach voicemail, an answering machine, a phone menu, or nobody speaks, say nothing and call no_answer immediately. Never leave a voicemail yourself.`,
      tools: [fn("bridge_now", `Connect the person to ${OWNER}`), fn("no_answer", "Voicemail, machine, menu or nobody", { what: S }), fn("declined", "They can't or won't talk now", { reason: S })] };
    if (info.persona === "connect-return") return {
      opener: `${OWNER}, ${info.reason || "they didn't pick up"}. Do you want to leave them a voicemail yourself, try later, or hang up?`,
      instructions: `You are ${AI}, back on the line with ${OWNER} after trying to reach ${tgt}. Offer: leave a voicemail (call leave_voicemail; you'll redial and ${OWNER} leaves the message himself after the beep), try later (call try_later with any note ${OWNER} gives), or hang up (say goodbye, call end_call). Be brief.`,
      tools: [fn("leave_voicemail", `Redial so ${OWNER} leaves his own voicemail`), fn("try_later", "Save a reminder in the app to try later", { note: S })] };
    return null;
  }

  async tool(ev, info, send, hangup) {
    const E = this.E, out = (o) => { send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: ev.call_id, output: JSON.stringify(o) } }); send({ type: "response.create" }); };
    let a = {}; try { a = JSON.parse(ev.arguments || "{}"); } catch {}
    const host = info.host;
    if (ev.name === "place_call") {
      const to = toE164(a.to) || info.target; if (!to) return out({ ok: false, error: "Need a phone number" });
      const why = await this.check(to, { ai: true }); if (why) return out({ ok: false, error: why });
      const r = await this.placeAi({ id: info.id, to, name: a.name || info.target_name || "", purpose: a.purpose, persona: "ai-out", intake_sid: info.sid }, host);
      return out(r.ok ? { ok: true, note: `Call placed. Tell ${OWNER}, then end.` } : { ok: false, error: r.error });
    }
    if (ev.name === "connect_now") {
      const to = toE164(a.to) || info.target; if (!to) return out({ ok: false, error: "Need a phone number" });
      const why = await this.check(to, { ai: true }); if (why) return out({ ok: false, error: why });
      const conf = `conn-${info.token.slice(0, 16)}`, job = { conf, owner_sid: info.sid, to, name: a.name || info.target_name || "", reason: a.reason, host, id: info.id, bridged: false, returned: false };
      await this.h.put(`conn:${conf}`, job);
      out({ ok: true, note: `Holding ${OWNER} now.` });
      info.closing = true;
      setTimeout(async () => { // let the hold line finish playing, then move the owner into the hold room
        await tw(E, `/Calls/${info.sid}.json`, { Twiml: `<Response><Dial><Conference beep="false" startConferenceOnEnter="false" endConferenceOnExit="true" waitUrl="${HOLD}">${conf}</Conference></Dial></Response>` });
        const ct = crypto.randomUUID().replace(/-/g, "");
        const r = await this.placeAi({ id: info.id, token: ct, to, name: job.name, purpose: a.reason, persona: "connect-callee", conf, owner_sid: info.sid, target: to },
          host, { StatusCallback: `https://${host}/a/calleestatus?conf=${conf}&t=${ct}` });
        if (!r.ok) return this.returnToOwner(conf, `I couldn't place the call: ${r.error}`);
        job.callee_sid = r.sid; await this.h.put(`conn:${conf}`, job);
      }, 2500);
      return;
    }
    if (ev.name === "bridge_now") { const job = await this.h.get(`conn:${info.conf}`); if (!job) return out({ ok: false });
      job.bridged = true; await this.h.put(`conn:${info.conf}`, job); info.closing = true;
      setTimeout(() => tw(E, `/Calls/${info.sid}.json`, { Twiml: `<Response><Dial><Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="true">${info.conf}</Conference></Dial></Response>` }), 2000);
      return out({ ok: true }); }
    if (ev.name === "no_answer" || ev.name === "declined") {
      out({ ok: true }); setTimeout(hangup, ev.name === "declined" ? 3500 : 200);
      return this.returnToOwner(info.conf, ev.name === "declined" ? `${info.name || "they"} couldn't talk right now${a.reason ? ": " + a.reason : ""}` : "it went to voicemail"); }
    if (ev.name === "leave_voicemail") { out({ ok: true, note: "Say: redialing now, leave your message after the beep." }); info.closing = true;
      setTimeout(() => tw(E, `/Calls/${info.sid}.json`, { Twiml: `<Response><Dial callerId="${APP_FROM}" timeLimit="600"><Number>${info.target}</Number></Dial></Response>` }), 3000); return; }
    if (ev.name === "try_later") { await this.post({ id: `later-${info.token.slice(0, 12)}`, line: "alert", name: `Try later: ${info.target_name || fmt(info.target)}`, callback: info.target,
      reason: a.note || "Couldn't reach them on a Connect me with call", urgency: "normal", time: new Date().toISOString() });
      return out({ ok: true, note: "Saved in the app. Say goodbye and call end_call." }); }
    return out({ ok: false, error: "unknown tool" });
  }

  async returnToOwner(conf, reason) {
    const job = await this.h.get(`conn:${conf}`); if (!job || job.bridged || job.returned) return; job.returned = true; await this.h.put(`conn:${conf}`, job);
    const token = crypto.randomUUID().replace(/-/g, "");
    this.h.live.set(token, { token, sid: job.owner_sid, to: OWNER_CELL_NUM, persona: "connect-return", reason, target: job.to, target_name: job.name, id: job.id, host: job.host, transcript: [], on_behalf_of: `${OWNER}`, maxMin: 5, type: "app-connect-return", purpose: "" });
    await tw(this.E, `/Calls/${job.owner_sid}.json`, { Twiml: `<Response><Connect><Stream url="wss://${job.host}/media"><Parameter name="t" value="${token}"/></Stream></Connect></Response>` });
  }

  // ---------- Twilio webhooks (/a/...) ----------
  async ttsGet(url) { const m = url.pathname.match(/^\/a\/tts\/([0-9a-f]{24})\.mp3$/); const b = m && await this.h.state.storage.get(`tts:${m[1]}`);
    return b ? new Response(b, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=31536000, immutable" } }) : new Response("not found", { status: 404 }); }
  async warm() { const t0 = Date.now(); const ks = await Promise.all([BYE, NOTICE].map((t) => this.tts(t))); return { ok: ks.every(Boolean), ms: Date.now() - t0 }; }
  async hook(req, url, host) {
    const E = this.E, form = new URLSearchParams(await req.text()), fd = new FormData(); for (const [k, v] of form) fd.append(k, v);
    const p = url.pathname;
    if (p === "/a/voice" || p === "/a/sms") { if (!(await twilioSigOk(req, E, url.href, fd))) return new Response("forbidden", { status: 403 }); }
    if (p === "/a/greet") { const id = url.searchParams.get("id"), job = await this.h.get(`job:${id}`);
      if (!job) return xml(`${await this.say(BYE, host, 1500)}<Hangup/>`);
      return xml(await this.meFirstTwiml(host, id, job.to, job.name, 2500)); }
    if (p === "/a/mefirst") { const id = url.searchParams.get("id"), job = await this.h.get(`job:${id}`);
      if (!job || form.get("Digits") !== "1") return xml(`${await this.say(BYE, host, 1500)}<Hangup/>`);
      const why = await this.check(job.to); if (why) return xml(`${await this.say(`Sorry, I can't place that call. ${why}.`, host, 2500)}<Hangup/>`);
      return xml(`<Dial callerId="${APP_FROM}" timeLimit="3600" record="record-from-answer-dual" recordingStatusCallback="https://${host}/a/recdone?id=${id}"><Number url="https://${host}/a/notice">${job.to}</Number></Dial>`); }
    if (p === "/a/notice") return xml(await this.say(NOTICE, host, 1500));
    if (p === "/a/recdone") return new Response(null, { status: 204 });
    if (p === "/a/legstatus") { const sid = form.get("CallSid"), dur = +(form.get("CallDuration") || 0), rate = +url.searchParams.get("rate") || LEG_RATE;
      const log = await this.h.get("call-log", { calls: [] }), c = log.calls.find((y) => y.sid === sid);
      const cost = +(Math.ceil(dur / 60) * rate * 2).toFixed(3); // the owner leg + other-person leg
      if (c) { c.status = form.get("CallStatus"); c.seconds = dur; c.est_cost = cost; await this.h.put("call-log", log); }
      await this.post({ id: `out-${sid}`, direction: "outgoing", sid, name: c ? `Call to ${fmt(c.to)}` : "Call me first", to: c?.to || "", call_type: "Call me first", purpose: `You talked; ${AI} connected the call`, status: form.get("CallStatus"), seconds: dur, est_cost: cost, recording: true, them_ch: 1, is_test: dur < 15, time: c?.started || new Date().toISOString() });
      await this.budgetAlert(); return new Response(null, { status: 204 }); }
    if (p === "/a/calleestatus") { const conf = url.searchParams.get("conf"), st = form.get("CallStatus");
      await this.h.fetch(new Request(`https://${host}/status?t=${url.searchParams.get("t")}`, { method: "POST", body: form.toString() }));
      if (["no-answer", "busy", "failed", "canceled"].includes(st)) await this.returnToOwner(conf, st === "busy" ? "the line was busy" : "they didn't answer");
      return new Response(null, { status: 204 }); }
    if (p === "/a/smsstatus") return new Response(null, { status: 204 });
    if (p === "/a/voice") { // someone calls the app number back: ring the owner, then the the business receptionist
      const from = form.get("From") || "";
      return xml(`<Dial callerId="${x(/^\+\d{8,15}$/.test(from) ? from : APP_FROM)}" timeout="20" answerOnBridge="true"><Number>${OWNER_CELL_NUM}</Number></Dial><Dial><Sip>${TEAM_SIP}</Sip></Dial>`); }
    if (p === "/a/sms") { const from = form.get("From") || "", body = (form.get("Body") || "").trim(), sid = form.get("MessageSid") || crypto.randomUUID();
      const d = await this.h.get("do-not-call", { numbers: [] }); d.numbers = d.numbers || [];
      let note = "";
      if (STOPW.test(body)) { if (!d.numbers.includes(from)) d.numbers.push(from); await this.h.put("do-not-call", d); note = " (opted out — added to do-not-contact)"; }
      else if (STARTW.test(body) && d.numbers.includes(from)) { d.numbers = d.numbers.filter((n) => n !== from); await this.h.put("do-not-call", d); note = " (opted back in)"; }
      const pp = et(), t = await this.h.get("text-log", { texts: [] }); t.texts.push({ sid, from, dir: "in", month: pp.month, day: pp.day, est_cost: SMS_RATE, time: new Date().toISOString() }); await this.h.put("text-log", t);
      await this.post({ id: `sms-${sid}`, line: "text", direction: "incoming", name: `Text from ${fmt(from)}${note}`, callback: from, details: body, est_cost: SMS_RATE, urgency: "normal", time: new Date().toISOString() });
      if (!note && from !== OWNER_CELL_NUM) await this.smsOwner(`Text reply from ${fmt(from)}: ${body.slice(0, 300)}`);
      return xml(""); }
    return new Response("not found", { status: 404 });
  }
}
