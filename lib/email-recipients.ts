/**
 * Transparent job-card email recipient resolution.
 */

/** Mirrors DEFAULT_JOB_CARD_EMAIL_TO in job-card-submission (kept local for server/test imports). */
const DEFAULT_JOB_CARD_EMAIL_TO = "install-submissions@example.com";

export const INTERNAL_ALWAYS_EMAIL = "installs@tkpautomotive.com";
export const INTERNAL_ONLY_EMAIL = "nick@tkptelematics.com";

export type EmailSendMode = "client_and_internal" | "internal_only";

export type RecipientSource =
  | "internal_always"
  | "internal_env"
  | "internal_only_mode"
  | "project_external"
  | "customer_contact";

export type RecipientSourceEntry = {
  source: RecipientSource;
  label: string;
};

export type EmailRecipient = {
  email: string;
  /** Chosen primary source for this unique address. */
  source: RecipientSource;
  label: string;
  /** to | cc | bcc — currently all To; reserved for future */
  route: "to" | "cc" | "bcc";
  /** All contributing sources before dedupe (preserves audit history). */
  sourceHistory: RecipientSourceEntry[];
};

export type ResolvedEmailRecipients = {
  sendMode: EmailSendMode;
  to: EmailRecipient[];
  cc: EmailRecipient[];
  bcc: EmailRecipient[];
  /** Flat deduped lowercase list for Resend — one delivery per address */
  toAddresses: string[];
};

const SOURCE_PRIORITY: Record<RecipientSource, number> = {
  internal_always: 100,
  internal_env: 90,
  internal_only_mode: 80,
  customer_contact: 40,
  project_external: 20,
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function recipientKey(email: string): string {
  return normalizeEmail(email);
}

/**
 * One final recipient per unique email (case-insensitive).
 * Preserves full source history; chooses the highest-priority source as primary.
 */
export function mergeRecipientsByEmail(list: EmailRecipient[]): EmailRecipient[] {
  const byEmail = new Map<string, EmailRecipient>();

  for (const raw of list) {
    const email = recipientKey(raw.email);
    if (!email) continue;

    const incomingHistory = raw.sourceHistory?.length
      ? raw.sourceHistory
      : [{ source: raw.source, label: raw.label }];

    const existing = byEmail.get(email);
    if (!existing) {
      byEmail.set(email, {
        email,
        source: raw.source,
        label: raw.label,
        route: raw.route,
        sourceHistory: [...incomingHistory],
      });
      continue;
    }

    const history = [...existing.sourceHistory];
    for (const entry of incomingHistory) {
      if (!history.some((h) => h.source === entry.source && h.label === entry.label)) {
        history.push(entry);
      }
    }

    const preferIncoming =
      SOURCE_PRIORITY[raw.source] > SOURCE_PRIORITY[existing.source] ||
      (SOURCE_PRIORITY[raw.source] === SOURCE_PRIORITY[existing.source] && existing.source === raw.source);

    const primary = preferIncoming
      ? { source: raw.source, label: raw.label, route: raw.route }
      : { source: existing.source, label: existing.label, route: existing.route };

    byEmail.set(email, {
      email,
      source: primary.source,
      label: primary.label,
      route: primary.route,
      sourceHistory: history,
    });
  }

  return [...byEmail.values()];
}

export function readProjectExternalEmails(payload: {
  projectRecipientEmails?: string[];
  externalRecipientEmails?: string[];
  project?: { externalRecipientEmails?: string[] };
}): string[] {
  const raw: string[] = [];
  if (Array.isArray(payload.projectRecipientEmails)) raw.push(...payload.projectRecipientEmails);
  if (Array.isArray(payload.externalRecipientEmails)) raw.push(...payload.externalRecipientEmails);
  if (Array.isArray(payload.project?.externalRecipientEmails)) {
    raw.push(...payload.project.externalRecipientEmails);
  }
  return [...new Set(raw.map((e) => normalizeEmail(e)).filter(Boolean))];
}

function makeRecipient(
  email: string,
  source: RecipientSource,
  label: string,
  route: "to" | "cc" | "bcc" = "to",
): EmailRecipient {
  return {
    email: normalizeEmail(email),
    source,
    label,
    route,
    sourceHistory: [{ source, label }],
  };
}

export function resolveJobCardEmailRecipients(args: {
  sendMode: EmailSendMode;
  payload: {
    projectRecipientEmails?: string[];
    externalRecipientEmails?: string[];
    project?: { externalRecipientEmails?: string[] };
    coreJobInfo?: { contactEmail?: string; primaryContact?: string };
    linxup?: { contactEmail?: string; primaryContact?: string };
  };
  jobCardEmailToEnv?: string;
}): ResolvedEmailRecipients {
  const envFallback = (args.jobCardEmailToEnv || process.env.JOB_CARD_EMAIL_TO || DEFAULT_JOB_CARD_EMAIL_TO).trim();

  if (args.sendMode === "internal_only") {
    const to = mergeRecipientsByEmail([
      makeRecipient(INTERNAL_ONLY_EMAIL, "internal_only_mode", "Internal only recipient"),
    ]);
    return { sendMode: args.sendMode, to, cc: [], bcc: [], toAddresses: to.map((r) => r.email) };
  }

  const candidates: EmailRecipient[] = [
    makeRecipient(
      INTERNAL_ALWAYS_EMAIL,
      "internal_always",
      "Internal archive recipient (always included)",
    ),
  ];

  if (envFallback && normalizeEmail(envFallback) !== normalizeEmail(INTERNAL_ALWAYS_EMAIL)) {
    candidates.push(
      makeRecipient(envFallback, "internal_env", "Internal default recipient (JOB_CARD_EMAIL_TO)"),
    );
  }

  for (const email of readProjectExternalEmails(args.payload)) {
    candidates.push(
      makeRecipient(
        email,
        "project_external",
        "Project/site external recipient (snapshotted at submit)",
      ),
    );
  }

  const to = mergeRecipientsByEmail(candidates);
  return {
    sendMode: args.sendMode,
    to,
    cc: [],
    bcc: [],
    toAddresses: to.map((r) => r.email),
  };
}

/** Human-readable audit for the five-address example and similar sends. */
export function describeRecipientForAudit(recipient: EmailRecipient): string {
  const history =
    recipient.sourceHistory.length > 1
      ? ` [also: ${recipient.sourceHistory
          .filter((h) => h.source !== recipient.source)
          .map((h) => h.source)
          .join(", ")}]`
      : "";
  switch (recipient.source) {
    case "internal_always":
      return `${recipient.email} — Internal archive (hardcoded ALWAYS_EMAIL_TO)${history}`;
    case "internal_env":
      return `${recipient.email} — Internal default (JOB_CARD_EMAIL_TO environment variable)${history}`;
    case "internal_only_mode":
      return `${recipient.email} — Internal only mode recipient${history}`;
    case "project_external":
      return `${recipient.email} — Project/site external recipient list (projects.external_recipient_emails, snapshotted in submission payload)${history}`;
    case "customer_contact":
      return `${recipient.email} — Customer primary contact (not currently added as recipient unless listed on project)${history}`;
    default:
      return recipient.email;
  }
}
