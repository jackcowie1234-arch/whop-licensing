const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// --------------------
// Webhook endpoint
// --------------------
app.post("/whop/webhook", async (req, res) => {
  try {
    const body = req.body || {};

    // 1) Event type (check multiple spots)
    let type =
      body.type ||
      body.event ||
      body.name ||
      body.action ||
      body.topic ||
      body?.data?.event ||
      "";

    if (typeof type === "string") type = type.replace(/_/g, ".");

    // 2) Membership ID (check multiple spots)
    const data = body.data || body.payload || body.resource || {};
    const id =
      data.id ??
      data.membership_id ??
      data.membership?.id ??
      data.order?.membership_id ??
      data.order?.membership?.id ??
      data.user_membership_id;

    if (!id) return res.status(400).send("no membership id");

    // 3) Infer type if missing
    if (!type) {
      const status =
        data.status || data.membership?.status || data.subscription?.status;
      const validFlag = data.valid ?? data.is_valid ?? data.active;
      const isValid =
        validFlag === true || status === "valid" || status === "active";
      type = isValid ? "membership.went_valid" : "membership.went_invalid";
    }

    // 4) Save/update DB
    if (type === "membership.went_valid" || type === "membership.went.valid") {
      await pool.query(
        `INSERT INTO licenses (id, status, valid_until)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE
           SET status = EXCLUDED.status,
               valid_until = EXCLUDED.valid_until`,
        [id, "valid", data.valid_until || null]
      );
    } else if (
      type === "membership.went_invalid" ||
      type === "membership.went.invalid"
    ) {
      await pool.query(
        `INSERT INTO licenses (id, status, valid_until)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE
           SET status = 'invalid', valid_until = EXCLUDED.valid_until`,
        [id, "invalid", data.valid_until || null]
      );
    }

    console.log("Whop event:", type || "inferred", "id:", id);
    return res.json({ ok: true });
  } catch (e) {
    console.error("Webhook error:", e);
    return res.status(500).json({ ok: false });
  }
});

// --------------------
// License validation endpoint
// --------------------
app.post("/validate", async (req, res) => {
  const { license_key } = req.body || {};
  if (!license_key) return res.status(400).json({ valid: false, reason: "missing key" });

  try {
    const result = await pool.query("SELECT * FROM licenses WHERE id=$1", [license_key]);

    if (result.rows.length === 0) {
      return res.json({ valid: false, reason: "unknown" });
    }

    const row = result.rows[0];
    if (row.status === "valid") {
      return res.json({ valid: true });
    } else {
      return res.json({ valid: false, reason: "invalid" });
    }
  } catch (err) {
    console.error("Validate error:", err);
    return res.status(500).json({ valid: false, reason: "server error" });
  }
});

// --------------------
// Start server
// --------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Whop licensing server running on ${PORT}`));
