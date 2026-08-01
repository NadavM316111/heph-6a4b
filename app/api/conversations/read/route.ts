import { NextRequest, NextResponse } from "next/server";
import { q, P } from "@/lib/db";
import { getSessionEmail } from "@/lib/session";

export async function POST(req: NextRequest) {
  const email = await getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { conversation_id } = await req.json();
  if (!conversation_id) return NextResponse.json({ error: "conversation_id required" }, { status: 400 });

  // Verify user is a participant
  const conv = await q(
    `SELECT id FROM ` + P + `_conversations WHERE id = $1 AND (participant_a_email = $2 OR participant_b_email = $3)`,
    [conversation_id, email, email]
  );
  if (conv.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Get the latest message id
  const latest = await q(
    `SELECT id FROM ` + P + `_messages WHERE conversation_id = $1 AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`,
    [conversation_id]
  );
  if (latest.length === 0) return NextResponse.json({ ok: true });

  const lastId = latest[0].id;

  // Upsert last_read_message_id
  const existing = await q(
    `SELECT id FROM ` + P + `_conversation_participants WHERE conversation_id = $1 AND user_email = $2`,
    [conversation_id, email]
  );

  if (existing.length > 0) {
    await q(
      `UPDATE ` + P + `_conversation_participants SET last_read_message_id = $1 WHERE conversation_id = $2 AND user_email = $3`,
      [lastId, conversation_id, email]
    );
  } else {
    await q(
      `INSERT INTO ` + P + `_conversation_participants (conversation_id, user_email, last_read_message_id) VALUES ($1, $2, $3)`,
      [conversation_id, email, lastId]
    );
  }

  return NextResponse.json({ ok: true });
}