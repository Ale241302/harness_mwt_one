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

/** One outgoing message the owner asked to send. */
export interface OutgoingMail {
  /** Envelope and `From` sender; defaults to the connection's username. */
  readonly from?: string
  /** Recipients, at least one. */
  readonly to: readonly string[]
  /** `Subject` header; UTF-8 is encoded per RFC 2047. */
  readonly subject: string
  /** Plain-text body; sent as base64 so UTF-8 survives any relay. */
  readonly text: string
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
  /** Subject line. */
  readonly subject: string
  /** Plain-text body. */
  readonly text: string
  /** Where the draft is in its lifecycle. */
  readonly status: EmailDraftStatus
  /** `Message-ID` this draft replies to, or null. */
  readonly inReplyTo: string | null
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
  /** Subject line. */
  readonly subject: string
  /** Plain-text body. */
  readonly text: string
  /** `Message-ID` this draft replies to. */
  readonly inReplyTo?: string | null
  /** Space the draft belongs to. */
  readonly spaceId?: string | null
}

/** What a successful send reports. */
export interface SentMail {
  /** `Message-ID` the send generated. */
  readonly messageId: string
  /** Recipients the server accepted. */
  readonly accepted: readonly string[]
  /** Connection label that carried the message. */
  readonly via: string
}
