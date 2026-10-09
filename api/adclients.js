// POST /api/adclients { clientId, clientName, running, resultLabel, currency, target }
//   → creates or updates that client's row in the Ad Clients database
const { notion, queryAll, send, checkKey, fail } = require("../lib/notion");

const RESULT_TYPES = ["Leads", "Purchases", "Bookings", "Messages", "Results"];
const CURRENCIES = ["AUD", "USD", "LKR", "GBP", "NZD", "CAD"];
const dashed = id => id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");

module.exports = async (req, res) => {
  if (!checkKey(req, res)) return;
  const ds = process.env.AD_CLIENTS_DS_ID;
  if (!ds) return send(res, 400, { error: "not_set_up", message: "Ad client settings aren't switched on yet (AD_CLIENTS_DS_ID is not set)." });
  if (req.method !== "POST") return send(res, 405, { error: "method", message: "Use POST." });
  try {
    const b = req.body || {};
    if (!/^[0-9a-f]{32}$/i.test(b.clientId || "")) return send(res, 400, { error: "bad_input", message: "Missing client." });
    const target = b.target === "" || b.target == null ? null : Number(b.target);
    if (target !== null && !(target >= 0)) return send(res, 400, { error: "bad_input", message: "Target must be a number." });
    const properties = {
      Name: { title: [{ text: { content: String(b.clientName || "Client").slice(0, 80) } }] },
      Client: { relation: [{ id: b.clientId }] },
      "Running Ads": { checkbox: !!b.running },
      "Result Type": { select: { name: RESULT_TYPES.includes(b.resultLabel) ? b.resultLabel : "Leads" } },
      Currency: { select: { name: CURRENCIES.includes(b.currency) ? b.currency : "AUD" } },
      Target: { number: target }
    };
    const existing = await queryAll(ds, { filter: { property: "Client", relation: { contains: dashed(b.clientId) } } }, 1);
    if (existing.length) await notion("/pages/" + existing[0].id, "PATCH", { properties });
    else await notion("/pages", "POST", { parent: { type: "data_source_id", data_source_id: ds }, properties });
    send(res, 200, { ok: true });
  } catch (e) {
    fail(res, e);
  }
};
