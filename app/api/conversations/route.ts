import { NextRequest, NextResponse } from "next/server";
import { q, P, ensureTable } from "@/lib/db";
import { getSessionEmail } from "@/lib/session";

async function ensureTables() {
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
  await ensureTable(
    "CREATE TABLE IF NOT EXISTS " + P + "_conversation_participants (" +
    "id SERIAL PRIMARY KEY," +
    "conversation_id INTEGER NOT NULL," +
    "user_email TEXT NOT NULL," +
    "is_muted BOOLEAN DEFAULT FALSE," +
    "is_archived BOOLEAN DEFAULT FALSE," +
    "last_read_message_id INTEGER," +
    "created_at TIMESTAMPTZ DEFAULT now())"
  );
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
}

export async function GET(req: NextRequest) {
  const email = await getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await ensureTables();

  // Get all conversations where this user is a participant
  // Join with messages to get last message
  const rows = await q(
    `SELECT c.*,
      m.body AS last_message,
      m.created_at AS last_message_at,
      (
        SELECT COUNT(*)::int FROM ` + P + `_messages msg
        WHERE msg.conversation_id = c.id
          AND msg.deleted_at IS NULL
          AND msg.sender_email != $2
          AND msg.id > COALESCE(
            (SELECT cp.last_read_message_id FROM ` + P + `_conversation_participants cp
             WHERE cp.conversation_id = c.id AND cp.user_email = $3),
            0
          )
      ) AS unread_count
    FROM ` + P + `_conversations c
    LEFT JOIN LATERAL (
      SELECT body, created_at FROM ` + P + `_messages
      WHERE conversation_id = c.id AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    ) m ON true
    WHERE c.participant_a_email = $1 OR c.participant_b_email = $4
    ORDER BY COALESCE(m.created_at, c.created_at) DESC`,
    [email, email, email, email]
  );

  const conversations = rows.map((row: Record<string, unknown>) => ({
    ...row,
    other_email:
      row.participant_a_email === email
        ? row.participant_b_email
        : row.participant_a_email,
  }));

  return NextResponse.json({ conversations });
}

export async function POST(req: NextRequest) {
  const email = await getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await ensureTables();

  const { other_email } = await req.json();
  if (!other_email || typeof other_email !== "string") {
    return NextResponse.json({ error: "other_email required" }, { status: 400 });
  }
  const otherEmail = other_email.trim().toLowerCase();
  if (otherEmail === email) {
    return NextResponse.json({ error: "Cannot message yourself" }, { status: 400 });
  }

  // Alphabetical ordering for participant_a / participant_b
  const [pa, pb] = email < otherEmail ? [email, otherEmail] : [otherEmail, email];

  // Check if conversation already exists
  const existing = await q(
    `SELECT * FROM ` + P + `_conversations WHERE participant_a_email = $1 AND participant_b_email = $2`,
    [pa, pb]
  );

  let conversation: Record<string, unknown>;

  if (existing.length > 0) {
    conversation = existing[0];
  } else {
    const inserted = await q(
      `INSERT INTO ` + P + `_conversations (participant_a_email, participant_b_email)
       VALUES ($1, $2) RETURNING *`,
      [pa, pb]
    );
    conversation = inserted[0];

    // Create participant rows for both users
    await q(
      `INSERT INTO ` + P + `_conversation_participants (conversation_id, user_email) VALUES ($1, $2)`,
      [conversation.id, pa]
    );
    await q(
      `INSERT INTO ` + P + `_conversation_participants (conversation_id, user_email) VALUES ($1, $2)`,
      [conversation.id, pb]
    );
  }

  return NextResponse.json({
    conversation: {
      ...conversation,
      other_email: otherEmail,
    },
  });
}