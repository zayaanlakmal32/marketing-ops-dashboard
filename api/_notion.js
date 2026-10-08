// Shared Notion helpers. Files starting with "_" are not exposed as routes by Vercel.
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
  if (cacheSeconds) res.setHeader("Cache-Control", "s-maxage=" + cacheSeconds + ", stale-while-revalidate=300");
  else res.setHeader("Cache-Control", "no-store");
  res.status(status).send(JSON.stringify(data));
}

// Optional shared password. If ACCESS_KEY is set in Vercel, every request must send it.
function checkKey(req, res) {
  const key = process.env.ACCESS_KEY;
  if (!key) return true;
  if (req.headers["x-access-key"] === key) return true;
  send(res, 401, { error: "locked", message: "Enter the dashboard password." });
  return false;
}

function fail(res, e) {
  const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
  let message = e.message || "Something went wrong.";
  if (e.code === "object_not_found") message = "The Notion integration can't see one of the databases. Share Project Tracker, PM Engine Projects, PM Engine Tasks and Strategy Board with it (••• → Connections).";
  if (e.code === "unauthorized") message = "The Notion token is wrong or was revoked. Update NOTION_TOKEN in Vercel and redeploy.";
  send(res, status, { error: e.code || "error", message });
}

module.exports = { DS, notion, queryAll, prop, pid, send, checkKey, fail };
