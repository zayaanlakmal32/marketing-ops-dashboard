// POST /api/ads  { entries: [{clientId, clientName, date, spend, results, resultLabel, currency, note}] }
//   → saves each entry to the Ad Log. One row per client per day: an existing row for that day is updated.
// DELETE /api/ads?id=<pageId> → moves that entry to Notion's trash
const { notion, queryAll, send, checkKey, fail } = require("../lib/notion");

const RESULT_TYPES = ["Leads", "Purchases", "Bookings", "Messages", "Results"];
const CURRENCIES = ["AUD", "USD", "LKR", "GBP", "NZD", "CAD"];
const dashed = id => id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");

function clean(e) {
  const spend = Number(e.spend), results = Number(e.results);
  if (!/^[0-9a-f]{32}$/i.test(e.clientId || "")) throw Object.assign(new Error("Choose a client."), { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || "")) throw Object.assign(new Error("Pick a date."), { status: 400 });
  if (!(spend >= 0) || !(results >= 0)) throw Object.assign(new Error("Spend and results must be 0 or more."), { status: 400 });
  return {
    clientId: e.clientId, date: e.date, spend, results,
    properties: {
      Entry: { title: [{ text: { content: String(e.clientName || "Ad entry").slice(0, 80) + " · " + e.date } }] },
      Client: { relation: [{ id: e.clientId }] },
      Date: { date: { start: e.date } },
      Spend: { number: spend },
      Results: { number: results },
      "Result Type": { select: { name: RESULT_TYPES.includes(e.resultLabel) ? e.resultLabel : "Leads" } },
      Currency: { select: { name: CURRENCIES.includes(e.currency) ? e.currency : "AUD" } },
      Note: { rich_text: e.note ? [{ text: { content: String(e.note).slice(0, 300) } }] : [] }
    }
  };
}

module.exports = async (req, res) => {
  if (!checkKey(req, res)) return;
  const ds = process.env.AD_LOG_DS_ID;
  if (!ds) return send(res, 400, { error: "not_set_up", message: "Ad logging isn't switched on yet (AD_LOG_DS_ID is not set)." });
  try {
    if (req.method === "POST") {
      const b = req.body || {};
      const list = Array.isArray(b.entries) ? b.entries : [b];
      if (!list.length) return send(res, 400, { error: "bad_input", message: "Nothing to save." });
      if (list.length > 60) return send(res, 400, { error: "bad_input", message: "Too many rows at once." });
      const rows = list.map(clean);
      let created = 0, updated = 0;
      for (const r of rows) {
        const existing = await queryAll(ds, { filter: { and: [
          { property: "Client", relation: { contains: dashed(r.clientId) } },
          { property: "Date", date: { equals: r.date } }
        ] } }, 1);
        if (existing.length) { await notion("/pages/" + existing[0].id, "PATCH", { properties: r.properties }); updated++; }
        else { await notion("/pages", "POST", { parent: { type: "data_source_id", data_source_id: ds }, properties: r.properties }); created++; }
      }
      return send(res, 200, { ok: true, created, updated });
    }
    if (req.method === "DELETE") {
      const id = String(req.query.id || "");
      if (!/^[0-9a-f]{32}$/i.test(id)) return send(res, 400, { error: "bad_input", message: "Missing entry id." });
      await notion("/pages/" + id, "PATCH", { in_trash: true });
      return send(res, 200, { ok: true });
    }
    send(res, 405, { error: "method", message: "Use POST or DELETE." });
  } catch (e) {
    fail(res, e);
  }
};
