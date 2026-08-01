import { NextRequest, NextResponse } from "next/server";
import { q, P, ensureTable } from "@/lib/db";
import { getSessionEmail } from "@/lib/session";

async function ensureReactionsTable() {
  await ensureTable(
    "CREATE TABLE IF NOT EXISTS " + P + "_message_reactions (" +
    "id SERIAL PRIMARY KEY," +
    "message_id INTEGER NOT NULL," +
    "user_email TEXT NOT NULL," +
    "emoji TEXT NOT NULL," +
    "created_at TIMESTAMPTZ DEFAULT now()," +
    "UNIQUE(message_id, user_email, emoji))"
  );
}

export async function GET(req: NextRequest) {
  const email = await getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await ensureReactionsTable();

  const { searchParams } = new URL(req.url);
  const conversation_id = searchParams.get("conversation_id");
  if (!conversation_id) return NextResponse.json({ error: "conversation_id required" }, { status: 400 });

  const convId = parseInt(conversation_id, 10);

  // Verify the user is a participant
  const conv = await q(
    `SELECT id FROM ` + P + `_conversations WHERE id = $1 AND (participant_a_email = $2 OR participant_b_email = $3)`,
    [convId, email, email]
  );
  if (conv.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Fetch all reactions for messages in this conversation
  const reactions = await q(
    `SELECT r.message_id, r.user_email, r.emoji
     FROM ` + P + `_message_reactions r
     INNER JOIN ` + P + `_messages m ON m.id = r.message_id
     WHERE m.conversation_id = $1`,
    [convId]
  );

  return NextResponse.json({ reactions });
}

export async function POST(req: NextRequest) {
  const email = await getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await ensureReactionsTable();

  const { message_id, emoji } = await req.json();
  if (!message_id || !emoji) {
    return NextResponse.json({ error: "message_id and emoji required" }, { status: 400 });
  }

  const msgId = parseInt(String(message_id), 10);
  const ALLOWED = ["👍", "❤️", "😂", "😮", "😢", "🔥"];
  if (!ALLOWED.includes(emoji)) {
    return NextResponse.json({ error: "Emoji not allowed" }, { status: 400 });
  }

  // Verify the user is a participant in the conversation that contains this message
  const msgRows = await q(
    `SELECT m.id FROM ` + P + `_messages m
     INNER JOIN ` + P + `_conversations c ON c.id = m.conversation_id
     WHERE m.id = $1 AND (c.participant_a_email = $2 OR c.participant_b_email = $3)`,
    [msgId, email, email]
  );
  if (msgRows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Toggle: if the reaction already exists, delete it; otherwise insert it
  const existing = await q(
    `SELECT id FROM ` + P + `_message_reactions WHERE message_id = $1 AND user_email = $2 AND emoji = $3`,
    [msgId, email, emoji]
  );

  if (existing.length > 0) {
    await q(
      `DELETE FROM ` + P + `_message_reactions WHERE message_id = $1 AND user_email = $2 AND emoji = $3`,
      [msgId, email, emoji]
    );
    return NextResponse.json({ action: "removed" });
  } else {
    await q(
      `INSERT INTO ` + P + `_message_reactions (message_id, user_email, emoji) VALUES ($1, $2, $3)`,
      [msgId, email, emoji]
    );
    return NextResponse.json({ action: "added" });
  }
}