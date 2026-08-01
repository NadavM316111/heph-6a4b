"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface User {
  email: string;
}

interface Conversation {
  id: number;
  participant_a_email: string;
  participant_b_email: string;
  confidential_mode: boolean;
  confidential_activated_at: string | null;
  confidential_accepted_by_a: boolean;
  confidential_accepted_by_b: boolean;
  created_at: string;
  other_email: string;
  last_message?: string;
  last_message_at?: string;
  unread_count?: number;
}

interface Message {
  id: number;
  conversation_id: number;
  sender_email: string;
  body: string;
  is_encrypted: boolean;
  deleted_at: string | null;
  created_at: string;
}

type View = "list" | "chat" | "new";

export default function Home() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [view, setView] = useState<View>("list");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgInput, setMsgInput] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newEmailError, setNewEmailError] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginMode, setLoginMode] = useState<"login" | "signup">("login");
  const [loginError, setLoginError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ndaModal, setNdaModal] = useState(false);
  const [ndaConvId, setNdaConvId] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auth check
  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => setUser(d.email ? { email: d.email } : null))
      .catch(() => setUser(null));
  }, []);

  const fetchConversations = useCallback(async () => {
    if (!user) return;
    const res = await fetch("/api/conversations");
    if (res.ok) {
      const data = await res.json();
      setConversations(data.conversations || []);
    }
  }, [user]);

  const fetchMessages = useCallback(async (convId: number) => {
    const res = await fetch(`/api/messages?conversation_id=${convId}`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages || []);
    }
  }, []);

  useEffect(() => {
    if (user) fetchConversations();
  }, [user, fetchConversations]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (view === "list" && user) {
      pollRef.current = setInterval(fetchConversations, 5000);
    } else if (view === "chat" && activeConv) {
      pollRef.current = setInterval(() => fetchMessages(activeConv.id), 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [view, user, activeConv, fetchConversations, fetchMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: loginMode, email: loginEmail, password: loginPassword }),
      });
      const d = await res.json();
      if (!res.ok) {
        setLoginError(d.error || "Authentication failed");
      } else {
        setUser({ email: d.email });
      }
    } catch {
      setLoginError("Network error");
    }
    setLoading(false);
  };

  const handleLogout = async () => {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "logout" }),
    });
    setUser(null);
    setView("list");
    setActiveConv(null);
    setConversations([]);
  };

  const openConversation = async (conv: Conversation) => {
    setActiveConv(conv);
    setView("chat");
    await fetchMessages(conv.id);
    // Mark as read
    await fetch("/api/conversations/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: conv.id }),
    });
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!msgInput.trim() || !activeConv) return;
    const body = msgInput.trim();
    setMsgInput("");
    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: activeConv.id, body }),
    });
    if (res.ok) {
      await fetchMessages(activeConv.id);
      await fetchConversations();
    }
  };

  const startNewConversation = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewEmailError("");
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    if (email === user?.email) {
      setNewEmailError("You can't message yourself.");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ other_email: email }),
    });
    const d = await res.json();
    setLoading(false);
    if (!res.ok) {
      setNewEmailError(d.error || "Could not start conversation.");
      return;
    }
    setNewEmail("");
    await fetchConversations();
    const conv = d.conversation as Conversation;
    conv.other_email = email === user?.email
      ? conv.participant_a_email
      : conv.participant_a_email === user?.email
        ? conv.participant_b_email
        : conv.participant_a_email;
    openConversation(conv);
    setView("chat");
  };

  const toggleConfidential = async (conv: Conversation) => {
    if (!conv.confidential_mode) {
      // Show NDA acceptance modal
      setNdaConvId(conv.id);
      setNdaModal(true);
    } else {
      // Turn off
      const res = await fetch("/api/conversations/confidential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conv.id, enable: false }),
      });
      if (res.ok) {
        const updated = { ...conv, confidential_mode: false };
        setActiveConv(updated);
        await fetchConversations();
      }
    }
  };

  const acceptNda = async () => {
    if (!ndaConvId) return;
    const res = await fetch("/api/conversations/confidential", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: ndaConvId, enable: true, accept_nda: true }),
    });
    if (res.ok) {
      const d = await res.json();
      setNdaModal(false);
      setNdaConvId(null);
      if (activeConv && activeConv.id === ndaConvId) {
        setActiveConv(d.conversation || { ...activeConv, confidential_mode: true });
      }
      await fetchConversations();
    }
  };

  const myEmail = user?.email || "";

  // Loading state
  if (user === undefined) {
    return (
      <div style={styles.centered}>
        <div style={styles.spinner} />
      </div>
    );
  }

  // Login / Signup
  if (!user) {
    return (
      <div style={styles.authWrap}>
        <div style={styles.authCard}>
          <div style={styles.logoRow}>
            <span style={styles.logoIcon}>🔐</span>
            <span style={styles.logoText}>ConfiMessage</span>
          </div>
          <p style={styles.authSub}>Private, confidential messaging</p>
          <div style={styles.tabRow}>
            <button
              style={loginMode === "login" ? styles.tabActive : styles.tab}
              onClick={() => setLoginMode("login")}
            >
              Log In
            </button>
            <button
              style={loginMode === "signup" ? styles.tabActive : styles.tab}
              onClick={() => setLoginMode("signup")}
            >
              Sign Up
            </button>
          </div>
          <form onSubmit={handleLogin} style={styles.form}>
            <input
              style={styles.input}
              type="email"
              placeholder="Email"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              required
            />
            <input
              style={styles.input}
              type="password"
              placeholder="Password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              required
            />
            {loginError && <p style={styles.errorText}>{loginError}</p>}
            <button style={styles.btnPrimary} type="submit" disabled={loading}>
              {loading ? "Please wait…" : loginMode === "login" ? "Log In" : "Create Account"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // NDA Modal
  const NdaModal = () => (
    <div style={styles.modalOverlay}>
      <div style={styles.modalBox}>
        <h2 style={styles.modalTitle}>🔒 Enable Confidential Mode</h2>
        <p style={styles.modalBody}>
          By enabling Confidential Mode, you agree that this entire conversation
          is covered under an <strong>International Non-Disclosure Agreement (NDA)</strong>.
        </p>
        <div style={styles.ndaScroll}>
          <h3>International Non-Disclosure Agreement</h3>
          <p><strong>Version:</strong> 2024-01 &nbsp;|&nbsp; <strong>Jurisdiction:</strong> International</p>
          <p>
            This Non-Disclosure Agreement (&quot;Agreement&quot;) is entered into between the
            participants of this conversation (&quot;Parties&quot;) as identified by their
            registered ConfiMessage account emails.
          </p>
          <p><strong>1. Confidential Information.</strong> All messages, files, and data
            exchanged within this conversation once Confidential Mode is activated shall
            be deemed &quot;Confidential Information.&quot; Each Party agrees not to disclose,
            reproduce, or distribute Confidential Information to any third party without
            prior written consent from the other Party.</p>
          <p><strong>2. Duration.</strong> This Agreement shall remain in force indefinitely
            from the date of activation unless both Parties agree in writing to terminate it.</p>
          <p><strong>3. Governing Law.</strong> This Agreement is governed by international
            treaty obligations and the laws of the jurisdiction most favorable to enforcing
            confidentiality, including but not limited to GDPR (EU), the Defend Trade Secrets
            Act (USA), and equivalent statutes in all signatory nations of the UN Convention
            on Contracts.</p>
          <p><strong>4. Remedies.</strong> Both Parties acknowledge that a breach of this
            Agreement may cause irreparable harm and that the non-breaching Party shall be
            entitled to seek injunctive relief in any court of competent jurisdiction, in
            addition to any other remedies available at law or in equity.</p>
          <p><strong>5. Entire Agreement.</strong> This Agreement constitutes the entire
            understanding between the Parties with respect to the subject matter hereof
            and supersedes all prior negotiations, representations, or agreements.</p>
          <p><strong>6. Acceptance.</strong> By clicking &quot;I Accept &amp; Enable Confidential Mode&quot;
            you acknowledge that you have read, understood, and agree to be bound by the
            terms of this Agreement. Your IP address and device information will be recorded
            as proof of acceptance.</p>
        </div>
        <div style={styles.modalActions}>
          <button
            style={styles.btnSecondary}
            onClick={() => { setNdaModal(false); setNdaConvId(null); }}
          >
            Cancel
          </button>
          <button style={styles.btnConfidential} onClick={acceptNda}>
            I Accept &amp; Enable Confidential Mode
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={styles.appWrap}>
      {ndaModal && <NdaModal />}
      {/* Sidebar */}
      <div style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <span style={styles.logoIcon}>🔐</span>
          <span style={styles.sidebarTitle}>ConfiMessage</span>
          <button style={styles.newChatBtn} onClick={() => setView("new")} title="New conversation">
            ✏️
          </button>
        </div>
        <div style={styles.meRow}>
          <span style={styles.meEmail}>{myEmail}</span>
          <button style={styles.logoutBtn} onClick={handleLogout}>Out</button>
        </div>
        <div style={styles.convList}>
          {conversations.length === 0 && (
            <p style={styles.emptyList}>No conversations yet.<br />Click ✏️ to start one.</p>
          )}
          {conversations.map((conv) => (
            <div
              key={conv.id}
              style={{
                ...styles.convItem,
                ...(activeConv?.id === conv.id ? styles.convItemActive : {}),
              }}
              onClick={() => openConversation(conv)}
            >
              <div style={styles.convAvatar}>
                {conv.other_email[0].toUpperCase()}
              </div>
              <div style={styles.convInfo}>
                <div style={styles.convTopRow}>
                  <span style={styles.convEmail}>{conv.other_email}</span>
                  {conv.confidential_mode && (
                    <span style={styles.confiBadge}>🔒 NDA</span>
                  )}
                </div>
                {conv.last_message && (
                  <span style={styles.convSnippet}>{conv.last_message}</span>
                )}
              </div>
              {(conv.unread_count ?? 0) > 0 && (
                <span style={styles.unreadBadge}>{conv.unread_count}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Main panel */}
      <div style={styles.main}>
        {view === "new" && (
          <div style={styles.newConvWrap}>
            <h2 style={styles.newConvTitle}>New Conversation</h2>
            <p style={styles.newConvSub}>Enter the email address of the person you want to message.</p>
            <form onSubmit={startNewConversation} style={styles.newConvForm}>
              <input
                style={styles.input}
                type="email"
                placeholder="their@email.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
                autoFocus
              />
              {newEmailError && <p style={styles.errorText}>{newEmailError}</p>}
              <div style={{ display: "flex", gap: 10 }}>
                <button style={styles.btnSecondary} type="button" onClick={() => setView("list")}>
                  Cancel
                </button>
                <button style={styles.btnPrimary} type="submit" disabled={loading}>
                  {loading ? "Starting…" : "Start Conversation"}
                </button>
              </div>
            </form>
          </div>
        )}

        {view === "list" && (
          <div style={styles.emptyMain}>
            <span style={{ fontSize: 64 }}>🔐</span>
            <h2 style={styles.emptyMainTitle}>Welcome to ConfiMessage</h2>
            <p style={styles.emptyMainSub}>Select a conversation or start a new one.</p>
            <button style={styles.btnPrimary} onClick={() => setView("new")}>
              ✏️ New Conversation
            </button>
          </div>
        )}

        {view === "chat" && activeConv && (
          <div style={styles.chatWrap}>
            {/* Chat header */}
            <div style={styles.chatHeader}>
              <button style={styles.backBtn} onClick={() => { setView("list"); setActiveConv(null); }}>
                ←
              </button>
              <div style={styles.chatAvatar}>
                {activeConv.other_email[0].toUpperCase()}
              </div>
              <div style={styles.chatHeaderInfo}>
                <span style={styles.chatHeaderEmail}>{activeConv.other_email}</span>
                {activeConv.confidential_mode && (
                  <span style={styles.confiBadgeSmall}>🔒 Confidential (NDA Active)</span>
                )}
              </div>
              <div style={styles.confidentialToggle}>
                <span style={styles.toggleLabel}>Confidential</span>
                <button
                  style={{
                    ...styles.toggleBtn,
                    ...(activeConv.confidential_mode ? styles.toggleBtnOn : styles.toggleBtnOff),
                  }}
                  onClick={() => toggleConfidential(activeConv)}
                  title={activeConv.confidential_mode ? "Disable confidential mode" : "Enable confidential mode (NDA)"}
                >
                  {activeConv.confidential_mode ? "ON" : "OFF"}
                </button>
              </div>
            </div>

            {/* NDA notice banner */}
            {activeConv.confidential_mode && (
              <div style={styles.ndaBanner}>
                🔒 <strong>Confidential Mode Active</strong> — This conversation is protected
                under an International NDA. All messages are legally confidential.
                {activeConv.confidential_activated_at && (
                  <span style={{ marginLeft: 8, opacity: 0.8, fontSize: 12 }}>
                    Since {new Date(activeConv.confidential_activated_at).toLocaleString()}
                  </span>
                )}
              </div>
            )}

            {/* Messages */}
            <div style={styles.messageList}>
              {messages.length === 0 && (
                <p style={styles.noMessages}>No messages yet. Say hello!</p>
              )}
              {messages.map((msg) => {
                const isMe = msg.sender_email === myEmail;
                return (
                  <div
                    key={msg.id}
                    style={{
                      ...styles.msgRow,
                      justifyContent: isMe ? "flex-end" : "flex-start",
                    }}
                  >
                    <div
                      style={{
                        ...styles.msgBubble,
                        ...(isMe ? styles.msgBubbleMe : styles.msgBubbleThem),
                        ...(msg.is_encrypted ? styles.msgBubbleEncrypted : {}),
                      }}
                    >
                      {msg.is_encrypted && <span style={styles.encryptedIcon}>🔒 </span>}
                      <span style={styles.msgBody}>{msg.body}</span>
                      <span style={styles.msgTime}>
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={sendMessage} style={styles.inputRow}>
              <input
                style={styles.msgInput}
                type="text"
                placeholder={
                  activeConv.confidential_mode
                    ? "🔒 Confidential message…"
                    : "Type a message…"
                }
                value={msgInput}
                onChange={(e) => setMsgInput(e.target.value)}
                autoFocus
              />
              <button
                style={{
                  ...styles.sendBtn,
                  ...(activeConv.confidential_mode ? styles.sendBtnConfidential : {}),
                }}
                type="submit"
                disabled={!msgInput.trim()}
              >
                Send
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  centered: {
    display: "flex", alignItems: "center", justifyContent: "center",
    height: "100vh", background: "#0f1117",
  },
  spinner: {
    width: 40, height: 40, border: "4px solid #333",
    borderTop: "4px solid #6c63ff", borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  authWrap: {
    display: "flex", alignItems: "center", justifyContent: "center",
    minHeight: "100vh", background: "#0f1117",
  },
  authCard: {
    background: "#1a1d27", borderRadius: 16, padding: "40px 36px",
    width: "100%", maxWidth: 400, boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
  },
  logoRow: {
    display: "flex", alignItems: "center", gap: 10, marginBottom: 4,
  },
  logoIcon: { fontSize: 32 },
  logoText: {
    fontSize: 26, fontWeight: 700, color: "#fff",
    letterSpacing: "-0.5px",
  },
  authSub: { color: "#888", fontSize: 14, marginBottom: 24, marginTop: 2 },
  tabRow: { display: "flex", marginBottom: 20, borderRadius: 8, overflow: "hidden", border: "1px solid #2e3147" },
  tab: {
    flex: 1, padding: "10px 0", background: "transparent",
    border: "none", color: "#888", cursor: "pointer", fontSize: 15,
  },
  tabActive: {
    flex: 1, padding: "10px 0", background: "#6c63ff",
    border: "none", color: "#fff", cursor: "pointer", fontSize: 15, fontWeight: 600,
  },
  form: { display: "flex", flexDirection: "column", gap: 12 },
  input: {
    padding: "12px 14px", borderRadius: 8, border: "1px solid #2e3147",
    background: "#12151e", color: "#fff", fontSize: 15, outline: "none",
    width: "100%", boxSizing: "border-box",
  },
  errorText: { color: "#ff6b6b", fontSize: 13, margin: 0 },
  btnPrimary: {
    padding: "12px 20px", background: "#6c63ff", color: "#fff",
    border: "none", borderRadius: 8, fontSize: 15, fontWeight: 600,
    cursor: "pointer", transition: "background 0.2s",
  },
  btnSecondary: {
    padding: "12px 20px", background: "#2e3147", color: "#ccc",
    border: "none", borderRadius: 8, fontSize: 15, cursor: "pointer",
  },
  btnConfidential: {
    padding: "12px 20px", background: "#e63946", color: "#fff",
    border: "none", borderRadius: 8, fontSize: 15, fontWeight: 600,
    cursor: "pointer",
  },
  appWrap: {
    display: "flex", height: "100vh", background: "#0f1117", overflow: "hidden",
  },
  sidebar: {
    width: 320, minWidth: 260, background: "#1a1d27",
    display: "flex", flexDirection: "column", borderRight: "1px solid #2e3147",
  },
  sidebarHeader: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "18px 16px 12px", borderBottom: "1px solid #2e3147",
  },
  sidebarTitle: { flex: 1, fontSize: 20, fontWeight: 700, color: "#fff" },
  newChatBtn: {
    background: "none", border: "none", fontSize: 22,
    cursor: "pointer", color: "#6c63ff", padding: "4px 8px", borderRadius: 8,
  },
  meRow: {
    display: "flex", alignItems: "center", padding: "8px 16px 10px",
    borderBottom: "1px solid #2e3147", gap: 8,
  },
  meEmail: { flex: 1, fontSize: 12, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  logoutBtn: {
    background: "#2e3147", border: "none", color: "#aaa",
    padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer",
  },
  convList: { flex: 1, overflowY: "auto" },
  emptyList: { color: "#555", fontSize: 14, textAlign: "center", padding: "40px 16px", lineHeight: 1.7 },
  convItem: {
    display: "flex", alignItems: "center", gap: 12,
    padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid #1e2130",
    transition: "background 0.15s",
  },
  convItemActive: { background: "#22263a" },
  convAvatar: {
    width: 44, height: 44, borderRadius: "50%", background: "#6c63ff",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 18, fontWeight: 700, color: "#fff", flexShrink: 0,
  },
  convInfo: { flex: 1, minWidth: 0 },
  convTopRow: { display: "flex", alignItems: "center", gap: 6, marginBottom: 2 },
  convEmail: { fontSize: 14, fontWeight: 600, color: "#e0e0e0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  confiBadge: {
    fontSize: 10, background: "#3d1a1a", color: "#ff6b6b",
    padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap",
  },
  convSnippet: {
    fontSize: 12, color: "#666", overflow: "hidden",
    textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block",
  },
  unreadBadge: {
    background: "#6c63ff", color: "#fff", fontSize: 11,
    fontWeight: 700, padding: "2px 8px", borderRadius: 12, minWidth: 20, textAlign: "center",
  },
  main: {
    flex: 1, display: "flex", flexDirection: "column", overflow: "hidden",
  },
  emptyMain: {
    flex: 1, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: 16, color: "#555",
  },
  emptyMainTitle: { color: "#aaa", fontSize: 24, margin: 0 },
  emptyMainSub: { color: "#555", fontSize: 15, margin: 0 },
  newConvWrap: {
    flex: 1, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: 16, padding: 32,
  },
  newConvTitle: { color: "#fff", fontSize: 22, margin: 0 },
  newConvSub: { color: "#888", fontSize: 14, margin: 0 },
  newConvForm: { display: "flex", flexDirection: "column", gap: 12, width: "100%", maxWidth: 400 },
  chatWrap: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  chatHeader: {
    display: "flex", alignItems: "center", gap: 12,
    padding: "14px 20px", borderBottom: "1px solid #2e3147",
    background: "#1a1d27",
  },
  backBtn: {
    background: "none", border: "none", color: "#6c63ff",
    fontSize: 22, cursor: "pointer", padding: "0 4px",
  },
  chatAvatar: {
    width: 40, height: 40, borderRadius: "50%", background: "#6c63ff",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 16, fontWeight: 700, color: "#fff", flexShrink: 0,
  },
  chatHeaderInfo: { flex: 1, display: "flex", flexDirection: "column" },
  chatHeaderEmail: { color: "#fff", fontSize: 15, fontWeight: 600 },
  confiBadgeSmall: { fontSize: 11, color: "#ff6b6b", marginTop: 2 },
  confidentialToggle: {
    display: "flex", alignItems: "center", gap: 8,
  },
  toggleLabel: { color: "#888", fontSize: 13 },
  toggleBtn: {
    padding: "6px 14px", borderRadius: 20, border: "none",
    fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "background 0.2s",
  },
  toggleBtnOn: { background: "#e63946", color: "#fff" },
  toggleBtnOff: { background: "#2e3147", color: "#888" },
  ndaBanner: {
    background: "#2d1515", color: "#ff9999", padding: "10px 20px",
    fontSize: 13, borderBottom: "1px solid #4d2020",
  },
  messageList: {
    flex: 1, overflowY: "auto", padding: "20px 16px",
    display: "flex", flexDirection: "column", gap: 8,
  },
  noMessages: { textAlign: "center", color: "#555", fontSize: 14, margin: "auto" },
  msgRow: { display: "flex" },
  msgBubble: {
    maxWidth: "70%", padding: "10px 14px", borderRadius: 16,
    display: "flex", flexDirection: "column", gap: 4,
  },
  msgBubbleMe: { background: "#6c63ff", color: "#fff", borderBottomRightRadius: 4 },
  msgBubbleThem: { background: "#1e2130", color: "#e0e0e0", borderBottomLeftRadius: 4 },
  msgBubbleEncrypted: { borderLeft: "3px solid #e63946" },
  encryptedIcon: { fontSize: 11, opacity: 0.8 },
  msgBody: { fontSize: 15, lineHeight: 1.5, wordBreak: "break-word" },
  msgTime: { fontSize: 10, opacity: 0.6, alignSelf: "flex-end" },
  inputRow: {
    display: "flex", gap: 10, padding: "14px 16px",
    borderTop: "1px solid #2e3147", background: "#1a1d27",
  },
  msgInput: {
    flex: 1, padding: "12px 16px", borderRadius: 24,
    border: "1px solid #2e3147", background: "#12151e",
    color: "#fff", fontSize: 15, outline: "none",
  },
  sendBtn: {
    padding: "12px 22px", background: "#6c63ff", color: "#fff",
    border: "none", borderRadius: 24, fontSize: 15, fontWeight: 600,
    cursor: "pointer",
  },
  sendBtnConfidential: { background: "#e63946" },
  modalOverlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1000, padding: 16,
  },
  modalBox: {
    background: "#1a1d27", borderRadius: 16, padding: "32px 28px",
    width: "100%", maxWidth: 560, boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
    display: "flex", flexDirection: "column", gap: 16,
  },
  modalTitle: { color: "#fff", fontSize: 22, margin: 0 },
  modalBody: { color: "#bbb", fontSize: 14, margin: 0, lineHeight: 1.6 },
  ndaScroll: {
    background: "#12151e", borderRadius: 8, padding: "16px 20px",
    maxHeight: 280, overflowY: "auto", color: "#aaa", fontSize: 13, lineHeight: 1.7,
  },
  modalActions: { display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 },
};