import { NextRequest, NextResponse } from "next/server";
import { q, P, ensureTable } from "@/lib/db";

async function ensureTables() {
  await ensureTable(
    "CREATE TABLE IF NOT EXISTS " + P + "_messages (" +
    "id SERIAL PRIMARY KEY," +
    "conversation_id INTEGER NOT NULL," +
    "sender_email TEXT NOT NULL," +
    "body TEXT NOT NULL," +
    "is_encrypted BOOLEAN DEFAULT FALSE," +
    "deleted_at TIMESTAMPTZ," +
    "created_at TIMESTAMPTZ DEFAULT now())"
  );
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

export async function GET(req: NextRequest) {
  // Simple shared-secret guard so this can be called from Vercel Cron or any scheduler.
  // Set CRON_SECRET in your environment (optional — if absent the route is open).
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== "Bearer " + secret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  await ensureTables();

  // Find all confidential conversations with an auto-delete timer set
  const convs = await q(
    `SELECT id, auto_delete_hours FROM ` + P + `_conversations WHERE confidential_mode = TRUE AND auto_delete_hours IS NOT NULL`,
    []
  );

  let totalDeleted = 0;

  for (const conv of convs) {
    const hours = conv.auto_delete_hours as number;
    // Soft-delete messages older than the configured window
    const result = await q(
      `UPDATE ` + P + `_messages
       SET deleted_at = now()
       WHERE conversation_id = $1
         AND deleted_at IS NULL
         AND created_at < now() - ($2 || ' hours')::INTERVAL
       RETURNING id`,
      [conv.id, String(hours)]
    );
    totalDeleted += result.length;
  }

  return NextResponse.json({ ok: true, deleted: totalDeleted, checked: convs.length });
}