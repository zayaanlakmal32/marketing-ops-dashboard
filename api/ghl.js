// GET /api/ghl → checks the GHL connection and lists what the dashboard can see:
// workflow names (to find the 14/30 day checkpoints), tag names, and a sample contact search.
// Read-only. Never returns the token. Optional: ?q=<client name> to look up one contact.
const { send, checkKey } = require("../lib/notion");

const BASE = "https://services.leadconnectorhq.com";

async function ghl(path) {
  const res = await fetch(BASE + path, {
    headers: { Authorization: "Bearer " + process.env.GHL_TOKEN, Version: "2021-07-28", Accept: "application/json" }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.message || "GHL error " + res.status), { status: res.status });
  return json;
}

module.exports = async (req, res) => {
  if (!checkKey(req, res)) return;
  const loc = process.env.GHL_LOCATION_ID;
  if (!process.env.GHL_TOKEN || !loc) return send(res, 400, { ok: false, message: "Add GHL_TOKEN and GHL_LOCATION_ID in Vercel, then redeploy." });
  const out = { ok: true, location: loc };
  const step = async (name, fn) => { try { out[name] = await fn(); } catch (e) { out[name] = { error: e.message, status: e.status }; } };

  await step("workflows", async () => {
    const j = await ghl("/workflows/?locationId=" + encodeURIComponent(loc));
    return (j.workflows || []).map(w => ({ name: w.name, status: w.status }));
  });
  await step("tags", async () => {
    const j = await ghl("/locations/" + encodeURIComponent(loc) + "/tags");
    return (j.tags || []).map(t => t.name);
  });
  const q = String(req.query.q || "Heddi").slice(0, 60);
  await step("contactSample", async () => {
    const j = await ghl("/contacts/?locationId=" + encodeURIComponent(loc) + "&query=" + encodeURIComponent(q) + "&limit=3");
    out._firstId = (j.contacts || [])[0] && j.contacts[0].id;
    return (j.contacts || []).map(c => ({ name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.contactName, hasEmail: !!c.email, tags: c.tags || [], dateAdded: c.dateAdded }));
  });
  // What the checkpoint workflows leave on a contact: tasks and notes.
  if (out._firstId) {
    const id = encodeURIComponent(out._firstId);
    await step("contactTasks", async () => {
      const j = await ghl("/contacts/" + id + "/tasks");
      return (j.tasks || []).map(t => ({ title: t.title, due: t.dueDate, done: !!t.completed }));
    });
    await step("contactNotes", async () => {
      const j = await ghl("/contacts/" + id + "/notes");
      return (j.notes || []).slice(0, 10).map(n => ({ date: n.dateAdded, text: String(n.body || "").replace(/<[^>]+>/g, " ").slice(0, 120) }));
    });
  }
  delete out._firstId;
  send(res, 200, out);
};
