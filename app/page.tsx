"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";

// Module-level speech recognition instance (any, to avoid TS lib conflicts)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let recognition: any = null;

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

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    setMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return mobile;
}

export default function Home() {
  const isMobile = useIsMobile();
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
  const [notifAsked, setNotifAsked] = useState(false);
  const lastMsgIdRef = useRef<number>(0);
  const [attachmentPreview, setAttachmentPreview] = useState<{ url: string; name: string; mime: string } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [transcript, setTranscript] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speechRecRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      !("SpeechRecognition" in window) &&
      !("webkitSpeechRecognition" in window)
    ) {
      setSupported(false);
    }
  }, []);

  const [ndaModal, setNdaModal] = useState(false);
  const [ndaConvId, setNdaConvId] = useState<number | null>(null);
  const [ndaChecked, setNdaChecked] = useState(false);
  const [ndaSignedName, setNdaSignedName] = useState("");
  const [ndaSubmitting, setNdaSubmitting] = useState(false);
  const [ndaError, setNdaError] = useState("");
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

  const requestNotifPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
    setNotifAsked(true);
  }, []);

  const fetchMessages = useCallback(async (convId: number, currentUserEmail: string) => {
    const res = await fetch(`/api/messages?conversation_id=${convId}`);
    if (res.ok) {
      const data = await res.json();
      const fetched: Message[] = data.messages || [];
      setMessages(fetched);

      // Fire browser notifications for any new incoming messages
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        const prevMax = lastMsgIdRef.current;
        fetched.forEach((msg) => {
          if (msg.id > prevMax && msg.sender_email !== currentUserEmail) {
            const preview = msg.body.length > 80 ? msg.body.slice(0, 77) + "…" : msg.body;
            try {
              new Notification("ConfiMessage — " + msg.sender_email, {
                body: preview,
                icon: "/icon.png",
                tag: "msg-" + msg.id,
              });
            } catch {
              // ignore
            }
          }
        });
      }
      if (fetched.length > 0) {
        const maxId = Math.max(...fetched.map((m) => m.id));
        if (maxId > lastMsgIdRef.current) lastMsgIdRef.current = maxId;
      }
    }
  }, []);

  useEffect(() => {
    if (user) fetchConversations();
  }, [user, fetchConversations]);

  // Ask for notification permission the first time an incoming message is seen
  useEffect(() => {
    if (!notifAsked && user && messages.some((m) => m.sender_email !== user.email)) {
      requestNotifPermission();
    }
  }, [messages, notifAsked, user, requestNotifPermission]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (view === "list" && user) {
      pollRef.current = setInterval(fetchConversations, 5000);
    } else if (view === "chat" && activeConv) {
      const email = user?.email || "";
      pollRef.current = setInterval(() => fetchMessages(activeConv.id, email), 3000);
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
    lastMsgIdRef.current = 0;
    await fetchMessages(conv.id, user?.email || "");
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
      await fetchMessages(activeConv.id, user?.email || "");
      await fetchConversations();
    }
  };

  const sendAttachmentMessage = async (body: string) => {
    if (!activeConv) return;
    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: activeConv.id, body }),
    });
    if (res.ok) {
      await fetchMessages(activeConv.id, user?.email || "");
      await fetchConversations();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeConv) return;
    // Reset input so the same file can be re-selected
    e.target.value = "";
    const fd = new FormData();
    fd.append("file", file);
    const uploadRes = await fetch("/api/upload", { method: "POST", body: fd });
    if (!uploadRes.ok) return;
    const { url } = await uploadRes.json();
    const payload = JSON.stringify({
      __type: "attachment",
      url,
      name: file.name,
      mime: file.type,
    });
    await sendAttachmentMessage(payload);
  };

  const startRecording = async () => {
    if (isRecording) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      alert("Microphone access denied.");
      return;
    }

    audioChunksRef.current = [];
    setTranscript("");
    setRecordingSeconds(0);
    setIsRecording(true);

    // Web Speech API for live transcription
    const SpeechRecognitionImpl =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (SpeechRecognitionImpl) {
      recognition = new SpeechRecognitionImpl();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      let finalText = "";
      recognition.onresult = (ev: any): void => {
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) finalText += r[0].transcript + " ";
          else interim += r[0].transcript;
        }
        setTranscript((finalText + interim).trim());
      };
      recognition.start();
      speechRecRef.current = recognition;
    }

    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
    };
    mediaRecorderRef.current = recorder;
    recorder.start(200);

    recordingTimerRef.current = setInterval(() => {
      setRecordingSeconds((s) => s + 1);
    }, 1000);
  };

  const stopRecording = async () => {
    if (!isRecording || !mediaRecorderRef.current) return;
    setIsRecording(false);
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    speechRecRef.current?.stop();
    speechRecRef.current = null;

    await new Promise<void>((resolve) => {
      const mr = mediaRecorderRef.current!;
      mr.onstop = () => resolve();
      mr.stop();
      mr.stream.getTracks().forEach((t) => t.stop());
    });

    const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
    const fd = new FormData();
    fd.append("file", audioBlob, "voice-" + Date.now() + ".webm");
    const uploadRes = await fetch("/api/upload", { method: "POST", body: fd });
    const finalTranscript = transcript;
    setTranscript("");
    setRecordingSeconds(0);
    if (!uploadRes.ok) return;
    const { url } = await uploadRes.json();
    const payload = JSON.stringify({
      __type: "voice",
      url,
      transcript: finalTranscript,
    });
    await sendAttachmentMessage(payload);
  };

  // Helper: parse special attachment/voice message bodies
  const parseMessageBody = (body: string): { __type?: string; url?: string; name?: string; mime?: string; transcript?: string } | null => {
    if (!body.startsWith("{")) return null;
    try { return JSON.parse(body); } catch { return null; }
  };

  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);

  const startNewConversation = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewEmailError("");
    setInviteLink(null);
    setInviteEmail(null);
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
      // If the user doesn't exist on the platform, show an invite link
      if (res.status === 404 || (d.error && (d.error.toLowerCase().includes("not found") || d.error.toLowerCase().includes("no user")))) {
        const base = typeof window !== "undefined" ? window.location.origin : "";
        const link = base + "/?invite=" + encodeURIComponent(email) + "&from=" + encodeURIComponent(user?.email ?? "");
        setInviteLink(link);
        setInviteEmail(email);
        return;
      }
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
      setNdaChecked(false);
      setNdaSignedName("");
      setNdaError("");
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
    if (!ndaChecked) { setNdaError("You must check the agreement checkbox."); return; }
    if (!ndaSignedName.trim()) { setNdaError("You must type your full name as your signature."); return; }

    setNdaSubmitting(true);
    setNdaError("");

    // Build a plain-text receipt and upload it as a blob
    let receiptUrl: string | null = null;
    try {
      const now = new Date();
      const receiptText = [
        "===========================================",
        "   CONFI MESSAGE — NDA ACCEPTANCE RECEIPT",
        "===========================================",
        "",
        "NDA Version  : 2024-01",
        "Jurisdiction : International",
        "Date/Time    : " + now.toUTCString(),
        "Conversation : #" + ndaConvId,
        "",
        "SIGNATORY",
        "---------",
        "Email        : " + (user?.email ?? ""),
        "Full Name    : " + ndaSignedName.trim(),
        "",
        "TERMS ACCEPTED",
        "--------------",
        "1. Confidential Information — all messages exchanged once Confidential",
        "   Mode is active are legally Confidential Information.",
        "2. Duration — indefinite from date of activation.",
        "3. Governing Law — international treaty obligations, GDPR (EU),",
        "   Defend Trade Secrets Act (USA), and equivalent UN Convention statutes.",
        "4. Remedies — injunctive relief available to the non-breaching party.",
        "5. Entire Agreement — supersedes all prior negotiations on this subject.",
        "",
        "By clicking 'I Accept', the signatory confirmed they read, understood,",
        "and agreed to be bound by the above terms.",
        "",
        "===========================================",
        "This receipt was generated automatically by ConfiMessage.",
        "===========================================",
      ].join("\n");

      const blob = new Blob([receiptText], { type: "text/plain" });
      const fd = new FormData();
      fd.append("file", blob, "nda-receipt-" + ndaConvId + "-" + Date.now() + ".txt");
      const uploadRes = await fetch("/api/upload", { method: "POST", body: fd });
      if (uploadRes.ok) {
        const uploadData = await uploadRes.json();
        receiptUrl = uploadData.url || null;
      }
    } catch {
      // receipt upload failure is non-fatal
    }

    const res = await fetch("/api/conversations/confidential", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: ndaConvId,
        enable: true,
        accept_nda: true,
        signed_name: ndaSignedName.trim(),
        receipt_url: receiptUrl,
      }),
    });

    setNdaSubmitting(false);

    if (res.ok) {
      const d = await res.json();
      setNdaModal(false);
      setNdaConvId(null);
      setNdaChecked(false);
      setNdaSignedName("");
      if (activeConv && activeConv.id === ndaConvId) {
        setActiveConv(d.conversation ?? activeConv);
      }
      await fetchConversations();
    } else {
      const d = await res.json().catch(() => ({}));
      setNdaError(d.error || "Failed to record acceptance. Please try again.");
    }
  };

  const myEmail = user?.email || "";

  // On mobile, derive which panel is visible
  const showSidebar = !isMobile || view === "list" || view === "new";
  const showMain = !isMobile || view === "chat" || view === "new";

  // Responsive style overrides
  const sidebarStyle: React.CSSProperties = useMemo(() => ({
    ...styles.sidebar,
    ...(isMobile ? { width: "100%", minWidth: 0, borderRight: "none", display: showSidebar ? "flex" : "none" } : {}),
  }), [isMobile, showSidebar]);

  const mainStyle: React.CSSProperties = useMemo(() => ({
    ...styles.main,
    ...(isMobile ? { display: showMain && view !== "list" ? "flex" : view === "list" ? "none" : "flex" } : {}),
  }), [isMobile, showMain, view]);

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

  // NDA Modal values (computed for inline rendering)
  const ndaConvForModal = ndaConvId ? conversations.find((c) => c.id === ndaConvId) ?? activeConv : activeConv;
  const otherPartyEmail = ndaConvForModal?.other_email ?? "the other party";
  const todayStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <div style={{ ...styles.appWrap, ...(isMobile ? { flexDirection: "column" } : {}) }}>
      {/* Attachment lightbox */}
      {attachmentPreview && (
        <div style={styles.modalOverlay} onClick={() => setAttachmentPreview(null)}>
          <div style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>
            {attachmentPreview.mime.startsWith("image/") ? (
              <img src={attachmentPreview.url} alt={attachmentPreview.name} style={{ maxWidth: "90vw", maxHeight: "85vh", borderRadius: 12, display: "block" }} />
            ) : (
              <a href={attachmentPreview.url} target="_blank" rel="noreferrer" style={{ color: "#6c63ff", fontSize: 18 }}>
                Open {attachmentPreview.name}
              </a>
            )}
            <button
              onClick={() => setAttachmentPreview(null)}
              style={{ position: "absolute", top: -16, right: -16, background: "#e63946", border: "none", color: "#fff", borderRadius: "50%", width: 32, height: 32, fontSize: 18, cursor: "pointer" }}
            >
              ×
            </button>
          </div>
        </div>
      )}
      {ndaModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalBox}>
            <h2 style={styles.modalTitle}>🔒 International Non-Disclosure Agreement</h2>

            {/* Header meta */}
            <div style={styles.ndaMeta}>
              <div style={styles.ndaMetaRow}>
                <span style={styles.ndaMetaLabel}>NDA Version</span>
                <span style={styles.ndaMetaValue}>2024-01</span>
              </div>
              <div style={styles.ndaMetaRow}>
                <span style={styles.ndaMetaLabel}>Jurisdiction</span>
                <span style={styles.ndaMetaValue}>International (GDPR · DTSA · UN Convention)</span>
              </div>
              <div style={styles.ndaMetaRow}>
                <span style={styles.ndaMetaLabel}>Effective Date</span>
                <span style={styles.ndaMetaValue}>{todayStr}</span>
              </div>
              <div style={styles.ndaMetaRow}>
                <span style={styles.ndaMetaLabel}>Party A</span>
                <span style={styles.ndaMetaValue}>{user?.email}</span>
              </div>
              <div style={styles.ndaMetaRow}>
                <span style={styles.ndaMetaLabel}>Party B</span>
                <span style={styles.ndaMetaValue}>{otherPartyEmail}</span>
              </div>
              <div style={styles.ndaMetaRow}>
                <span style={styles.ndaMetaLabel}>Conversation</span>
                <span style={styles.ndaMetaValue}>#{ndaConvId}</span>
              </div>
            </div>

            {/* Scrollable terms */}
            <div style={styles.ndaScroll}>
              <p style={styles.ndaIntro}>
                This Non-Disclosure Agreement (<strong>&quot;Agreement&quot;</strong>) is entered
                into as of <strong>{todayStr}</strong> between the Parties identified above,
                each a registered user of ConfiMessage, a confidential messaging platform.
              </p>

              <p style={styles.ndaClause}><strong>1. Scope of Confidentiality.</strong>{" "}
                All messages, files, attachments, metadata, and any other information exchanged
                within this conversation (<strong>&quot;Confidential Information&quot;</strong>) once
                Confidential Mode is activated shall be strictly confidential. Neither Party shall
                disclose, reproduce, distribute, publish, or otherwise make available any
                Confidential Information to any third party without the prior written consent
                of the disclosing Party.</p>

              <p style={styles.ndaClause}><strong>2. Permitted Use.</strong>{" "}
                Each Party may use Confidential Information solely for the purpose of
                communicating within this conversation. No licence, express or implied,
                over any intellectual property right is granted by this Agreement.</p>

              <p style={styles.ndaClause}><strong>3. Exclusions.</strong>{" "}
                The obligations in §1 do not apply to information that: (a) is or becomes
                publicly available through no fault of the receiving Party; (b) was rightfully
                known by the receiving Party before disclosure; (c) is independently developed
                without use of Confidential Information; or (d) must be disclosed by law,
                provided the receiving Party gives prompt notice where permitted.</p>

              <p style={styles.ndaClause}><strong>4. Duration.</strong>{" "}
                This Agreement takes effect on the date of the later Party&apos;s acceptance
                and remains in force indefinitely unless terminated by written mutual agreement
                of both Parties.</p>

              <p style={styles.ndaClause}><strong>5. Governing Law &amp; Jurisdiction.</strong>{" "}
                This Agreement is governed by international treaty obligations and, where
                applicable, the laws of the jurisdiction most favourable to enforcing
                confidentiality, including the General Data Protection Regulation (EU) 2016/679,
                the Defend Trade Secrets Act 18 U.S.C. §1836 (USA), the Trade Secrets
                Directive (EU) 2016/943, and equivalent statutes in all signatory nations
                of the UN Convention on Contracts for the International Sale of Goods.
                The Parties submit to the non-exclusive jurisdiction of the courts most
                competent to enforce this Agreement.</p>

              <p style={styles.ndaClause}><strong>6. Remedies.</strong>{" "}
                Both Parties acknowledge that breach may cause irreparable harm for which
                monetary damages are an inadequate remedy. The non-breaching Party is entitled
                to seek injunctive or other equitable relief in any court of competent
                jurisdiction, without the need to post bond, in addition to all other remedies
                at law or in equity.</p>

              <p style={styles.ndaClause}><strong>7. Entire Agreement.</strong>{" "}
                This Agreement constitutes the entire understanding between the Parties with
                respect to confidentiality of the subject conversation and supersedes all prior
                negotiations, representations, warranties, or agreements relating thereto.</p>

              <p style={styles.ndaClause}><strong>8. Electronic Acceptance &amp; Record.</strong>{" "}
                Acceptance by clicking the button below and entering a typed-name signature
                constitutes a legally binding electronic signature under the Electronic
                Signatures in Global and National Commerce Act (E-SIGN, USA), eIDAS
                Regulation (EU) No 910/2014, and equivalent statutes. Your IP address,
                device information, email address, typed name, and timestamp will be recorded
                and a receipt stored as proof of acceptance. Confidential Mode activates
                only after <strong>both Parties</strong> have individually accepted.</p>
            </div>

            {/* Signature block */}
            <div style={styles.signatureBlock}>
              <label style={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={ndaChecked}
                  onChange={(e) => setNdaChecked(e.target.checked)}
                  style={styles.checkbox}
                />
                <span>
                  I have read and fully understand the above Agreement and agree to be
                  bound by its terms on behalf of myself.
                </span>
              </label>
              <div style={styles.signatureRow}>
                <label style={styles.signatureLabel}>
                  Type your full legal name as your electronic signature:
                </label>
                <input
                  style={styles.signatureInput}
                  type="text"
                  placeholder="Full Name"
                  value={ndaSignedName}
                  onChange={(e) => setNdaSignedName(e.target.value)}
                  autoComplete="name"
                />
                {ndaSignedName.trim() && (
                  <div style={styles.signaturePreview}>{ndaSignedName.trim()}</div>
                )}
              </div>
              {ndaError && <p style={styles.ndaErrorText}>{ndaError}</p>}
            </div>

            <div style={styles.modalActions}>
              <button
                style={styles.btnSecondary}
                disabled={ndaSubmitting}
                onClick={() => { setNdaModal(false); setNdaConvId(null); setNdaChecked(false); setNdaSignedName(""); setNdaError(""); }}
              >
                Cancel
              </button>
              <button
                style={{
                  ...styles.btnConfidential,
                  opacity: (!ndaChecked || !ndaSignedName.trim() || ndaSubmitting) ? 0.5 : 1,
                  cursor: (!ndaChecked || !ndaSignedName.trim() || ndaSubmitting) ? "not-allowed" : "pointer",
                }}
                onClick={acceptNda}
                disabled={!ndaChecked || !ndaSignedName.trim() || ndaSubmitting}
              >
                {ndaSubmitting ? "Recording acceptance…" : "I Accept — Sign & Enable Confidential Mode"}
              </button>
            </div>
            <p style={styles.ndaFootnote}>
              A timestamped receipt will be generated and stored as proof of your acceptance.
              Confidential Mode activates once <strong>both parties</strong> have signed.
            </p>
          </div>
        </div>
      )}
      {/* Sidebar */}
      <div style={sidebarStyle}>
        <div style={styles.sidebarHeader}>
          <span style={styles.logoIcon}>🔐</span>
          <span style={styles.sidebarTitle}>ConfiMessage</span>
          <button style={styles.newChatBtn} onClick={() => setView("new")} title="New conversation">
            ✏️
          </button>
        </div>
        <div style={styles.meRow}>
          <span style={styles.meEmail}>{myEmail}</span>
          <button style={styles.logoutBtn} onClick={handleLogout}>Log Out</button>
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
                ...(activeConv?.id === conv.id && !isMobile ? styles.convItemActive : {}),
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
      <div style={mainStyle}>
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
                onChange={(e) => { setNewEmail(e.target.value); setInviteLink(null); setInviteEmail(null); }}
                required
                autoFocus
              />
              {newEmailError && <p style={styles.errorText}>{newEmailError}</p>}
              {inviteLink && inviteEmail && (
                <div style={styles.inviteBox}>
                  <p style={styles.inviteTitle}>📨 {inviteEmail} isn&apos;t on ConfiMessage yet.</p>
                  <p style={styles.inviteSub}>
                    Share this invite link with them so they can sign up and you can start a confidential conversation:
                  </p>
                  <div style={styles.inviteLinkRow}>
                    <span style={styles.inviteLinkText}>{inviteLink}</span>
                    <button
                      type="button"
                      style={styles.btnCopy}
                      onClick={() => { navigator.clipboard.writeText(inviteLink); }}
                    >
                      Copy
                    </button>
                  </div>
                  <p style={styles.inviteNote}>
                    Once they sign up with that email, come back here and start a conversation with them.
                  </p>
                </div>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <button style={styles.btnSecondary} type="button" onClick={() => { setView("list"); setInviteLink(null); setInviteEmail(null); }}>
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
              <button style={styles.backBtn} onClick={() => { setView("list"); setActiveConv(null); setMessages([]); }}>
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
              {(() => {
                const isA = activeConv.participant_a_email === myEmail;
                const iAccepted = isA ? activeConv.confidential_accepted_by_a : activeConv.confidential_accepted_by_b;
                const theyAccepted = isA ? activeConv.confidential_accepted_by_b : activeConv.confidential_accepted_by_a;
                // If they proposed (theyAccepted) and I haven't yet, show Review button instead of toggle
                if (!activeConv.confidential_mode && !iAccepted && theyAccepted) {
                  return (
                    <div style={styles.confidentialToggle}>
                      <span style={styles.toggleLabel}>Confidential</span>
                      <button
                        style={{ ...styles.toggleBtn, ...styles.toggleBtnReview }}
                        onClick={() => {
                          setNdaConvId(activeConv.id);
                          setNdaChecked(false);
                          setNdaSignedName("");
                          setNdaError("");
                          setNdaModal(true);
                        }}
                        title="Review and sign the NDA to enable confidential mode"
                      >
                        Review NDA
                      </button>
                    </div>
                  );
                }
                // If I already accepted but they haven't, show pending state — toggle is locked
                if (!activeConv.confidential_mode && iAccepted && !theyAccepted) {
                  return (
                    <div style={styles.confidentialToggle}>
                      <span style={styles.toggleLabel}>Confidential</span>
                      <button
                        style={{ ...styles.toggleBtn, ...styles.toggleBtnPending }}
                        disabled
                        title="Waiting for the other party to sign the NDA"
                      >
                        Pending…
                      </button>
                    </div>
                  );
                }
                return (
                  <div style={styles.confidentialToggle}>
                    <span style={styles.toggleLabel}>Confidential</span>
                    <button
                      style={{
                        ...styles.toggleBtn,
                        ...(activeConv.confidential_mode ? styles.toggleBtnOn : styles.toggleBtnOff),
                      }}
                      onClick={() => toggleConfidential(activeConv)}
                      title={activeConv.confidential_mode ? "Disable confidential mode" : "Enable confidential mode (NDA requires both parties to sign)"}
                    >
                      {activeConv.confidential_mode ? "ON" : "OFF"}
                    </button>
                  </div>
                );
              })()}
            </div>

            {/* NDA notice banner — active */}
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

            {/* Pending banner — user already accepted but waiting for other party */}
            {!activeConv.confidential_mode && (() => {
              const isA = activeConv.participant_a_email === myEmail;
              const iAccepted = isA ? activeConv.confidential_accepted_by_a : activeConv.confidential_accepted_by_b;
              const theyAccepted = isA ? activeConv.confidential_accepted_by_b : activeConv.confidential_accepted_by_a;
              if (iAccepted && !theyAccepted) {
                return (
                  <div style={styles.ndaPendingBanner}>
                    ⏳ <strong>You have signed the NDA.</strong> Waiting for{" "}
                    <strong>{activeConv.other_email}</strong> to review and countersign.
                    Confidential Mode activates only once <strong>both parties</strong> have accepted.
                  </div>
                );
              }
              if (!iAccepted && theyAccepted) {
                return (
                  <div style={styles.ndaActionBanner}>
                    <span>
                      ✍️ <strong>{activeConv.other_email}</strong> has proposed Confidential Mode
                      and signed the NDA. <strong>Your signature is required</strong> before
                      Confidential Mode activates — both parties must agree.
                    </span>
                    <button
                      style={styles.btnAcceptNda}
                      onClick={() => {
                        setNdaConvId(activeConv.id);
                        setNdaChecked(false);
                        setNdaSignedName("");
                        setNdaError("");
                        setNdaModal(true);
                      }}
                    >
                      Review &amp; Sign NDA
                    </button>
                  </div>
                );
              }
              return null;
            })()}

            {/* Messages */}
            <div style={styles.messageList}>
              {messages.length === 0 && (
                <p style={styles.noMessages}>No messages yet. Say hello!</p>
              )}
              {messages.map((msg) => {
                const isMe = msg.sender_email === myEmail;
                const parsed = parseMessageBody(msg.body);
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
                      {parsed?.__type === "attachment" ? (
                        <div style={styles.attachmentContent}>
                          {parsed.mime?.startsWith("image/") ? (
                            <img
                              src={parsed.url}
                              alt={parsed.name ?? "image"}
                              style={styles.attachmentImage}
                              onClick={() => parsed.url && setAttachmentPreview({ url: parsed.url, name: parsed.name ?? "image", mime: parsed.mime ?? "image/jpeg" })}
                            />
                          ) : (
                            <a href={parsed.url} target="_blank" rel="noreferrer" style={styles.attachmentLink}>
                              📎 {parsed.name ?? "File"}
                            </a>
                          )}
                        </div>
                      ) : parsed?.__type === "voice" ? (
                        <div style={styles.voiceContent}>
                          <span style={styles.voiceIcon}>🎤</span>
                          <audio controls src={parsed.url} style={styles.audioPlayer} />
                          {parsed.transcript && (
                            <p style={styles.transcriptText}>&ldquo;{parsed.transcript}&rdquo;</p>
                          )}
                        </div>
                      ) : (
                        <span style={styles.msgBody}>{msg.body}</span>
                      )}
                      <span style={styles.msgTime}>
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Voice recording transcript preview */}
            {isRecording && (
              <div style={styles.recordingBar}>
                <span style={styles.recordingDot} />
                <span style={styles.recordingTimer}>{Math.floor(recordingSeconds / 60).toString().padStart(2, "0")}:{(recordingSeconds % 60).toString().padStart(2, "0")}</span>
                <span style={styles.recordingTranscript}>{transcript || "Listening…"}</span>
                <button style={styles.stopRecordingBtn} type="button" onClick={stopRecording}>
                  ⏹ Stop &amp; Send
                </button>
              </div>
            )}

            {/* Input */}
            <form onSubmit={sendMessage} style={styles.inputRow}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,application/pdf,.doc,.docx,.txt"
                style={{ display: "none" }}
                onChange={handleFileChange}
              />
              <button
                type="button"
                style={styles.iconBtn}
                onClick={() => fileInputRef.current?.click()}
                title="Attach file or photo"
              >
                📎
              </button>
              <button
                type="button"
                style={{ ...styles.iconBtn, ...(isRecording ? styles.iconBtnRecording : {}) }}
                onClick={isRecording ? stopRecording : startRecording}
                title={isRecording ? "Stop recording" : "Record voice message"}
              >
                🎤
              </button>
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
    height: "100vh", background: "#0f1117", width: "100%",
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
    background: "#1a1d27", borderRadius: 16, padding: "32px 20px",
    width: "100%", maxWidth: 400, boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
    margin: "0 12px",
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
    display: "flex", height: "100vh", width: "100%", background: "#0f1117", overflow: "hidden",
  },
  sidebar: {
    width: 320, minWidth: 260, background: "#1a1d27",
    display: "flex", flexDirection: "column", borderRight: "1px solid #2e3147",
    flexShrink: 0,
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
    display: "flex", alignItems: "center", gap: 8,
    padding: "12px 12px", borderBottom: "1px solid #2e3147",
    background: "#1a1d27", flexWrap: "wrap" as const,
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
  toggleBtnReview: { background: "#6c63ff", color: "#fff", fontSize: 11 },
  toggleBtnPending: { background: "#2a2a1a", color: "#888", fontSize: 11, cursor: "not-allowed" },
  inviteBox: {
    background: "#1a2a1a", border: "1px solid #2a4a2a", borderRadius: 10,
    padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8,
  },
  inviteTitle: { color: "#7ec87e", fontSize: 15, fontWeight: 700, margin: 0 },
  inviteSub: { color: "#aaa", fontSize: 13, margin: 0 },
  inviteLinkRow: {
    display: "flex", alignItems: "center", gap: 8,
    background: "#12151e", borderRadius: 6, padding: "8px 10px",
    border: "1px solid #2e3147",
  },
  inviteLinkText: {
    flex: 1, color: "#6c63ff", fontSize: 12, wordBreak: "break-all",
    fontFamily: "monospace",
  },
  btnCopy: {
    padding: "5px 12px", background: "#6c63ff", color: "#fff",
    border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600,
    cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
  },
  inviteNote: { color: "#666", fontSize: 12, margin: 0 },
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
  iconBtn: {
    background: "none", border: "none", fontSize: 20, cursor: "pointer",
    padding: "0 6px", color: "#888", flexShrink: 0, lineHeight: 1,
  },
  iconBtnRecording: { color: "#e63946" },
  attachmentContent: { display: "flex", flexDirection: "column", gap: 4 },
  attachmentImage: {
    maxWidth: 220, maxHeight: 200, borderRadius: 10, cursor: "pointer",
    objectFit: "cover", display: "block",
  },
  attachmentLink: {
    color: "#a0c4ff", fontSize: 13, textDecoration: "none",
    background: "rgba(0,0,0,0.2)", padding: "6px 10px", borderRadius: 8, display: "inline-block",
  },
  voiceContent: { display: "flex", flexDirection: "column", gap: 6, minWidth: 180 },
  voiceIcon: { fontSize: 16 },
  audioPlayer: { width: "100%", minWidth: 180, maxWidth: 260 },
  transcriptText: {
    margin: 0, fontSize: 12, color: "rgba(255,255,255,0.7)",
    fontStyle: "italic", lineHeight: 1.4,
  },
  recordingBar: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "8px 16px", background: "#2d1515", borderTop: "1px solid #4d2020",
    flexWrap: "wrap",
  },
  recordingDot: {
    width: 10, height: 10, borderRadius: "50%", background: "#e63946",
    flexShrink: 0, animation: "pulse 1s ease-in-out infinite",
  },
  recordingTimer: { color: "#ff9999", fontSize: 13, fontVariantNumeric: "tabular-nums", fontWeight: 600, flexShrink: 0 },
  recordingTranscript: { flex: 1, color: "#ccc", fontSize: 12, fontStyle: "italic", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  stopRecordingBtn: {
    padding: "5px 12px", background: "#e63946", color: "#fff",
    border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600,
    cursor: "pointer", flexShrink: 0,
  },
  ndaPendingBanner: {
    background: "#1a2a1a", color: "#7ec87e", padding: "10px 20px",
    fontSize: 13, borderBottom: "1px solid #2a4a2a",
  },
  ndaActionBanner: {
    background: "#1a1a2e", color: "#99aaff", padding: "10px 20px",
    fontSize: 13, borderBottom: "1px solid #2a2a5a",
    display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
  },
  btnAcceptNda: {
    padding: "7px 16px", background: "#6c63ff", color: "#fff",
    border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600,
    cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
  },
  modalOverlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1000, padding: 16, overflowY: "auto",
  },
  modalBox: {
    background: "#1a1d27", borderRadius: 16, padding: "20px 16px",
    width: "100%", maxWidth: 620, boxShadow: "0 8px 40px rgba(0,0,0,0.7)",
    display: "flex", flexDirection: "column", gap: 14,
    maxHeight: "90vh", overflowY: "auto",
    margin: "auto",
  },
  modalTitle: { color: "#fff", fontSize: 20, margin: 0, fontWeight: 700 },
  modalBody: { color: "#bbb", fontSize: 14, margin: 0, lineHeight: 1.6 },
  ndaMeta: {
    background: "#12151e", borderRadius: 8, padding: "12px 16px",
    display: "flex", flexDirection: "column", gap: 6,
    border: "1px solid #2e3147",
  },
  ndaMetaRow: { display: "flex", gap: 12, alignItems: "baseline" },
  ndaMetaLabel: { color: "#666", fontSize: 11, fontWeight: 600, textTransform: "uppercase", minWidth: 110 },
  ndaMetaValue: { color: "#ccc", fontSize: 13 },
  ndaScroll: {
    background: "#12151e", borderRadius: 8, padding: "14px 18px",
    maxHeight: 240, overflowY: "auto", color: "#aaa", fontSize: 13, lineHeight: 1.8,
    border: "1px solid #2e3147",
  },
  ndaIntro: { color: "#bbb", marginBottom: 10, marginTop: 0 },
  ndaClause: { color: "#aaa", marginBottom: 10, marginTop: 0 },
  signatureBlock: {
    background: "#12151e", borderRadius: 8, padding: "16px 18px",
    display: "flex", flexDirection: "column", gap: 12,
    border: "1px solid #2e3147",
  },
  checkLabel: {
    display: "flex", alignItems: "flex-start", gap: 10,
    color: "#ccc", fontSize: 13, lineHeight: 1.6, cursor: "pointer",
  },
  checkbox: { marginTop: 3, accentColor: "#6c63ff", width: 16, height: 16, flexShrink: 0 },
  signatureRow: { display: "flex", flexDirection: "column", gap: 6 },
  signatureLabel: { color: "#888", fontSize: 12 },
  signatureInput: {
    padding: "10px 14px", borderRadius: 8, border: "1px solid #2e3147",
    background: "#0f1117", color: "#fff", fontSize: 15, outline: "none",
    width: "100%", boxSizing: "border-box",
  },
  signaturePreview: {
    fontFamily: "Georgia, serif", fontSize: 22, color: "#6c63ff",
    padding: "6px 0 2px", borderBottom: "2px solid #6c63ff",
    minHeight: 36, letterSpacing: "0.5px",
  },
  ndaErrorText: { color: "#ff6b6b", fontSize: 13, margin: 0 },
  ndaFootnote: { color: "#555", fontSize: 12, margin: 0, textAlign: "center", lineHeight: 1.5 },
  modalActions: { display: "flex", gap: 12, justifyContent: "flex-end", flexWrap: "wrap" },
};