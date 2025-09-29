const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

// Postgres connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Render provides this
  ssl: { rejectUnauthorized: false },
});

// Webhook endpoint
app.post("/whop/webhook", async (req, res) => {
  const event = req.body;
  console.log(`Whop event: ${event.type} id: ${event.data?.id}`);

  try {
    if (event.type === "membership_went_valid") {
      await pool.query(
        `INSERT INTO licenses (id, status, valid_until)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE
         SET status = EXCLUDED.status,
             valid_until = EXCLUDED.valid_until`,
        [event.data.id, "valid", event.data.valid_until]
      );
    }

    if (event.type === "membership_went_invalid") {
      await pool.query(
        `UPDATE licenses SET status = $2 WHERE id = $1`,
        [event.data.id, "invalid"]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// License validation
app.post("/validate", async (req, res) => {
  const { license_key } = req.body;

  try {
    const result = await pool.query(
      "SELECT * FROM licenses WHERE id = $1",
      [license_key]
    );

    if (result.rows.length === 0) {
      return res.json({ valid: false, reason: "unknown" });
    }

    const lic = result.rows[0];
    const now = new Date();

    if (
      lic.status === "valid" &&
      (!lic.valid_until || new Date(lic.valid_until) > now)
    ) {
      return res.json({ valid: true, expires_at: lic.valid_until });
    } else {
      return res.json({ valid: false, reason: "expired_or_invalid" });
    }
  } catch (err) {
    console.error("Validation error:", err);
    res.status(500).json({ valid: false, reason: "server_error" });
  }
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
