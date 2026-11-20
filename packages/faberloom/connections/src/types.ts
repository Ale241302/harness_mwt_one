/** Consumer-facing types of the product connections service. */

/** Which integration a connection configures. */
export type ConnectionKind = 'imap' | 'smtp' | 'backup'

/** One connection as consumers read it; the secret is never returned. */
export interface FaberLoomConnection {
  /** Connection id. */
  readonly id: string
  /** Which integration this row configures. */
  readonly kind: ConnectionKind
  /** Display label. */
  readonly label: string
  /** Server host (IMAP or SMTP). */
  readonly host: string | null
  /** Server port. */
  readonly port: number | null
  /** Whether the connection uses implicit TLS. */
  readonly secure: boolean | null
  /** Whether the connection upgrades a plaintext connection with STARTTLS. */
  readonly starttls: boolean
  /** Whether this is the default row of its kind (the mailbox the inbound receiver reads, or the server outbound mail uses). */
  readonly primary: boolean
  /** Account name. */
  readonly username: string | null
  /** Whether a password is stored for this connection. */
  readonly hasSecret: boolean
  /** Backup destination (host path or rclone remote). */
  readonly destination: string | null
  /** Backup retention in days. */
  readonly retentionDays: number | null
  /** Creation instant, ISO-8601. */
  readonly createdAt: string
  /** Last update instant, ISO-8601. */
  readonly updatedAt: string
}

/** Create or replace input for one connection. */
export interface ConnectionInput {
  /** Connection id, when updating an existing row. */
  readonly id?: string
  /** Which integration this row configures. */
  readonly kind: ConnectionKind
  /** Display label. */
  readonly label: string
  /** Server host (IMAP or SMTP). */
  readonly host?: string | null
  /** Server port. */
  readonly port?: number | null
  /** Whether the connection uses implicit TLS. */
  readonly secure?: boolean | null
  /** Whether the connection upgrades a plaintext connection with STARTTLS. */
  readonly starttls?: boolean | null
  /** Make this the default row of its kind. */
  readonly primary?: boolean
  /** Account name. */
  readonly username?: string | null
  /** Account password; omit to keep the stored one. */
  readonly secret?: string | null
  /** Backup destination. */
  readonly destination?: string | null
  /** Backup retention in days. */
  readonly retentionDays?: number | null
}

/** Result of a connectivity probe. */
export interface ConnectionProbe {
  /** Whether the probe succeeded. */
  readonly ok: boolean
  /** Human-readable outcome. */
  readonly detail: string
}

/** One connection's mailbox credentials, for a host-side consumer that logs in. */
export interface ImapCredentials {
  /** Connection id the credentials belong to. */
  readonly id: string
  /** Display label the owner gave the connection. */
  readonly label: string
  /** Server host (IMAP or SMTP). */
  readonly host: string
  /** Server port. */
  readonly port: number
  /** Whether the connection starts TLS immediately. */
  readonly secure: boolean
  /** Whether the connection upgrades with STARTTLS after the greeting. */
  readonly starttls: boolean
  /** Account name. */
  readonly username: string
  /** Account password. */
  readonly password: string
}

/** One connection's outgoing-server credentials, for a host-side consumer that sends. */
export interface SmtpCredentials {
  /** Connection id the credentials belong to. */
  readonly id: string
  /** Display label the owner gave the connection. */
  readonly label: string
  /** SMTP host. */
  readonly host: string
  /** SMTP port. */
  readonly port: number
  /** Whether the connection starts TLS immediately (465). */
  readonly secure: boolean
  /** Whether the connection upgrades with STARTTLS after the greeting (587). */
  readonly starttls: boolean
  /** Account name; also the default envelope sender. */
  readonly username: string
  /** Account password. */
  readonly password: string
}

/** One file attached to an outgoing message. */
export interface OutgoingAttachment {
  /** File name carried in the `Content-Disposition` parameter. */
  readonly name: string
  /** Media type; `application/octet-stream` when unknown. */
  readonly mediaType: string
  /** File bytes, base64-encoded. */
  readonly contentBase64: string
}

/** One outgoing message the owner asked to send. */
export interface OutgoingMail {
  /** Envelope and `From` sender; defaults to the connection's username. */
  readonly from?: string
  /** Recipients, at least one. */
  readonly to: readonly string[]
  /** Carbon-copy recipients; carried in the `Cc` header and the envelope. */
  readonly cc?: readonly string[]
  /** Blind carbon-copy recipients; carried only in the envelope. */
  readonly bcc?: readonly string[]
  /** `Message-ID` this message answers, written as `In-Reply-To`. */
  readonly inReplyTo?: string | null
  /** `Message-ID` chain for the thread, written as `References`. */
  readonly references?: readonly string[]
  /** `Subject` header; UTF-8 is encoded per RFC 2047. */
  readonly subject: string
  /** Plain-text body; sent as base64 so UTF-8 survives any relay. */
  readonly text: string
  /** Files attached to the message; an omitted or empty list sends text only. */
  readonly attachments?: readonly OutgoingAttachment[]
}

/** One file stored with a draft: its bytes plus the display metadata. */
export interface DraftAttachment {
  /** File name carried in the `Content-Disposition` parameter. */
  readonly name: string
  /** Media type; `application/octet-stream` when unknown. */
  readonly mediaType: string
  /** File bytes, base64-encoded. */
  readonly contentBase64: string
  /** Decoded byte length, for the list. */
  readonly size: number
}

/** One attachment a caller adds to a draft, or keeps from the stored version. */
export interface EmailDraftAttachmentInput {
  /** File name. */
  readonly name: string
  /** Media type; `application/octet-stream` when unknown. */
  readonly mediaType: string
  /** File bytes. Omit to keep the stored attachment with this name. */
  readonly contentBase64?: string
  /** Decoded byte length, when the caller already knows it. */
  readonly size?: number
}

/** Lifecycle of one email draft an agent prepared. */
export type EmailDraftStatus = 'draft' | 'sent' | 'rejected'

/** One email draft awaiting owner approval, as consumers read it. */
export interface FaberLoomEmailDraft {
  /** Draft id. */
  readonly id: string
  /** Recipients. */
  readonly to: readonly string[]
  /** Carbon-copy recipients. */
  readonly cc: readonly string[]
  /** Blind carbon-copy recipients. */
  readonly bcc: readonly string[]
  /** Subject line. */
  readonly subject: string
  /** Plain-text body. */
  readonly text: string
  /** Mailbox the draft is sent from, or null when it resolves to the primary one. */
  readonly account: string | null
  /** Files carried by the draft. */
  readonly attachments: readonly DraftAttachment[]
  /** SHA-256 of the exact message a send approves. */
  readonly revision: string
  /** Where the draft is in its lifecycle. */
  readonly status: EmailDraftStatus
  /** The AI's original text, when the draft was machine-written; otherwise null. */
  readonly aiText: string | null
  /** `Message-ID` this draft replies to, or null. */
  readonly inReplyTo: string | null
  /** `Message-ID` chain the reply belongs to. */
  readonly references: readonly string[]
  /** Space the draft belongs to, or null. */
  readonly spaceId: string | null
  /** Creation instant, ISO-8601. */
  readonly createdAt: string
  /** Last update instant, ISO-8601. */
  readonly updatedAt: string
  /** Send instant, ISO-8601, or null while unsent. */
  readonly sentAt: string | null
}

/** Create or replace input for one email draft. */
export interface EmailDraftInput {
  /** Draft id, when updating an existing draft. */
  readonly id?: string
  /** Recipients. */
  readonly to: readonly string[]
  /** Carbon-copy recipients. */
  readonly cc?: readonly string[]
  /** Blind carbon-copy recipients. */
  readonly bcc?: readonly string[]
  /** Subject line. */
  readonly subject: string
  /** Plain-text body. */
  readonly text: string
  /** Mailbox the draft is sent from, or null when it resolves to the primary one. */
  readonly account?: string | null
  /** Files to add or keep; omitted keeps the stored list unchanged. */
  readonly attachments?: readonly EmailDraftAttachmentInput[]
  /** The AI's original text, when the draft is machine-written. */
  readonly aiText?: string | null
  /** `Message-ID` this draft replies to. */
  readonly inReplyTo?: string | null
  /** `Message-ID` chain the reply belongs to. */
  readonly references?: readonly string[]
  /** Space the draft belongs to. */
  readonly spaceId?: string | null
}

/** Lifecycle of one send attempt. */
export type SendIntentStatus = 'prepared' | 'sending' | 'sent' | 'failed' | 'unknown'

/** One send attempt, as the panel reads it for conciliation. */
export interface FaberLoomSendIntent {
  /** Draft the attempt belongs to. */
  readonly draftId: string
  /** Exact message revision the attempt approved. */
  readonly revision: string
  /** Where the attempt is. */
  readonly status: SendIntentStatus
  /** Envelope recipients, including Bcc. */
  readonly to: readonly string[]
  /** Carbon-copy recipients. */
  readonly cc: readonly string[]
  /** Blind carbon-copy recipients. */
  readonly bcc: readonly string[]
  /** Subject line. */
  readonly subject: string
  /** Transport `Message-ID`, once accepted. */
  readonly messageId: string | null
  /** Failure text, when failed or unknown. */
  readonly error: string | null
  /** Attempt start instant, ISO-8601. */
  readonly createdAt: string
  /** Last state change, ISO-8601. */
  readonly updatedAt: string
}

/** The owner's decision about an attempt whose result the transport lost. */
export type SendResolution = 'sent' | 'failed'

/** Auto-send policy for one owner (and space, when scoped). */
export interface EmailAutoPolicy {
  /** Whether the owner enabled automatic sending. */
  readonly enabled: boolean
  /** Consecutive clean AI sends required before automatic sending. */
  readonly threshold: number
  /** Consecutive AI drafts currently sent without owner edits. */
  readonly cleanSends: number
}

/** One email signature, as the panel reads and writes it. */
export interface FaberLoomEmailSignature {
  /** Outgoing mailbox the signature belongs to; null is the primary account. */
  readonly account: string | null
  /** Plain-text signature body. */
  readonly text: string
  /** Whether a new mail starts with this signature. */
  readonly auto: boolean
  /** Instant of the last change, ISO-8601. */
  readonly updatedAt: string
}

/** Save input for one signature. */
export interface EmailSignatureInput {
  /** Outgoing mailbox; null or absent is the primary account. */
  readonly account?: string | null
  /** Plain-text body. */
  readonly text: string
  /** Whether new mails start with it. */
  readonly auto?: boolean
}

/** Update input for the auto-send policy. */
export interface EmailAutoPolicyInput {
  /** Space the policy applies to; absent is the owner-wide policy. */
  readonly spaceId?: string | null
  /** Whether automatic sending is enabled. */
  readonly enabled: boolean
  /** Consecutive clean sends required. */
  readonly threshold: number
}

/** What a successful send reports. */
export interface SentMail {
  /** `Message-ID` the send generated. */
  readonly messageId: string
  /** Recipients the server accepted. */
  readonly accepted: readonly string[]
  /** Connection label that carried the message. */
  readonly via: string
  /** Exact RFC 5322 message that was transmitted, for the Sent copy. */
  readonly raw?: string
}
