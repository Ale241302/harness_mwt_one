/** Consumer-facing types of the product connections service. */

/** Which integration a connection configures. */
export type ConnectionKind = 'imap' | 'backup'

/** One connection as consumers read it; the secret is never returned. */
export interface FaberLoomConnection {
  /** Connection id. */
  readonly id: string
  /** Which integration this row configures. */
  readonly kind: ConnectionKind
  /** Display label. */
  readonly label: string
  /** IMAP host. */
  readonly host: string | null
  /** IMAP port. */
  readonly port: number | null
  /** Whether IMAP uses implicit TLS. */
  readonly secure: boolean | null
  /** IMAP username. */
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
  /** IMAP host. */
  readonly host?: string | null
  /** IMAP port. */
  readonly port?: number | null
  /** Whether IMAP uses implicit TLS. */
  readonly secure?: boolean | null
  /** IMAP username. */
  readonly username?: string | null
  /** IMAP password; omit to keep the stored one. */
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
  /** IMAP host. */
  readonly host: string
  /** IMAP port. */
  readonly port: number
  /** Whether the connection starts TLS immediately. */
  readonly secure: boolean
  /** Account name. */
  readonly username: string
  /** Account password. */
  readonly password: string
}
