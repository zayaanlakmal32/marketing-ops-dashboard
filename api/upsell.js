// POST /api/upsell → create or update one client's upsell checkpoint in Notion
const { notion, queryAll, send, checkKey, fail } = require("./_notion");

const STATUSES = { planned: "Planned", pitched: "Pitched", won: "Won", declined: "Declined" };
const dashed = id => id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");

module.exports = async (req, res) => {
  if (!checkKey(req, res)) return;
  const ds = process.env.UPSELL_DS_ID;
  if (!ds) return send(res, 400, { error: "not_set_up", message: "Upsell checkpoints aren't switched on yet (UPSELL_DS_ID is not set)." });
  if (req.method !== "POST") return send(res, 405, { error: "method", message: "Use POST." });
  try {
    const b = req.body || {};
    if (!/^[0-9a-f]{32}$/i.test(b.clientId || "")) return send(res, 400, { error: "bad_input", message: "Missing client." });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.nextDate || "")) return send(res, 400, { error: "bad_input", message: "Pick a checkpoint date." });
    const properties = {
      Name: { title: [{ text: { content: String(b.clientName || "Client").slice(0, 80) } }] },
      Client: { relation: [{ id: b.clientId }] },
      "Next Date": { date: { start: b.nextDate } },
      Offer: { select: b.offer ? { name: String(b.offer).slice(0, 90) } : null },
      Status: { select: { name: STATUSES[b.status] || "Planned" } },
      Note: { rich_text: b.note ? [{ text: { content: String(b.note).slice(0, 400) } }] : [] }
    };
    const existing = await queryAll(ds, { filter: { property: "Client", relation: { contains: dashed(b.clientId) } } }, 1);
    if (existing.length) await notion("/pages/" + existing[0].id, "PATCH", { properties });
    else await notion("/pages", "POST", { parent: { type: "data_source_id", data_source_id: ds }, properties });
    send(res, 200, { ok: true });
  } catch (e) {
    fail(res, e);
  }
};
