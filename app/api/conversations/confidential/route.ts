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
    "accepted_at TIMESTAMPTZ DEFAULT now()," +
    "created_at TIMESTAMPTZ DEFAULT now())"
  );
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

export async function POST(req: NextRequest) {
  const email = await getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await ensureNdaTables();

  const { conversation_id, enable, accept_nda } = await req.json();
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

    // Record NDA agreement
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const ua = req.headers.get("user-agent") || "unknown";

    await q(
      `INSERT INTO ` + P + `_nda_agreements (conversation_id, user_email, nda_version, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)`,
      [conversation_id, email, NDA_VERSION, ip, ua]
    );

    // Update conversation
    const acceptField = isA ? "confidential_accepted_by_a" : "confidential_accepted_by_b";
    const updateRows = await q(
      `UPDATE ` + P + `_conversations SET
        confidential_mode = TRUE,
        confidential_activated_at = COALESCE(confidential_activated_at, now()),
        ` + acceptField + ` = TRUE
       WHERE id = $1 RETURNING *`,
      [conversation_id]
    );

    return NextResponse.json({ conversation: { ...updateRows[0], other_email: isA ? conv.participant_b_email : conv.participant_a_email } });
  } else {
    // Disable confidential mode
    const updateRows = await q(
      `UPDATE ` + P + `_conversations SET confidential_mode = FALSE WHERE id = $1 RETURNING *`,
      [conversation_id]
    );
    return NextResponse.json({ conversation: { ...updateRows[0], other_email: isA ? conv.participant_b_email : conv.participant_a_email } });
  }
}