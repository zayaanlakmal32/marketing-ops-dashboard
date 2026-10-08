// Shared Notion helpers used by the api/ routes.
// Uses Notion's data source API (version 2025-09-03), which works with multi-source databases.

const NOTION_VERSION = "2025-09-03";

// Data source IDs (from Notion). These are not secret.
const DS = {
  tracker: "b6b396fe-f0cf-4d7e-9845-e18c630c0ae7", // Project Tracker
  projects: "2b1b6494-fc14-82b9-8659-872f524ab1fd", // PM Engine v2 → Projects
  tasks: "9acb6494-fc14-8290-af49-87a1c6c613ed", // PM Engine v2 → Tasks
  board: "309b6494-fc14-8073-ae13-000b7a00ba6e" // Strategy Hub → Strategy Board
};

function token() {
  const t = process.env.NOTION_TOKEN;
  if (!t) {
    const e = new Error("NOTION_TOKEN is not set in Vercel → Settings → Environment Variables.");
    e.status = 500;
    throw e;
  }
  return t;
}

async function notion(path, method, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("https://api.notion.com/v1" + path, {
      method: method || "GET",
      headers: {
        Authorization: "Bearer " + token(),
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 429 && attempt < 2) {
      const wait = Number(res.headers.get("retry-after") || 1) * 1000;
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(json.message || "Notion error " + res.status);
      e.status = res.status;
      e.code = json.code;
      throw e;
    }
    return json;
  }
}

// Query every page of a data source (follows next_cursor). maxPages guards against runaway loops.
async function queryAll(dataSourceId, body, maxPages) {
  const out = [];
  let cursor;
  for (let i = 0; i < (maxPages || 10); i++) {
    const res = await notion("/data_sources/" + dataSourceId + "/query", "POST", Object.assign({ page_size: 100 }, body || {}, cursor ? { start_cursor: cursor } : {}));
    out.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return out;
}

// ---- property readers ----
const plain = arr => (arr || []).map(t => t.plain_text || "").join("");
function prop(page, name) {
  const p = page.properties && page.properties[name];
  if (!p) return null;
  switch (p.type) {
    case "title": return plain(p.title) || null;
    case "rich_text": return plain(p.rich_text) || null;
    case "select": return p.select ? p.select.name : null;
    case "status": return p.status ? p.status.name : null;
    case "multi_select": return (p.multi_select || []).map(o => o.name);
    case "date": return p.date ? p.date.start : null;
    case "relation": return (p.relation || []).map(r => r.id.replace(/-/g, ""));
    case "url": return p.url || null;
    case "number": return p.number;
    case "checkbox": return p.checkbox;
    case "people": return (p.people || []).map(u => u.name || u.id);
    default: return null;
  }
}
const pid = page => page.id.replace(/-/g, "");

function send(res, status, data, cacheSeconds) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "private, no-store"); // signed-in data must never be cached by Vercel's edge
  res.status(status).send(JSON.stringify(data));
}

// ---- login (Editoz email + team password) ----
// ACCESS_KEY = the team password. ALLOWED_DOMAIN defaults to editozclub.com.
// Sessions are signed cookies; changing ACCESS_KEY (or SESSION_SECRET) signs everyone out.
const crypto = require("crypto");
const COOKIE = "mo_session";
const SESSION_DAYS = 7;
const domain = () => String(process.env.ALLOWED_DOMAIN || "editozclub.com").toLowerCase().replace(/^@/, "");
const secret = () => process.env.SESSION_SECRET || crypto.createHash("sha256").update("mo-session:" + (process.env.ACCESS_KEY || "") + ":" + (process.env.NOTION_TOKEN || "")).digest("hex");
const b64 = s => Buffer.from(s).toString("base64url");
const sign = data => crypto.createHmac("sha256", secret()).update(data).digest("base64url");

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function emailAllowed(email) {
  const e = String(email || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(e) && e.endsWith("@" + domain()) ? e : null;
}
function makeSession(email) {
  const body = b64(JSON.stringify({ e: email, x: Date.now() + SESSION_DAYS * 864e5 }));
  return body + "." + sign(body);
}
function readSession(req) {
  const raw = String(req.headers.cookie || "").split(/;\s*/).find(c => c.startsWith(COOKIE + "="));
  if (!raw) return null;
  const [body, sig] = raw.slice(COOKIE.length + 1).split(".");
  if (!body || !sig || !safeEqual(sig, sign(body))) return null;
  try {
    const d = JSON.parse(Buffer.from(body, "base64url").toString());
    return d.x > Date.now() && emailAllowed(d.e) ? { email: d.e } : null;
  } catch (e) { return null; }
}
function setSessionCookie(res, value, maxAgeSeconds) {
  res.setHeader("Set-Cookie", COOKIE + "=" + value + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAgeSeconds);
}

// Every data route calls this. Returns the signed-in user, or sends 401 and returns null.
function checkKey(req, res) {
  if (!process.env.ACCESS_KEY) return { email: "open" }; // no password set = dashboard is open
  const user = readSession(req);
  if (user) return user;
  send(res, 401, { error: "locked", message: "Sign in with your Editoz email." });
  return null;
}

function fail(res, e) {
  const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
  let message = e.message || "Something went wrong.";
  if (e.code === "object_not_found") message = "The Notion integration can't see one of the databases. Share Project Tracker, PM Engine Projects, PM Engine Tasks and Strategy Board with it (••• → Connections).";
  if (e.code === "unauthorized") message = "The Notion token is wrong or was revoked. Update NOTION_TOKEN in Vercel and redeploy.";
  send(res, status, { error: e.code || "error", message });
}

module.exports = { DS, notion, queryAll, prop, pid, send, checkKey, fail, emailAllowed, safeEqual, makeSession, readSession, setSessionCookie, domain, SESSION_DAYS };
