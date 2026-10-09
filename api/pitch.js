// POST /api/pitch { projectId, text } → saves the "Pitch Update" text on a PM Engine project
const { notion, send, checkKey, fail } = require("../lib/notion");

module.exports = async (req, res) => {
  if (!checkKey(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { error: "method", message: "Use POST." });
  try {
    const b = req.body || {};
    if (!/^[0-9a-f]{32}$/i.test(b.projectId || "")) return send(res, 400, { error: "bad_input", message: "Missing project." });
    const text = String(b.text || "").slice(0, 500);
    await notion("/pages/" + b.projectId, "PATCH", { properties: { "Pitch Update": { rich_text: text ? [{ text: { content: text } }] : [] } } });
    send(res, 200, { ok: true });
  } catch (e) {
    fail(res, e);
  }
};
