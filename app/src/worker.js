// Calls app: private message list + call/text screen for the owner.
const json = (d, s = 200, h = {}) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store", ...h } });
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

function safeEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0;
}
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}
async function makeSession(env) {
  const exp = Date.now() + 90 * 864e5; const p = `v1.${exp}`;
  return `${p}.${await hmac(env.SESSION_KEY, p)}`;
}
async function checkSession(env, req) {
  const m = (req.headers.get("cookie") || "").match(/app_s=([^;]+)/); if (!m || !env.SESSION_KEY) return false;
  const [v, exp, sig] = m[1].split("."); if (v !== "v1" || +exp < Date.now()) return false;
  return safeEq(sig, await hmac(env.SESSION_KEY, `v1.${exp}`));
}
let certCache;
async function checkAccess(env, req) {
  const tok = req.headers.get("cf-access-jwt-assertion"); if (!tok || !env.TEAM_DOMAIN || !env.ACCESS_AUD) return false;
  try {
    const [h, p, s] = tok.split("."); const head = JSON.parse(new TextDecoder().decode(fromB64u(h)));
    const pay = JSON.parse(new TextDecoder().decode(fromB64u(p)));
    if (!certCache) certCache = (await (await fetch(`https://${env.TEAM_DOMAIN}/cdn-cgi/access/certs`)).json()).keys;
    const jwk = certCache.find((k) => k.kid === head.kid); if (!jwk) { certCache = null; return false; }
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64u(s), enc.encode(`${h}.${p}`)))) return false;
    const aud = Array.isArray(pay.aud) ? pay.aud : [pay.aud];
    if (!aud.includes(env.ACCESS_AUD) || pay.exp * 1000 < Date.now()) return false;
    const allowed = env.ALLOWED_EMAILS.split(",").map((e) => e.trim().toLowerCase());
    return allowed.includes(String(pay.email || "").toLowerCase());
  } catch { return false; }
}
const authed = async (env, req) => (await checkAccess(env, req)) || (await checkSession(env, req));

const sameOrigin = (req) => { const o = req.headers.get("origin"); if (!o) return true; try { return new URL(o).host === new URL(req.url).host; } catch { return false; } };
function clean(m, env = {}) {
  const s = (v, n = 4000) => (v == null ? "" : String(v).slice(0, n));
  const time = m.time && !isNaN(Date.parse(m.time)) ? new Date(m.time).toISOString() : new Date().toISOString();
  return {
    id: s(m.id, 80) || `${time.replace(/\D/g, "").slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`,
    time, name: s(m.name, 200) || "Unknown caller", callback: s(m.callback, 40), called_from: s(m.called_from, 40),
    reason: s(m.reason, 1000), details: s(m.details, 8000), urgency: /urgent/i.test(m.urgency) ? "urgent" : "normal",
    language: s(m.language, 40), email_status: s(m.email_status, 300), is_test: !!m.is_test, conversation_id: (s(m.conversation_id, 80) || "").replace(/[^A-Za-z0-9-]/g, ""), received_at: new Date().toISOString(),
    direction: m.direction === "outgoing" ? "outgoing" : "incoming",
    ...(m.line === "text" || m.line === "alert" ? { line: m.line, to: s(m.to, 40), sid: s(m.sid, 64).replace(/[^A-Za-z0-9]/g, ""), status: s(m.status, 40), est_cost: m.est_cost == null ? null : +m.est_cost } : {}),
    ...(m.line === "team" ? { line: "team", for: s(m.for, 120) || (env.TEAM_NAME || "Team"), summary: s(m.summary, 4000) } : {}),
    ...(m.direction === "outgoing" ? { sid: s(m.sid, 64).replace(/[^A-Za-z0-9]/g, ""), to: s(m.to, 40), call_type: s(m.call_type || m.type, 60), purpose: s(m.purpose, 4000),
      summary: s(m.summary, 4000), recording: !!m.recording, them_ch: +m.them_ch === 1 ? 1 : 0, linked_sid: s(m.linked_sid, 64).replace(/[^A-Za-z0-9]/g, ""), seconds: +m.seconds || 0, est_cost: m.est_cost == null ? null : +m.est_cost, status: s(m.status, 40),
      transcript: (Array.isArray(m.transcript) ? m.transcript : []).slice(0, 400).map((t) => ({ who: s(t && t.who, 20), text: s(t && t.text, 4000) })) } : (+m.seconds > 0 ? { seconds: +m.seconds } : {})),
  };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url); const path = url.pathname;
    if (path === "/api/messages" && req.method === "POST") {
      const a = req.headers.get("authorization") || "";
      if (!env.INGEST_TOKEN || !safeEq(a, `Bearer ${env.INGEST_TOKEN}`)) return json({ error: "unauthorized" }, 401);
      let body; try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
      const list = Array.isArray(body) ? body : [body]; const ids = [];
      for (const raw of list.slice(0, 50)) { const m = clean(raw, env); await env.DB.put(`msg:${m.id}`, JSON.stringify(m)); ids.push(m.id); }
      return json({ ok: true, ids });
    }
    if (path.startsWith("/api/messages/") && req.method === "DELETE") {
      const a = req.headers.get("authorization") || "";
      if (!env.INGEST_TOKEN || !safeEq(a, `Bearer ${env.INGEST_TOKEN}`)) return json({ error: "unauthorized" }, 401);
      const id = decodeURIComponent(path.slice(14)); await env.DB.delete(`msg:${id}`); return json({ ok: true, deleted: id });
    }
    if (path === "/api/login" && req.method === "POST") {
      const f = await req.formData().catch(() => null); const code = f && String(f.get("passcode") || "").trim();
      if (env.APP_PASSCODE && code && safeEq(code, env.APP_PASSCODE)) {
        return new Response(null, { status: 303, headers: { location: "/", "set-cookie": `app_s=${await makeSession(env)}; Path=/; Max-Age=7776000; HttpOnly; Secure; SameSite=Lax` } });
      }
      return new Response(null, { status: 303, headers: { location: "/?bad=1" } });
    }
    if (path === "/api/logout") return new Response(null, { status: 303, headers: { location: "/", "set-cookie": "app_s=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" } });
    if (path === "/config.js") return new Response("window.CFG=" + JSON.stringify({ owner_cell: (await authed(env, req)) ? (env.OWNER_CELL || "") : "", app: env.APP_TITLE || "Calls", owner: env.OWNER_NAME || "Owner", biz: env.BUSINESS_NAME || "", ai: env.AI_CALLER_NAME || "AI caller", rec: env.RECEPTIONIST_NAME || "Receptionist", line: env.RECEPTIONIST_NUMBER_DISPLAY || "", from: env.APP_NUMBER || "", tz: env.TIMEZONE || "America/New_York", tzl: env.TIMEZONE_LABEL || "ET", conv: env.XAI_CONVERSATIONS_URL || "", convTeam: env.XAI_TEAM_CONVERSATIONS_URL || "" }) + ";", { headers: { "content-type": "application/javascript", "cache-control": "no-store" } });
    if (path === "/api/me") return json({ authed: await authed(env, req) });
    if (path === "/api/messages" && req.method === "GET") {
      if (!(await authed(env, req))) return json({ error: "sign in" }, 401);
      const out = []; let cursor;
      do { const r = await env.DB.list({ prefix: "msg:", cursor }); cursor = r.list_complete ? null : r.cursor;
        const vals = await Promise.all(r.keys.map((k) => env.DB.get(k.name, "json"))); out.push(...vals.filter(Boolean)); } while (cursor);
      out.sort((a, b) => b.time.localeCompare(a.time));
      return json({ messages: out });
    }
    if (path === "/api/favs") {
      if (!(await authed(env, req))) return json({ error: "sign in" }, 401);
      let favs = (await env.DB.get("favs", "json")) || [];
      if (req.method === "POST") {
        if (!sameOrigin(req)) return json({ error: "bad origin" }, 403);
        const b = await req.json().catch(() => ({})); const d = String(b.number || "").replace(/\D/g, ""); const n = d.length == 10 ? "+1" + d : d.length == 11 && d[0] == "1" ? "+" + d : "";
        if (!n) return json({ error: "bad number" }, 400);
        favs = favs.filter((f) => f.n !== n); if (!b.remove) favs.push({ n, name: String(b.name || "").slice(0, 120) });
        await env.DB.put("favs", JSON.stringify(favs.slice(0, 100)));
      }
      return json({ favs });
    }
    // Call / text from the app number (APP_FROM on the bridge), via the bridge (service binding)
    const ap = { "/api/call": "/app/call", "/api/text": "/app/text", "/api/dnc": "/app/dnc", "/api/line": "/app/state" }[path];
    if (ap && (req.method === "POST" || path === "/api/line")) {
      if (!(await authed(env, req))) return json({ error: "sign in" }, 401);
      if (req.method === "POST" && !sameOrigin(req)) return json({ error: "bad origin" }, 403);
      const r = await env.BRIDGE.fetch(`https://bridge.internal${ap}`, { method: "POST",
        headers: { authorization: `Bearer ${env.BRIDGE_TOKEN}`, "content-type": "application/json" }, body: req.method === "POST" ? await req.text() : "{}" });
      return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
    if (path.startsWith("/api/recording/") && req.method === "GET") {
      if (!(await authed(env, req))) return json({ error: "sign in" }, 401);
      const sid = path.slice(15); if (!/^CA[0-9a-f]{32}$/.test(sid)) return json({ error: "bad sid" }, 400);
      if (!env.BRIDGE_TOKEN) return json({ error: "not configured" }, 500);
      const r = await (env.BRIDGE ? env.BRIDGE.fetch.bind(env.BRIDGE) : fetch)(`https://bridge.internal/recording/${sid}`, { headers: { authorization: `Bearer ${env.BRIDGE_TOKEN}` } });
      if (r.status === 404) return json({ error: "no recording" }, 404);
      if (!r.ok) return json({ error: "bridge error", status: r.status }, 502);
      const buf = new Uint8Array(await r.arrayBuffer()); const n = buf.length;
      const h = { "content-type": "audio/mpeg", "accept-ranges": "bytes", "cache-control": "private, max-age=3600" };
      const rg = (req.headers.get("range") || "").match(/^bytes=(\d*)-(\d*)$/);
      if (rg && (rg[1] || rg[2])) {
        let a, b;
        if (rg[1] === "") { a = Math.max(0, n - +rg[2]); b = n - 1; } else { a = +rg[1]; b = rg[2] ? Math.min(+rg[2], n - 1) : n - 1; }
        if (a >= n || a > b) return new Response(null, { status: 416, headers: { ...h, "content-range": `bytes */${n}` } });
        return new Response(buf.slice(a, b + 1), { status: 206, headers: { ...h, "content-range": `bytes ${a}-${b}/${n}`, "content-length": String(b - a + 1) } });
      }
      return new Response(buf, { status: 200, headers: { ...h, "content-length": String(n) } });
    }
    if (path.startsWith("/api/")) return json({ error: "not found" }, 404);
    return env.ASSETS.fetch(req);
  },
};
