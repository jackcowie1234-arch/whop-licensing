// Simple licensing server for Whop + MQL5 (Express)
const express = require("express");
const app = express();
app.use(express.json());

// In-memory store (resets if server restarts). Later, use Postgres/Redis.
const licenses = new Map();

// 1) Whop webhook
app.post("/whop/webhook", (req, res) => {
  const { type, data } = req.body || {};
  const id = data?.id || data?.membership_id;
  if (!id) return res.status(400).send("no membership id");

  if (type === "membership.went_valid") {
    licenses.set(id, { status: "active", valid_until: data?.valid_until || null });
  } else if (type === "membership.went_invalid") {
    licenses.set(id, { status: "inactive", valid_until: data?.valid_until || null });
  }

  console.log("Whop event:", type, "id:", id);
  return res.json({ ok: true });
});

// 2) EA validate
app.post("/validate", (req, res) => {
  const { license_key } = req.body || {};
  if (!license_key) return res.status(400).json({ valid: false, reason: "missing license_key" });

  const rec = licenses.get(license_key);
  if (!rec) return res.json({ valid: false, reason: "unknown" });
  if (rec.status !== "active") return res.json({ valid: false, reason: "inactive" });

  let expUnix = null;
  if (rec.valid_until) {
    const ms = Date.parse(rec.valid_until);
    if (!isNaN(ms)) expUnix = Math.floor(ms / 1000);
  }
  return res.json({ valid: true, expires_at: expUnix });
});

// health check
app.get("/", (_, res) => res.send("Whop licensing server running."));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Listening on", PORT));
// 1) Whop webhook (robust to different payload shapes)
app.post("/whop/webhook", (req, res) => {
  const body = req.body || {};

  // Try multiple places for event/type (some tests send underscores, some send nothing)
  const rawType =
    body.type ||
    body.event ||
    body.name ||
    body.action ||
    (body.topic && String(body.topic)) ||
    "";

  const data = body.data || body.resource || body.payload || {};

  // Normalize "membership_went_valid" -> "membership.went_valid"
  let type = rawType.replace(/_/g, ".");

  // Find membership id in common places
  const id =
    data.id ??
    data.membership_id ??
    data.membership?.id ??
    data.order?.membership_id ??
    data.order?.membership?.id ??
    data.user_membership_id;

  if (!id) {
    console.log("Webhook w/out id:", JSON.stringify(body));
    return res.status(400).send("no membership id");
  }

  // If type missing, infer from status flags in payload (common in tests)
  if (!type && (data.status || data.valid !== undefined)) {
    const isValid =
      data.status === "valid" ||
      data.status === "active" ||
      data.valid === true;
    type = isValid ? "membership.went_valid" : "membership.went_invalid";
  }

  // Default: if still missing, treat as went_valid so testing unblocks
  if (!type) type = "membership.went_valid";

  // Update in-memory license state
  if (type === "membership.went_valid") {
    licenses.set(id, {
      status: "active",
      valid_until: data.valid_until || null,
    });
  } else if (type === "membership.went_invalid") {
    licenses.set(id, {
      status: "inactive",
      valid_until: data.valid_until || null,
    });
  }

  console.log("Whop event:", type, "id:", id);
  return res.json({ ok: true });
});
