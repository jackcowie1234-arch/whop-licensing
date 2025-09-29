// 1) Whop webhook (robust)
app.post("/whop/webhook", (req, res) => {
  const body = req.body || {};

  // Try multiple places for the event name
  const rawType =
    body.type ||
    body.event ||
    body.name ||
    body.action ||
    (body.topic && String(body.topic)) ||
    "";

  // Normalize underscores to dots (membership_went_valid -> membership.went_valid)
  let type = rawType.replace(/_/g, ".");

  // The payload data
  const data = body.data || body.resource || body.payload || {};

  // Try multiple places for membership id
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

  // If event missing, infer from flags or default to went_valid for tests
  if (!type && (data.status || data.valid !== undefined)) {
    const isValid =
      data.status === "valid" ||
      data.status === "active" ||
      data.valid === true;
    type = isValid ? "membership.went_valid" : "membership.went_invalid";
  }
  if (!type) type = "membership.went_valid";

  // Update in-memory state
  if (type === "membership.went_valid") {
    licenses.set(id, { status: "active", valid_until: data.valid_until || null });
  } else if (type === "membership.went_invalid") {
    licenses.set(id, { status: "inactive", valid_until: data.valid_until || null });
  }

  console.log("Whop event:", type, "id:", id); // <-- this will never be 'undefined' now
  return res.json({ ok: true });
});
