import { NextRequest, NextResponse } from "next/server";
import { q, P, ensureTable } from "@/lib/db";
import { getSessionEmail } from "@/lib/session";

async function ensureConvsTable() {
  await ensureTable(
    "CREATE TABLE IF NOT EXISTS " + P + "_conversations (" +
    "id SERIAL PRIMARY KEY," +
    "participant_a_email TEXT NOT NULL," +
    "participant_b_email TEXT NOT NULL," +
    "confidential_mode BOOLEAN DEFAULT FALSE," +
    "confidential_activated_at TIMESTAMPTZ," +
    "confidential_accepted_by_a BOOLEAN DEFAULT FALSE," +
    "confidential_accepted_by_b BOOLEAN DEFAULT FALSE," +
    "created_at TIMESTAMPTZ DEFAULT now())"
  );
  await q(`ALTER TABLE ` + P + `_conversations ADD COLUMN IF NOT EXISTS auto_delete_hours INTEGER`, []);
}

export async function PATCH(req: NextRequest) {
  const email = await getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await ensureConvsTable();

  const { conversation_id, auto_delete_hours } = await req.json();
  if (!conversation_id) {
    return NextResponse.json({ error: "conversation_id required" }, { status: 400 });
  }

  // Verify user is a participant
  const convRows = await q(
    `SELECT * FROM ` + P + `_conversations WHERE id = $1 AND (participant_a_email = $2 OR participant_b_email = $3)`,
    [conversation_id, email, email]
  );
  if (convRows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const conv = convRows[0];

  // Only allow changing auto-delete when confidential mode is active
  if (!conv.confidential_mode) {
    return NextResponse.json({ error: "Auto-delete is only available in confidential mode" }, { status: 400 });
  }

  // Validate value: null = off, or one of 1, 24, 168
  const ALLOWED = [null, 1, 24, 168];
  const hours = auto_delete_hours === null || auto_delete_hours === undefined ? null : parseInt(String(auto_delete_hours), 10);
  if (!ALLOWED.includes(hours)) {
    return NextResponse.json({ error: "Invalid auto_delete_hours value" }, { status: 400 });
  }

  const updated = await q(
    `UPDATE ` + P + `_conversations SET auto_delete_hours = $1 WHERE id = $2 RETURNING *`,
    [hours, conversation_id]
  );

  const isA = conv.participant_a_email === email;
  return NextResponse.json({
    conversation: {
      ...updated[0],
      other_email: isA ? conv.participant_b_email : conv.participant_a_email,
    },
  });
}