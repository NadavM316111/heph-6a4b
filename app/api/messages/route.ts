import { NextRequest, NextResponse } from "next/server";
import { q, P, ensureTable } from "@/lib/db";
import { getSessionEmail } from "@/lib/session";

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
    "CREATE TABLE IF NOT EXISTS " + P + "_message_receipts (" +
    "id SERIAL PRIMARY KEY," +
    "message_id INTEGER NOT NULL," +
    "recipient_email TEXT NOT NULL," +
    "delivered_at TIMESTAMPTZ," +
    "read_at TIMESTAMPTZ," +
    "created_at TIMESTAMPTZ DEFAULT now())"
  );
}

export async function GET(req: NextRequest) {
  const email = await getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await ensureTables();

  const { searchParams } = new URL(req.url);
  const conversation_id = searchParams.get("conversation_id");
  if (!conversation_id) return NextResponse.json({ error: "conversation_id required" }, { status: 400 });

  const convId = parseInt(conversation_id, 10);

  // Verify user is a participant in this conversation
  const conv = await q(
    `SELECT id FROM ` + P + `_conversations WHERE id = $1 AND (participant_a_email = $2 OR participant_b_email = $3)`,
    [convId, email, email]
  );
  if (conv.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Fetch all non-deleted messages in the conversation
  const messages = await q(
    `SELECT * FROM ` + P + `_messages WHERE conversation_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
    [convId]
  );

  // Mark as delivered for the current user (non-sender messages)
  const undelivered = messages.filter((m: Record<string, unknown>) => m.sender_email !== email);
  for (const msg of undelivered) {
    const msgId = msg.id as number;
    const existing = await q(
      `SELECT id FROM ` + P + `_message_receipts WHERE message_id = $1 AND recipient_email = $2`,
      [msgId, email]
    );
    if (existing.length === 0) {
      await q(
        `INSERT INTO ` + P + `_message_receipts (message_id, recipient_email, delivered_at) VALUES ($1, $2, now())`,
        [msgId, email]
      );
    }
  }

  return NextResponse.json({ messages });
}

export async function POST(req: NextRequest) {
  const email = await getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await ensureTables();

  const { conversation_id, body } = await req.json();
  if (!conversation_id || !body?.trim()) {
    return NextResponse.json({ error: "conversation_id and body required" }, { status: 400 });
  }

  const convId = parseInt(String(conversation_id), 10);

  // Verify user is a participant
  const convRows = await q(
    `SELECT * FROM ` + P + `_conversations WHERE id = $1 AND (participant_a_email = $2 OR participant_b_email = $3)`,
    [convId, email, email]
  );
  if (convRows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const conv = convRows[0];
  const isEncrypted = conv.confidential_mode === true;

  const inserted = await q(
    `INSERT INTO ` + P + `_messages (conversation_id, sender_email, body, is_encrypted) VALUES ($1, $2, $3, $4) RETURNING *`,
    [convId, email, body.trim(), isEncrypted]
  );

  return NextResponse.json({ message: inserted[0] });
}