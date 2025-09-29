// Whop licensing server with Postgres persistence (CommonJS)
const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

// ---------- Postgres ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // set this in Render → Environment
  ssl: { rejectUnauthorized: false },
});

// create table if it doesn't exist
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,          -- 'active' | 'inactive'
      valid_until TIMESTAMPTZ NULL
    )
  `);
  console.log("DB ready ✅");
}

// helpers
async function upsertLicense(id, status, validUntil) {
  await pool.query(
    `INSERT INTO licenses (id, status, valid_until)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE
       SET status = EXCLUDED.status,
           valid_until = EXCLUDED.valid_until`,
    [id, status, validUntil ? new Date(validUntil) : null]
  );
}

async function getLicense(id) {
  const r = await pool.query(
    `SELECT status, EXTRACT(EPOCH FROM valid_until) AS exp
     FROM licenses WHERE id=$1`,
    [id]
  );
  return r.rows[0] || null;
}

// ---------- Webhook (Whop) ----------
app.post("/whop/webhook", async (req, res) => {
  try {
    const body = req.body || {};

    // event name (normalize underscores to dots)
    const rawType =
      body.type || body.event || body.name || body.action || (body.topic && String(body.topic)) || "";
    let type = rawType.replace(/_/g, ".");

    // payload data
    const data = body.data || body.resource || body.payload || {};

    // membership id from common locations
    const id =
      data.id ??
      data.membership_id ??
      data.membership?.id ??
      data.order?.membership_id ??
      data.order?.membership?.id ??
      data.user_membership_id;

    if (!id) return res.status(400).send("no membership id");

    // infer event if missing
    if (!type && (data.status || data.valid !== undefined)) {
      const isValid = data.status === "valid" || data.status === "active" || data.valid === true;
      type = isValid ? "membership.went_valid" : "membership.went_invalid";
    }
    if (!type) type = "membership.went_valid";

    // persist
    if (type === "membership.went_valid") {
      await upsertLicense(id, "active", data.valid_until || null);
    } else if (type === "membership.went_invalid") {
      await upsertLicense(id, "inactive", data.valid_until || null);
    }

    console.log("Whop event:", type, "id:", id);
    return res.json({ ok: true });
  } catch (e) {
    console.error("Webhook error:", e);
    return res.status(500).json({ ok: false });
  }
});

// ---------- Validate ----------
app.post("/validate", async (req, res) => {
  try {
    const { license_key } = req.body || {};
    if (!license_key) return res.status(400).json({ valid: false, reason: "missing_license_key" });

    const rec = await getLicense(license_key);
    if (!rec) return res.json({ valid: false, reason: "unknown" });
    if (rec.status !== "active") return res.json({ valid: false, reason: "inactive" });

    return res.json({ valid: true, expires_at: rec.exp ? Math.floor(rec.exp) : null });
  } catch (e) {
    console.error("Validate error:", e);
    return res.status(500).json({ valid: false, reason: "server_error" });
  }
});

// ---------- Health ----------
app.get("/", (_, res) => res.send("Whop licensing server running."));

// ---------- Start ----------
const PORT = process.env.PORT || 10000;
initDb().then(() => app.listen(PORT, () => console.log("Listening on", PORT)));
