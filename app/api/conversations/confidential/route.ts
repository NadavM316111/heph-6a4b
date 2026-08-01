import { NextRequest, NextResponse } from "next/server";
import { q, P, ensureTable } from "@/lib/db";
import { getSessionEmail } from "@/lib/session";

async function ensureNdaTables() {
  await ensureTable(
    "CREATE TABLE IF NOT EXISTS " + P + "_nda_agreements (" +
    "id SERIAL PRIMARY KEY," +
    "conversation_id INTEGER NOT NULL," +
    "user_email TEXT NOT NULL," +
    "nda_version TEXT NOT NULL," +
    "ip_address TEXT," +
    "user_agent TEXT," +
    "signed_name TEXT," +
    "receipt_url TEXT," +
    "accepted_at TIMESTAMPTZ DEFAULT now()," +
    "created_at TIMESTAMPTZ DEFAULT now())"
  );
  // Add columns to existing tables if they were created without them
  await q(`ALTER TABLE ` + P + `_nda_agreements ADD COLUMN IF NOT EXISTS signed_name TEXT`, []);
  await q(`ALTER TABLE ` + P + `_nda_agreements ADD COLUMN IF NOT EXISTS receipt_url TEXT`, []);

  await ensureTable(
    "CREATE TABLE IF NOT EXISTS " + P + "_nda_documents (" +
    "id SERIAL PRIMARY KEY," +
    "version TEXT NOT NULL," +
    "jurisdiction TEXT NOT NULL," +
    "document_url TEXT NOT NULL," +
    "is_active BOOLEAN DEFAULT TRUE," +
    "effective_date TIMESTAMPTZ NOT NULL," +
    "created_at TIMESTAMPTZ DEFAULT now())"
  );
}

const NDA_VERSION = "2024-01";

export async function GET(req: NextRequest) {
  const email = await getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await ensureNdaTables();

  const { searchParams } = new URL(req.url);
  const conversation_id = searchParams.get("conversation_id");
  if (!conversation_id) return NextResponse.json({ error: "conversation_id required" }, { status: 400 });

  // Verify user is a participant
  const convRows = await q(
    `SELECT * FROM ` + P + `_conversations WHERE id = $1 AND (participant_a_email = $2 OR participant_b_email = $3)`,
    [conversation_id, email, email]
  );
  if (convRows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const conv = convRows[0];

  // Fetch NDA agreement records for both participants
  const agreements = await q(
    `SELECT user_email, nda_version, ip_address, signed_name, receipt_url, accepted_at
     FROM ` + P + `_nda_agreements
     WHERE conversation_id = $1
     ORDER BY accepted_at ASC`,
    [conversation_id]
  );

  return NextResponse.json({
    conversation: conv,
    agreements,
  });
}

export async function POST(req: NextRequest) {
  const email = await getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await ensureNdaTables();

  const { conversation_id, enable, accept_nda, signed_name, receipt_url } = await req.json();
  if (!conversation_id) return NextResponse.json({ error: "conversation_id required" }, { status: 400 });

  // Verify user is a participant
  const convRows = await q(
    `SELECT * FROM ` + P + `_conversations WHERE id = $1 AND (participant_a_email = $2 OR participant_b_email = $3)`,
    [conversation_id, email, email]
  );
  if (convRows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const conv = convRows[0];
  const isA = conv.participant_a_email === email;

  if (enable) {
    if (!accept_nda) {
      return NextResponse.json({ error: "NDA acceptance required" }, { status: 400 });
    }
    if (!signed_name || !signed_name.trim()) {
      return NextResponse.json({ error: "Signed name required" }, { status: 400 });
    }

    // Record NDA agreement
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const ua = req.headers.get("user-agent") || "unknown";

    await q(
      `INSERT INTO ` + P + `_nda_agreements (conversation_id, user_email, nda_version, ip_address, user_agent, signed_name, receipt_url) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [conversation_id, email, NDA_VERSION, ip, ua, signed_name.trim(), receipt_url || null]
    );

    // Mark this user's acceptance; only set confidential_mode=TRUE when BOTH parties have accepted
    const acceptField = isA ? "confidential_accepted_by_a" : "confidential_accepted_by_b";
    const otherAcceptField = isA ? "confidential_accepted_by_b" : "confidential_accepted_by_a";

    const updateRows = await q(
      `UPDATE ` + P + `_conversations SET
        ` + acceptField + ` = TRUE,
        confidential_activated_at = COALESCE(confidential_activated_at, now()),
        confidential_mode = CASE WHEN ` + otherAcceptField + ` = TRUE THEN TRUE ELSE FALSE END
       WHERE id = $1 RETURNING *`,
      [conversation_id]
    );

    const updated = updateRows[0];
    return NextResponse.json({
      conversation: { ...updated, other_email: isA ? conv.participant_b_email : conv.participant_a_email },
      both_accepted: updated.confidential_accepted_by_a && updated.confidential_accepted_by_b,
    });
  } else {
    // Disable confidential mode — reset both acceptance flags
    const updateRows = await q(
      `UPDATE ` + P + `_conversations SET
        confidential_mode = FALSE,
        confidential_accepted_by_a = FALSE,
        confidential_accepted_by_b = FALSE,
        confidential_activated_at = NULL
       WHERE id = $1 RETURNING *`,
      [conversation_id]
    );
    return NextResponse.json({ conversation: { ...updateRows[0], other_email: isA ? conv.participant_b_email : conv.participant_a_email } });
  }
}