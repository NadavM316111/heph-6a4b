import { NextRequest, NextResponse } from "next/server";
import { q, P, ensureTable } from "@/lib/db";
import { getSessionEmail } from "@/lib/session";

async function ensureTables() {
  await ensureTable(
    "CREATE TABLE IF NOT EXISTS " + P + "_group_members (id SERIAL PRIMARY KEY, group_id INTEGER NOT NULL, user_email TEXT NOT NULL, accepted_nda BOOLEAN DEFAULT FALSE, nda_signed_name TEXT, nda_accepted_at TIMESTAMPTZ, invited_by TEXT, created_at TIMESTAMPTZ DEFAULT now())"
  );
  await ensureTable(
    "CREATE TABLE IF NOT EXISTS " + P + "_group_message_reactions (id SERIAL PRIMARY KEY, message_id INTEGER NOT NULL, group_id INTEGER NOT NULL, user_email TEXT NOT NULL, emoji TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now())"
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

  const reactions = await q(
    "SELECT message_id, user_email, emoji FROM " + P + "_group_message_reactions WHERE group_id = $1",
    [group_id]
  );
  return NextResponse.json({ reactions });
}

export async function POST(req: NextRequest) {
  const email = await getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureTables();

  const body = await req.json();
  const { message_id, group_id, emoji } = body;
  if (!message_id || !group_id || !emoji) return NextResponse.json({ error: "message_id, group_id, emoji required" }, { status: 400 });

  // Must be a member
  const memberRows = await q(
    "SELECT * FROM " + P + "_group_members WHERE group_id = $1 AND user_email = $2",
    [group_id, email]
  );
  if (memberRows.length === 0) return NextResponse.json({ error: "Not a member" }, { status: 403 });

  // Toggle: if already reacted with this emoji, remove it; otherwise add
  const existing = await q(
    "SELECT id FROM " + P + "_group_message_reactions WHERE message_id = $1 AND user_email = $2 AND emoji = $3",
    [message_id, email, emoji]
  );
  if (existing.length > 0) {
    await q(
      "DELETE FROM " + P + "_group_message_reactions WHERE message_id = $1 AND user_email = $2 AND emoji = $3",
      [message_id, email, emoji]
    );
  } else {
    await q(
      "INSERT INTO " + P + "_group_message_reactions (message_id, group_id, user_email, emoji) VALUES ($1, $2, $3, $4)",
      [message_id, group_id, email, emoji]
    );
  }
  return NextResponse.json({ ok: true });
}