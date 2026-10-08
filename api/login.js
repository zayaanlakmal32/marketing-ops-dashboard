// POST /api/login  { email, password } → signs the person in for 7 days
// POST /api/login  { logout: true }     → signs out
// GET  /api/login                       → who is signed in (or 401)
const { send, emailAllowed, safeEqual, makeSession, readSession, setSessionCookie, domain, SESSION_DAYS } = require("../lib/notion");

module.exports = async (req, res) => {
  const password = process.env.ACCESS_KEY;
  if (req.method === "GET") {
    if (!password) return send(res, 200, { email: null, open: true });
    const user = readSession(req);
    return user ? send(res, 200, { email: user.email }) : send(res, 401, { error: "locked", message: "Not signed in." });
  }
  if (req.method !== "POST") return send(res, 405, { error: "method", message: "Use POST." });
  const b = req.body || {};
  if (b.logout) {
    setSessionCookie(res, "", 0);
    return send(res, 200, { ok: true });
  }
  if (!password) return send(res, 400, { error: "not_set_up", message: "No password is set. Add ACCESS_KEY in Vercel." });
  const email = emailAllowed(b.email);
  if (!email) return send(res, 403, { error: "bad_email", message: "Use your @" + domain() + " email." });
  if (!safeEqual(b.password || "", password)) {
    await new Promise(r => setTimeout(r, 600)); // slow down guessing
    return send(res, 401, { error: "bad_password", message: "Wrong password." });
  }
  setSessionCookie(res, makeSession(email), SESSION_DAYS * 86400);
  send(res, 200, { ok: true, email });
};
