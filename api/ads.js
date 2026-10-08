// POST /api/ads   → add one ad entry to the Ad Log database in Notion
// DELETE /api/ads?id=<pageId> → move that entry to Notion's trash
const { notion, send, checkKey, fail } = require("./_notion");

const RESULT_TYPES = ["Leads", "Bookings", "Purchases", "Messages"];
const CURRENCIES = ["USD", "AUD", "LKR", "GBP", "NZD", "CAD"];

module.exports = async (req, res) => {
  if (!checkKey(req, res)) return;
  const ds = process.env.AD_LOG_DS_ID;
  if (!ds) return send(res, 400, { error: "not_set_up", message: "Ad logging isn't switched on yet (AD_LOG_DS_ID is not set)." });
  try {
    if (req.method === "POST") {
      const b = req.body || {};
      const spend = Number(b.spend), results = Number(b.results);
      if (!/^[0-9a-f]{32}$/i.test(b.clientId || "")) return send(res, 400, { error: "bad_input", message: "Choose a client." });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || "")) return send(res, 400, { error: "bad_input", message: "Pick a date." });
      if (!(spend >= 0) || !(results >= 0)) return send(res, 400, { error: "bad_input", message: "Spend and results must be 0 or more." });
      const page = await notion("/pages", "POST", {
        parent: { type: "data_source_id", data_source_id: ds },
        properties: {
          Entry: { title: [{ text: { content: String(b.clientName || "Ad entry").slice(0, 80) + " · " + b.date } }] },
          Client: { relation: [{ id: b.clientId }] },
          Date: { date: { start: b.date } },
          Spend: { number: spend },
          Results: { number: results },
          "Result Type": { select: { name: RESULT_TYPES.includes(b.resultLabel) ? b.resultLabel : "Leads" } },
          Currency: { select: { name: CURRENCIES.includes(b.currency) ? b.currency : "USD" } },
          Note: { rich_text: b.note ? [{ text: { content: String(b.note).slice(0, 300) } }] : [] }
        }
      });
      return send(res, 200, { ok: true, id: page.id.replace(/-/g, "") });
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
