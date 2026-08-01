import { NextRequest, NextResponse } from "next/server";
import { q, P, ensureTable } from "@/lib/db";
import { getSessionEmail } from "@/lib/session";

async function ensureTables() {
  await ensureTable(
    "CREATE TABLE IF NOT EXISTS " + P + "_groups (id SERIAL PRIMARY KEY, name TEXT NOT NULL, creator_email TEXT NOT NULL, confidential_mode BOOLEAN DEFAULT FALSE, confidential_activated_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now())"
  );
  await ensureTable(
    "CREATE TABLE IF NOT EXISTS " + P + "_group_members (id SERIAL PRIMARY KEY, group_id INTEGER NOT NULL, user_email TEXT NOT NULL, accepted_nda BOOLEAN DEFAULT FALSE, nda_signed_name TEXT, nda_accepted_at TIMESTAMPTZ, invited_by TEXT, created_at TIMESTAMPTZ DEFAULT now())"
  );
  await ensureTable(
    "CREATE TABLE IF NOT EXISTS " + P + "_group_messages (id SERIAL PRIMARY KEY, group_id INTEGER NOT NULL, sender_email TEXT NOT NULL, body TEXT NOT NULL, is_encrypted BOOLEAN DEFAULT FALSE, deleted_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now())"
  );
}

export async function GET(req: NextRequest) {
  const email = await getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureTables();

  const { searchParams } = new URL(req.url);
  const group_id = searchParams.get("group_id");
  if (!group_id) return NextResponse.json({ error: "group_id required" }, { status: 400 });

  // Must be a member
  const memberRows = await q(
    "SELECT * FROM " + P + "_group_members WHERE group_id = $1 AND user_email = $2",
    [group_id, email]
  );
  if (memberRows.length === 0) return NextResponse.json({ error: "Not a member" }, { status: 403 });

  const messages = await q(
    "SELECT id, group_id, sender_email, body, is_encrypted, deleted_at, created_at FROM " +
      P + "_group_messages WHERE group_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC",
    [group_id]
  );

  return NextResponse.json({ messages });
}

export async function POST(req: NextRequest) {
  const email = await getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureTables();

  const body = await req.json();
  const { group_id, body: msgBody } = body;

  if (!group_id) return NextResponse.json({ error: "group_id required" }, { status: 400 });
  if (!msgBody?.trim()) return NextResponse.json({ error: "Message body required" }, { status: 400 });

  // Must be a member
  const memberRows = await q(
    "SELECT * FROM " + P + "_group_members WHERE group_id = $1 AND user_email = $2",
    [group_id, email]
  );
  if (memberRows.length === 0) return NextResponse.json({ error: "Not a member" }, { status: 403 });

  // Check confidential mode — if enabled but not yet fully activated (not all signed), block messages
  const groupRows = await q("SELECT * FROM " + P + "_groups WHERE id = $1", [group_id]);
  const group = groupRows[0];
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  const isEncrypted = !!(group.confidential_mode && group.confidential_activated_at);

  // If confidential requested but not all signed, still allow messages (they just won't be encrypted)
  const rows = await q(
    "INSERT INTO " + P + "_group_messages (group_id, sender_email, body, is_encrypted) VALUES ($1, $2, $3, $4) RETURNING *",
    [group_id, email, msgBody.trim(), isEncrypted]
  );

  return NextResponse.json({ message: rows[0] }, { status: 201 });
}