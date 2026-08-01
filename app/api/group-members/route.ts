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

// POST: accept NDA for a group, or toggle confidential mode (creator only)
export async function POST(req: NextRequest) {
  const email = await getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureTables();

  const body = await req.json();
  const { group_id, action, signed_name, enable_confidential } = body;

  if (!group_id) return NextResponse.json({ error: "group_id required" }, { status: 400 });

  // Verify membership
  const memberRows = await q(
    "SELECT * FROM " + P + "_group_members WHERE group_id = $1 AND user_email = $2",
    [group_id, email]
  );
  if (memberRows.length === 0) return NextResponse.json({ error: "Not a member" }, { status: 403 });

  // Action: accept_nda
  if (action === "accept_nda") {
    const sname = (signed_name ?? "").trim();
    if (!sname) return NextResponse.json({ error: "Signed name required" }, { status: 400 });
    await q(
      "UPDATE " + P + "_group_members SET accepted_nda = TRUE, nda_signed_name = $1, nda_accepted_at = now() WHERE group_id = $2 AND user_email = $3",
      [sname, group_id, email]
    );

    // Check if all members have now accepted — if so, activate confidential mode
    const groupRows = await q("SELECT * FROM " + P + "_groups WHERE id = $1", [group_id]);
    const group = groupRows[0];
    if (group?.confidential_mode) {
      const allMembers = await q(
        "SELECT accepted_nda FROM " + P + "_group_members WHERE group_id = $1",
        [group_id]
      );
      const allAccepted = allMembers.every((m: any) => m.accepted_nda);
      if (allAccepted && !group.confidential_activated_at) {
        await q(
          "UPDATE " + P + "_groups SET confidential_activated_at = now() WHERE id = $1",
          [group_id]
        );
      }
    }

    const updatedGroup = await q("SELECT * FROM " + P + "_groups WHERE id = $1", [group_id]);
    const members = await q(
      "SELECT user_email, accepted_nda, nda_signed_name, nda_accepted_at, invited_by FROM " + P + "_group_members WHERE group_id = $1",
      [group_id]
    );
    return NextResponse.json({ group: { ...updatedGroup[0], members } });
  }

  // Action: toggle confidential (creator only)
  if (action === "toggle_confidential") {
    const groupRows = await q("SELECT * FROM " + P + "_groups WHERE id = $1", [group_id]);
    const group = groupRows[0];
    if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
    if (group.creator_email !== email) return NextResponse.json({ error: "Only the creator can toggle confidential mode" }, { status: 403 });

    if (enable_confidential) {
      // Enable: reset all member NDA acceptances, require fresh signatures
      await q(
        "UPDATE " + P + "_groups SET confidential_mode = TRUE, confidential_activated_at = NULL WHERE id = $1",
        [group_id]
      );
      await q(
        "UPDATE " + P + "_group_members SET accepted_nda = FALSE, nda_signed_name = NULL, nda_accepted_at = NULL WHERE group_id = $1",
        [group_id]
      );
    } else {
      await q(
        "UPDATE " + P + "_groups SET confidential_mode = FALSE, confidential_activated_at = NULL WHERE id = $1",
        [group_id]
      );
    }

    const updatedGroup = await q("SELECT * FROM " + P + "_groups WHERE id = $1", [group_id]);
    const members = await q(
      "SELECT user_email, accepted_nda, nda_signed_name, nda_accepted_at, invited_by FROM " + P + "_group_members WHERE group_id = $1",
      [group_id]
    );
    return NextResponse.json({ group: { ...updatedGroup[0], members } });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

// GET: list members of a group
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

  const members = await q(
    "SELECT user_email, accepted_nda, nda_signed_name, nda_accepted_at, invited_by FROM " + P + "_group_members WHERE group_id = $1",
    [group_id]
  );
  return NextResponse.json({ members });
}