// Outbound/inbound call bridge — Cloudflare Worker + one Durable Object ("hub")
// The DO holds state (call-types, do-not-call, call-log) and terminates Twilio media websockets.
import { AppLine, configure } from "./app.js";
const RATE = 0.095, DEFAULT_MAX_MIN = 5;
let TZ = "America/New_York";
const json = (o, s = 200) => new Response(JSON.stringify(o, null, 2), { status: s, headers: { "content-type": "application/json" } });
const norm = (n) => (n || "").replace(/[^\d+]/g, "");
const twAuth = (E) => "Basic " + btoa(`${E.TWILIO_ACCOUNT_SID}:${E.TWILIO_AUTH_TOKEN}`);
function nowParts() {
  const d = new Date(), f = (o) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, ...o }).format(d);
  return { day: f({ year: "numeric", month: "2-digit", day: "2-digit" }), month: f({ year: "numeric", month: "2-digit" }),
    hour: +new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(d),
    dow: new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(d) };
}
function authOk(req, E) {
  const h = req.headers.get("authorization") || "", want = `Bearer ${E.BRIDGE_TOKEN}`;
  if (!E.BRIDGE_TOKEN || h.length !== want.length) return false;
  let x = 0; for (let i = 0; i < h.length; i++) x |= h.charCodeAt(i) ^ want.charCodeAt(i); return x === 0;
}

export default {
  async fetch(req, env) {
    const hub = env.CALLS.get(env.CALLS.idFromName("hub"));
    return hub.fetch(req);
  },
};


export class CallHub {
  constructor(state, env) { configure(env); TZ = env.TIMEZONE || TZ; this.state = state; this.env = env; this.live = new Map(); this.app = new AppLine(this); }
  async get(k, d) { return (await this.state.storage.get(k)) ?? d; }
  async put(k, v) { await this.state.storage.put(k, v); }

  async check({ to, type }) {
    const E = this.env, p = nowParts();
    if (!/^\+1[2-9]\d{9}$/.test(to)) return "US numbers only (+1XXXXXXXXXX)";
    if (["Sat", "Sun"].includes(p.dow) || p.hour < 9 || p.hour >= 19) return "Outside business hours (Mon–Fri 9am–7pm ET)";
    const dnc = await this.get("do-not-call", { numbers: [] });
    if (dnc.numbers.includes(to)) return "Number is on do-not-call list";
    const types = await this.get("call-types", { approved: [], pending: [] });
    if (!types.approved.some((t) => t.type === type)) {
      if (!types.pending.some((t) => t.type === type)) { types.pending.push({ type, first_requested: new Date().toISOString() }); await this.put("call-types", types); }
      return `Call type "${type}" is not approved yet — needs the owner's yes the first time`;
    }
    const log = await this.get("call-log", { calls: [] });
    if (log.calls.filter((c) => c.day === p.day).length >= +E.MAX_CALLS_DAY) return `Daily cap reached (${E.MAX_CALLS_DAY})`;
    const spent = log.calls.filter((c) => c.month === p.month).reduce((s, c) => s + (c.est_cost || 0), 0);
    if (spent + DEFAULT_MAX_MIN * RATE > +E.MAX_MONTH_USD) return `Monthly cap would be exceeded ($${spent.toFixed(2)} of $${E.MAX_MONTH_USD})`;
    return null;
  }

  async fetch(req) {
    const E = this.env, url = new URL(req.url), host = url.host, AIN = E.AI_CALLER_NAME || "AI caller";
    try {
      if (url.pathname === "/health") return json({ ok: true });
      if (url.pathname === "/inbound") return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Sip>${E.RECEPTIONIST_SIP}</Sip></Dial></Response>`, { headers: { "Content-Type": "text/xml" } });

      // Calls-app line (APP_FROM)
      if (url.pathname.startsWith("/app/")) { if (!authOk(req, E)) return json({ error: "unauthorized" }, 401); return await this.app.api(req, url, host); }
      if (url.pathname.startsWith("/a/tts/") && (req.method === "GET" || req.method === "HEAD")) return await this.app.ttsGet(url);
      if (url.pathname.startsWith("/a/") && req.method === "POST") return await this.app.hook(req, url, host);

      // state files: GET/PUT /state/{call-types|do-not-call|call-log}
      const m = url.pathname.match(/^\/state\/(call-types|do-not-call|call-log)$/);
      if (m) {
        if (!authOk(req, E)) return json({ error: "unauthorized" }, 401);
        if (req.method === "PUT") { await this.put(m[1], await req.json()); return json({ ok: true }); }
        return json(await this.get(m[1], {}));
      }

      if (url.pathname === "/call" && req.method === "POST") {
        if (!authOk(req, E)) return json({ error: "unauthorized" }, 401);
        const b = await req.json().catch(() => ({}));
        const to = norm(b.to), type = (b.type || "").trim(), purpose = (b.purpose || "").trim();
        if (!to || !type || !purpose) return json({ error: "need to, type, purpose" }, 400);
        const maxMin = Math.min(+b.max_minutes || DEFAULT_MAX_MIN, DEFAULT_MAX_MIN);
        const why = await this.check({ to, type });
        if (why) return json({ error: why }, 403);
        if (b.dry_run) return json({ ok: true, dry_run: true, message: "All checks passed; no call placed" });
        const token = crypto.randomUUID().replace(/-/g, "");
        const info = { token, to, type, purpose, maxMin, on_behalf_of: b.on_behalf_of || E.BUSINESS_NAME || E.OWNER_NAME || "the owner", contact_name: b.contact_name || "", notes: (b.notes || "").slice(0,6000), opener: (() => { const o = (b.opener || "").slice(0,300).trim(); return o && !/recorded/i.test(o) ? `${o} This call may be recorded.` : o; })(), transcript: [], host };
        this.live.set(token, info);
        const twiml = `<Response><Connect><Stream url="wss://${host}/media"><Parameter name="t" value="${token}"/></Stream></Connect></Response>`;
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${E.TWILIO_ACCOUNT_SID}/Calls.json`, {
          method: "POST", headers: { Authorization: twAuth(E) },
          body: new URLSearchParams({ To: to, From: E.FROM_NUMBER, Twiml: twiml, TimeLimit: String(maxMin * 60),
            StatusCallback: `https://${host}/status?t=${token}`, StatusCallbackEvent: "completed",
            Record: "true", RecordingChannels: "dual", RecordingStatusCallback: `https://${host}/recstatus?t=${token}`, RecordingStatusCallbackEvent: "completed" }) });
        const j = await r.json();
        if (!r.ok) { this.live.delete(token); return json({ error: "twilio", detail: j.message }, 502); }
        info.sid = j.sid;
        const p = nowParts(), log = await this.get("call-log", { calls: [] });
        log.calls.push({ sid: j.sid, token, to, type, purpose, day: p.day, month: p.month, started: new Date().toISOString(), est_cost: +(maxMin * RATE).toFixed(3), status: "placed" });
        await this.put("call-log", log);
        return json({ ok: true, sid: j.sid });
      }

      if (url.pathname === "/status" && req.method === "POST") {
        const f = new URLSearchParams(await req.text()), t = url.searchParams.get("t"), dur = +(f.get("CallDuration") || 0);
        const log = await this.get("call-log", { calls: [] }), c = log.calls.find((x) => x.token === t);
        if (c) { c.status = f.get("CallStatus"); c.seconds = dur; c.est_cost = +(Math.ceil(dur / 60) * RATE).toFixed(3);
          const info = this.live.get(t); if (info) { c.transcript = info.transcript; c.summary = info.summary || null; this.live.delete(t); }
          await this.put("call-log", log);
          if (c.app) { await this.app.post({ id: `out-${c.sid}`, direction: "outgoing", sid: c.sid, name: info?.to === E.OWNER_CELL ? `${AIN} → you` : `Call to ${info?.contact_name || info?.name || c.to}`, to: c.to,
            call_type: { "app-ai-out": `Have ${AIN} call`, "app-intake": `Talk to ${AIN} (your instructions)`, "app-connect-intake": `Connect me with… (${AIN} with you)`, "app-connect-callee": `Connect me with… (${AIN} calling them)` }[c.type] || c.type,
            purpose: c.purpose || "", summary: c.summary || "", status: c.status, seconds: dur, est_cost: c.est_cost, recording: true, them_ch: 0, linked_sid: c.parent || "",
            transcript: c.transcript || [], is_test: dur < 15 || c.status !== "completed", time: c.started });
            await this.app.budgetAlert(); } }
        return new Response(null, { status: 204 });
      }

      if (url.pathname === "/recstatus" && req.method === "POST") {
        const f = new URLSearchParams(await req.text()), t = url.searchParams.get("t");
        const log = await this.get("call-log", { calls: [] }), c = log.calls.find((x) => x.token === t);
        if (c && f.get("RecordingSid")) { c.recording_sid = f.get("RecordingSid"); c.recording_seconds = +(f.get("RecordingDuration") || 0); await this.put("call-log", log); }
        return new Response(null, { status: 204 });
      }

      // GET /recording/<CallSid>: stream the call's MP3 from Twilio (bearer token required)
      const rm = url.pathname.match(/^\/recording\/(CA[0-9a-f]{32})$/);
      if (rm && req.method === "GET") {
        if (!authOk(req, E)) return json({ error: "unauthorized" }, 401);
        const base = `https://api.twilio.com/2010-04-01/Accounts/${E.TWILIO_ACCOUNT_SID}`;
        const log = await this.get("call-log", { calls: [] });
        let rs = log.calls.find((x) => x.sid === rm[1])?.recording_sid;
        if (!rs) { const lr = await fetch(`${base}/Calls/${rm[1]}/Recordings.json`, { headers: { Authorization: twAuth(E) } });
          if (lr.ok) rs = (await lr.json()).recordings?.[0]?.sid; }
        if (!rs) return json({ error: "no recording" }, 404);
        const h = { Authorization: twAuth(E) }; if (req.headers.get("Range")) h.Range = req.headers.get("Range");
        const a = await fetch(`${base}/Recordings/${rs}.mp3`, { headers: h });
        if (a.status === 404) return json({ error: "no recording" }, 404);
        if (!a.ok && a.status !== 206) return json({ error: "twilio", status: a.status }, 502);
        const oh = new Headers({ "Content-Type": "audio/mpeg", "Accept-Ranges": "bytes", "Cache-Control": "private, no-store" });
        for (const k of ["Content-Length", "Content-Range"]) if (a.headers.get(k)) oh.set(k, a.headers.get(k));
        return new Response(a.body, { status: a.status, headers: oh });
      }

      if (url.pathname === "/media" && req.headers.get("Upgrade") === "websocket") {
        const [client, server] = Object.values(new WebSocketPair());
        server.accept(); this.bridge(server);
        return new Response(null, { status: 101, webSocket: client });
      }
      return json({ error: "not found" }, 404);
    } catch (e) { console.error(e); return json({ error: "server error" }, 500); }
  }

  async bridge(tw) {
    const E = this.env, AIN = E.AI_CALLER_NAME || "AI caller"; let streamSid = null, info = null, xai = null;
    const hangup = async () => info?.sid && fetch(`https://api.twilio.com/2010-04-01/Accounts/${E.TWILIO_ACCOUNT_SID}/Calls/${info.sid}.json`,
      { method: "POST", headers: { Authorization: twAuth(E) }, body: new URLSearchParams({ Status: "completed" }) }).catch(() => {});
    // Key presses: Twilio can't take DTMF over the media stream, so update the live call with <Play digits>, then reconnect
    // <Connect><Stream> with the same token. The xAI session stays open in info.x and is re-attached on the new stream.
    const pressDigits = async (dg) => {
      info.redirecting = true;
      const tm = `<Response><Play digits="w${dg}"/><Connect><Stream url="wss://${info.host}/media"><Parameter name="t" value="${info.token}"/></Stream></Connect></Response>`;
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${E.TWILIO_ACCOUNT_SID}/Calls/${info.sid}.json`,
        { method: "POST", headers: { Authorization: twAuth(E) }, body: new URLSearchParams({ Twiml: tm }) }).catch(() => null);
      if (!r || !r.ok) info.redirecting = false;
      return !!(r && r.ok);
    };
    tw.addEventListener("message", async (msg) => {
      const m = JSON.parse(msg.data);
      if (m.event === "start") {
        streamSid = m.start.streamSid; info = this.live.get(m.start.customParameters?.t);
        if (!info) return tw.close();
        info.tw = tw; info.streamSid = streamSid;
        if (info.x) { xai = info.x; info.redirecting = false; return; } // reconnected after a key press
        const r = await fetch("https://api.x.ai/v1/realtime?model=grok-voice-3.0", { headers: { Upgrade: "websocket", Authorization: `Bearer ${E.XAI_API_KEY}` } });
        xai = r.webSocket; if (!xai) { console.error("xai ws failed", r.status); return tw.close(); }
        xai.accept(); info.x = xai;
        const send = (o) => xai.send(JSON.stringify(o));
        const twSend = (o) => { try { info.tw?.send(JSON.stringify({ ...o, streamSid: info.streamSid })); } catch {} };
        const ap = info.persona ? this.app.session(info) : null;
        send({ type: "session.update", session: {
          voice: E.AI_VOICE || "ara", turn_detection: { type: "server_vad" },
          audio: { input: { format: { type: "audio/pcmu" } }, output: { format: { type: "audio/pcmu" } } },
          instructions: ap?.instructions ? ap.instructions : (ap ? `You are ${AIN}, an AI assistant making a phone call for ${info.on_behalf_of}.` : `You are ${AIN}, an AI assistant making a phone call for ${info.on_behalf_of}.`) + (ap?.instructions ? "" :
`
Purpose of this call: ${info.purpose}
${info.contact_name ? `You are calling: ${info.contact_name}.` : ""}
${info.notes ? `Notes: ${info.notes}` : ""}
Rules: Always be honest that you are an AI. Be brief, polite and natural. Stay on the purpose; make no commitments, payments or agreements beyond it.
If the person asks not to be called again, apologize, confirm it, call do_not_call, then say goodbye.
Automated phone menus: if you hear a recorded menu ("press 1 for..."), stay silent and listen to the WHOLE menu, then call press_digits with the single best key for this call's purpose (prefer options like customer service, representative/agent/operator, scheduling/appointments/deliveries, or tracking a shipment; use 0 if nothing fits). If it asks you to enter a number (e.g., tracking/PRO number) by keypad, press_digits with those digits followed by # if asked. If a menu accepts speech, you may also say the option. After pressing, say nothing and wait for the next prompt. Never talk over recordings.
On hold: stay completely silent during hold music, recorded messages and silence. Never hang up or call end_call while on hold or waiting in a queue; wait until a live person answers, then greet them and state the purpose.
When done, say goodbye and call end_call with a one-sentence summary. Keep the call under ${info.maxMin} minutes.`),
          tools: (ap?.tools || []).concat(ap?.instructions ? [
            { type: "function", name: "end_call", description: "Hang up after saying goodbye", parameters: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] } },
            { type: "function", name: "do_not_call", description: "Person asked not to be called again", parameters: { type: "object", properties: {} } } ] : [
            { type: "function", name: "end_call", description: "Hang up after saying goodbye", parameters: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] } },
            { type: "function", name: "press_digits", description: "Press phone keypad keys (send touch-tones) on the live call, e.g. to choose an automated menu option. Use only 0-9, *, #; the letter w adds a 0.5s pause.", parameters: { type: "object", properties: { digits: { type: "string" } }, required: ["digits"] } },
            { type: "function", name: "do_not_call", description: "Person asked not to be called again", parameters: { type: "object", properties: {} } } ]) } });
        send({ type: "conversation.item.create", item: { type: "force_message", role: "assistant", interruptible: false,
          content: [{ type: "output_text", text: ap?.opener || info.opener || `Hi, this is ${AIN}, an AI assistant calling for ${info.on_behalf_of}. This call may be recorded.` }] } });
        xai.addEventListener("message", async (d) => {
          const ev = JSON.parse(d.data);
          if ((ev.type === "response.output_audio.delta" || ev.type === "response.audio.delta") && ev.delta) { if (!info.redirecting) twSend({ event: "media", media: { payload: ev.delta } }); }
          else if (ev.type === "input_audio_buffer.speech_started") twSend({ event: "clear" });
          else if (ev.type === "response.output_audio_transcript.done" || ev.type === "response.audio_transcript.done") info.transcript.push({ who: "AI", text: ev.transcript });
          else if (ev.type === "conversation.item.input_audio_transcription.completed") info.transcript.push({ who: "Them", text: ev.transcript });
          else if (ev.type === "response.function_call_arguments.done") {
            if (info.persona && !["do_not_call", "press_digits", "end_call"].includes(ev.name)) { await this.app.tool(ev, info, send, hangup); }
            else if (ev.name === "do_not_call") {
              const dnc = await this.get("do-not-call", { numbers: [] });
              if (!dnc.numbers.includes(info.to)) { dnc.numbers.push(info.to); await this.put("do-not-call", dnc); }
              send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: ev.call_id, output: "{\"ok\":true}" } });
              send({ type: "response.create" });
            } else if (ev.name === "press_digits") {
              let dg = ""; try { dg = String(JSON.parse(ev.arguments).digits || "").replace(/[^0-9*#w]/g, "").slice(0, 32); } catch {}
              const ok = dg ? await pressDigits(dg) : false;
              info.transcript.push({ who: "AI", text: `[pressed ${dg}${ok ? "" : " - FAILED"}]` });
              send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: ev.call_id, output: JSON.stringify({ ok, pressed: dg, note: "Stay silent and listen for the next prompt." }) } });
            } else if (ev.name === "end_call") {
              try { info.summary = JSON.parse(ev.arguments).summary; } catch {}
              setTimeout(hangup, 4000);
            }
          }
        });
        xai.addEventListener("close", () => { try { info.tw?.close(); } catch {} });
      } else if (m.event === "media" && xai) {
        try { xai.send(JSON.stringify({ type: "input_audio_buffer.append", audio: m.media.payload })); } catch {}
      } else if (m.event === "stop") { if (!info?.redirecting) try { xai?.close(); } catch {} }
    });
    tw.addEventListener("close", () => { if (!info?.redirecting) try { xai?.close(); } catch {} });
    // Safety: if a reconnect never arrives, close the AI session after 30s.
    tw.addEventListener("close", () => { if (info?.redirecting) setTimeout(() => { if (info.redirecting) try { info.x?.close(); } catch {} }, 30000); });
  }
}
