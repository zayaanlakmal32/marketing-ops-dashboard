// POST /api/checkpoints  { clients: [{ id, name }] }
// → for each client, finds their GHL contact (Accelerate sub-account) and their strategy call appointment.
//   The "Client Checkpoint & Renewal Reminders" workflow starts from that call, then sends
//   Slack polls at day 14, day 30 and 7 days before the 90-day sub ends. The dashboard counts from this date.
// Read-only. Needs GHL_TOKEN + GHL_LOCATION_ID.
const { send, checkKey } = require("../lib/notion");

const BASE = "https://services.leadconnectorhq.com";
const CACHE_MS = 10 * 60 * 1000;
let cache = { at: 0, key: "", data: null };

async function ghl(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(BASE + path, {
      headers: { Authorization: "Bearer " + process.env.GHL_TOKEN, Version: "2021-07-28", Accept: "application/json" }
    });
    if (res.status === 429 && attempt < 2) { await new Promise(r => setTimeout(r, 1200)); continue; }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.message || "GHL error " + res.status), { status: res.status });
    return json;
  }
}

const TITLES = ["dr", "mr", "mrs", "ms", "miss", "prof"];
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(t => t && !TITLES.includes(t));
// Forgiving name match: "Sheron De Silva" ~ "Sheron Desilva", "Pramod Mudalagiri" ~ "Pramod Mudalagiri Gowda", "Dr Amila Fernando" ~ "Amila Fernando".
const sameName = (a, b) => {
  const x = norm(a), y = norm(b); if (!x.length || !y.length) return false;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  if (s.every((t, i) => t === l[i])) return true;
  const sx = x.join(""), sy = y.join("");
  if (sx === sy) return true;
  if (Math.min(sx.length, sy.length) >= 6 && (sx.startsWith(sy) || sy.startsWith(sx))) return true;
  if (x[0] !== y[0]) return false;
  const rx = x.slice(1).join(""), ry = y.slice(1).join("");
  return rx.length >= 3 && ry.length >= 3 && (rx.startsWith(ry) || ry.startsWith(rx));
};
const fullName = x => [x.firstName, x.lastName].filter(Boolean).join(" ") || x.contactName || "";
async function findContacts(loc, name) {
  const parts = norm(name), seen = {}, out = [];
  for (const q of [parts.join(" "), parts[0]].filter(Boolean)) {
    const j = await ghl("/contacts/?locationId=" + encodeURIComponent(loc) + "&query=" + encodeURIComponent(q) + "&limit=20");
    (j.contacts || []).forEach(c => { if (!seen[c.id]) { seen[c.id] = 1; out.push(c); } });
    if (out.some(c => sameName(fullName(c), name))) break;
  }
  return out;
}
const BAD = ["cancelled", "canceled", "noshow", "no_show", "invalid"];

module.exports = async (req, res) => {
  if (!checkKey(req, res)) return;
  const loc = process.env.GHL_LOCATION_ID;
  if (!process.env.GHL_TOKEN || !loc) return send(res, 400, { error: "not_set_up", message: "GHL isn't connected (GHL_TOKEN / GHL_LOCATION_ID)." });
  // GET /api/checkpoints?names=Glauco Defendi,Sheron De Silva → shows what GHL has for those names (for fixing matches).
  if (req.method === "GET") {
    const names = String(req.query.names || "").split(",").map(n => n.trim()).filter(Boolean).slice(0, 10);
    const out = {};
    for (const n of names) {
      try { out[n] = (await findContacts(loc, n)).slice(0, 8).map(c => ({ ghlName: fullName(c), hasEmail: !!c.email, matches: sameName(fullName(c), n) })); }
      catch (e) { out[n] = { error: e.message }; }
    }
    return send(res, 200, { ok: true, names: out });
  }
  if (req.method !== "POST") return send(res, 405, { error: "method", message: "Use POST." });
  const list = (Array.isArray((req.body || {}).clients) ? req.body.clients : [])
    .filter(c => /^[0-9a-f]{32}$/i.test(c.id || "") && c.name).slice(0, 60);
  const key = list.map(c => c.id).sort().join(",");
  if (cache.data && cache.key === key && Date.now() - cache.at < CACHE_MS) return send(res, 200, cache.data);

  try {
    // calendar id → name, so we can spot the strategy call calendar
    let calendars = {};
    try {
      const j = await ghl("/calendars/?locationId=" + encodeURIComponent(loc));
      (j.calendars || []).forEach(c => { calendars[c.id] = c.name || ""; });
    } catch (e) { /* calendar names are a nice-to-have */ }

    const out = {};
    for (const c of list) {
      const row = { found: false };
      try {
        const hits = (await findContacts(loc, c.name)).filter(x => sameName(fullName(x), c.name))
          .sort((a, b) => (b.email ? 1 : 0) - (a.email ? 1 : 0)); // prefer the contact that has an email
        if (hits.length) {
          row.found = true;
          const contact = hits[0];
          if (contact.email) row.email = contact.email; // for the "Email client" button on Upsell
          const ev = await ghl("/contacts/" + encodeURIComponent(contact.id) + "/appointments");
          const appts = (ev.events || ev.appointments || [])
            .map(a => ({ start: a.startTime, status: String(a.appointmentStatus || a.status || "").toLowerCase(), title: a.title || "", calendar: calendars[a.calendarId] || "" }))
            .filter(a => a.start && !BAD.includes(a.status.replace(/[\s-]/g, "")));
          // Prefer an appointment on a strategy calendar / with "strategy" in the title; otherwise leave it to the tracker date.
          const strat = appts.filter(a => /strategy/i.test(a.title + " " + a.calendar)).sort((a, b) => (a.start < b.start ? -1 : 1));
          if (strat.length) { row.date = strat[0].start.slice(0, 10); row.title = strat[0].title || strat[0].calendar; }
          row.appointments = appts.length;
        }
      } catch (e) { row.error = e.message; }
      out[c.id] = row;
    }
    const data = { ok: true, clients: out, loadedAt: new Date().toISOString() };
    cache = { at: Date.now(), key, data };
    send(res, 200, data);
  } catch (e) {
    send(res, e.status || 500, { error: "ghl", message: e.message });
  }
};
