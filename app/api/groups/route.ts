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
}

export async function GET(req: NextRequest) {
  const email = await getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureTables();

  const rows = await q(
    "SELECT g.id, g.name, g.creator_email, g.confidential_mode, g.confidential_activated_at, g.created_at FROM " +
      P + "_groups g " +
      "INNER JOIN " + P + "_group_members gm ON gm.group_id = g.id AND gm.user_email = $1 " +
      "ORDER BY g.created_at DESC",
    [email]
  );

  const groups = await Promise.all(
    rows.map(async (g: any) => {
      const members = await q(
        "SELECT user_email, accepted_nda, nda_signed_name, nda_accepted_at, invited_by FROM " +
          P + "_group_members WHERE group_id = $1",
        [g.id]
      );
      const lastMsgRows = await q(
        "SELECT body, created_at FROM " + P + "_group_messages WHERE group_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
        [g.id]
      );
      return {
        ...g,
        members,
        last_message: lastMsgRows[0]?.body ?? null,
        last_message_at: lastMsgRows[0]?.created_at ?? null,
      };
    })
  );

  return NextResponse.json({ groups });
}

export async function POST(req: NextRequest) {
  const email = await getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureTables();

  const body = await req.json();
  const name = (body.name ?? "").trim();
  const inviteEmails: string[] = (body.invite_emails ?? []).map((e: string) => e.trim().toLowerCase()).filter(Boolean);

  if (!name) return NextResponse.json({ error: "Group name is required." }, { status: 400 });
  if (inviteEmails.length === 0) return NextResponse.json({ error: "Invite at least one other member." }, { status: 400 });

  // Verify all invited emails exist as users
  for (const ie of inviteEmails) {
    if (ie === email) continue;
    const userRows = await q("SELECT email FROM " + P + "_users WHERE email = $1", [ie]);
    if (userRows.length === 0) {
      return NextResponse.json({ error: `User not found: ${ie}` }, { status: 404 });
    }
  }

  const groupRows = await q(
    "INSERT INTO " + P + "_groups (name, creator_email) VALUES ($1, $2) RETURNING *",
    [name, email]
  );
  const group = groupRows[0];

  // Add creator as member (NDA auto-accepted for creator when they enable it later)
  await q(
    "INSERT INTO " + P + "_group_members (group_id, user_email, invited_by) VALUES ($1, $2, $3)",
    [group.id, email, email]
  );

  for (const ie of inviteEmails) {
    if (ie === email) continue;
    await q(
      "INSERT INTO " + P + "_group_members (group_id, user_email, invited_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [group.id, ie, email]
    );
  }

  const members = await q(
    "SELECT user_email, accepted_nda, nda_signed_name, nda_accepted_at, invited_by FROM " + P + "_group_members WHERE group_id = $1",
    [group.id]
  );

  return NextResponse.json({ group: { ...group, members } }, { status: 201 });
}