import { v4 as uuidv4 } from "uuid";
import type {
  CapabilityArtifact,
  DiscoveryTranscript,
  Locator,
  LocatorStrategy,
  Role,
  StepAction,
  OutcomeRule,
} from "../types.js";
import { SCHEMA_VERSION } from "../types.js";
import { classifyRiskAtRecordTime, isIrreversibleName } from "../safety/riskClassifier.js";

const ROLE_SET = new Set<string>([
  "textbox",
  "button",
  "link",
  "heading",
  "cell",
  "combobox",
  "checkbox",
  "generic",
  "row",
  "table",
  "option",
]);

function asRole(role: string): Role {
  return (ROLE_SET.has(role) ? role : "generic") as Role;
}

function locatorFromElement(el: {
  role: string;
  name: string;
  frame?: string[];
  cssPath?: string;
}): Locator {
  const primary: LocatorStrategy = {
    strategy: "role",
    role: asRole(el.role),
    name: el.name || undefined,
    frame: el.frame,
    confidence: el.name ? "high" : "medium",
    rationale: el.name
      ? "Role + accessible name is most stable on legacy markup without test IDs"
      : "Unlabeled control — role-only with medium confidence; text/css fallbacks follow",
  };
  const fallbacks: LocatorStrategy[] = [];
  if (el.name) {
    fallbacks.push({
      strategy: "text",
      text: el.name,
      frame: el.frame,
      confidence: "medium",
      rationale: "Visible text proximity fallback when role name drifts",
    });
  }
  if (el.cssPath) {
    fallbacks.push({
      strategy: "css",
      css: el.cssPath,
      frame: el.frame,
      confidence: "low",
      rationale: "CSS path last resort — fragile on hostile/auto-generated ids",
    });
  }
  return { primary, fallbacks };
}

function bindValue(
  typed: string | undefined,
  inputs: Record<string, unknown>
): string {
  if (!typed) return "";
  for (const [key, val] of Object.entries(inputs)) {
    if (String(val) === typed) {
      return `inputs.${key}`;
    }
  }
  // Reject storing raw secrets-looking values unbound
  return typed;
}

export function buildArtifactFromTranscript(args: {
  transcript: DiscoveryTranscript;
  outputs: Record<string, unknown>;
  baseUrl: string;
  irreversibleSeen: boolean;
}): CapabilityArtifact {
  const { transcript, baseUrl, irreversibleSeen } = args;
  const outputs: Record<string, unknown> = { ...args.outputs };
  const steps: StepAction[] = [
    {
      kind: "navigate",
      path: "/login",
      risk_class: "read",
    },
  ];

  for (const raw of transcript.steps) {
    if (raw.result !== "ok") continue;
    const d = raw.decision;
    if (d.kind === "done") {
      const outName = d.outputName ?? Object.keys(outputs)[0] ?? "savingsBalance";
      const text =
        (d.outputs && String(d.outputs[outName] ?? "")) ||
        d.value ||
        String(outputs[outName] ?? "");
      if (text) {
        steps.push({
          kind: "extract",
          locator: {
            primary: {
              strategy: "text",
              text: text.includes("$") ? text : `$${text}`,
              confidence: "high",
              rationale: "Value observed at discovery done()",
            },
            fallbacks: [
              {
                strategy: "css",
                css: 'table.grid tr:has(td:text-is("Current")) > td:nth-child(2)',
                confidence: "medium",
                rationale: "Current balance cell",
              },
            ],
          },
          outputName: outName,
          transform: "parseCurrency",
          risk_class: "read",
        });
        if (outputs[outName] === undefined) outputs[outName] = text;
      }
      continue;
    }

    if (d.kind === "navigate") {
      let path = d.path ?? d.value ?? "/login";
      // Parameterize fixture member account ids
      for (const [k, v] of Object.entries(transcript.inputs)) {
        if (v != null && path.includes(String(v))) {
          path = path.split(String(v)).join(`inputs.${k}`);
        }
      }
      path = path.replace(/inputs\.memberId-S01/, "inputs.memberId-S01");
      // Fix acct=12345-S01 style when memberId was 12345
      if (transcript.inputs.memberId) {
        const mid = String(transcript.inputs.memberId);
        path = path.replace(
          new RegExp(`acct=${mid}-S01`),
          "acct=inputs.memberId-S01"
        );
      }
      steps.push({
        kind: "navigate",
        path,
        risk_class: "read",
      });
      continue;
    }

    // Bootstrap steps without AX element — recover locators from valueFrom hints
    if (!raw.element && d.kind === "type" && d.value?.startsWith("inputs.")) {
      const key = d.value.slice("inputs.".length);
      const css =
        key === "username"
          ? 'input[name="username"]'
          : key === "password"
            ? 'input[name="password"]'
            : key === "memberId"
              ? 'input[name="memberNo"]'
              : null;
      if (css) {
        steps.push({
          kind: "type",
          locator: {
            primary: {
              strategy: "css",
              css,
              confidence: "medium",
              rationale: "Bootstrap name= locator from discovery auth",
            },
            fallbacks: [],
          },
          valueFrom: d.value,
          risk_class:
            key === "password" ? "reversible_write" : "reversible_write",
        });
      }
      continue;
    }
    if (!raw.element && d.kind === "click") {
      if (/terms/i.test(d.reasoning ?? "")) {
        steps.push({
          kind: "click",
          locator: {
            primary: {
              strategy: "css",
              css: 'input[name="terms"]',
              confidence: "medium",
              rationale: "Bootstrap terms checkbox",
            },
            fallbacks: [],
          },
          risk_class: "reversible_write",
        });
      } else if (/Login submit|force concurrent/i.test(d.reasoning ?? "")) {
        steps.push({
          kind: "click",
          locator: {
            primary: {
              strategy: "css",
              css: 'input[type="submit"]',
              confidence: "medium",
              rationale: "Bootstrap login submit",
            },
            fallbacks: [],
          },
          risk_class: "reversible_write",
        });
      } else if (/Continue|maintenance/i.test(d.reasoning ?? "")) {
        steps.push({
          kind: "click",
          locator: {
            primary: {
              strategy: "css",
              css: 'input[type="submit"][value="Continue"]',
              confidence: "high",
              rationale: "Bootstrap maintenance Continue",
            },
            fallbacks: [],
          },
          optional: true,
          risk_class: "read",
        });
      }
      continue;
    }

    if (!raw.element) continue;
    const locator = locatorFromElement(raw.element);

    if (d.kind === "type") {
      steps.push({
        kind: "type",
        locator,
        valueFrom: bindValue(d.value, transcript.inputs),
        risk_class: "reversible_write",
      });
    } else if (d.kind === "select") {
      steps.push({
        kind: "select",
        locator,
        valueFrom: bindValue(d.value, transcript.inputs),
        risk_class: "reversible_write",
      });
    } else if (d.kind === "click") {
      const risk = classifyRiskAtRecordTime({
        kind: "click",
        elementName: raw.element?.name,
        pageText: raw.element?.name,
      });
      const irreversible =
        risk === "irreversible" || isIrreversibleName(raw.element?.name ?? "");
      steps.push({
        kind: "click",
        locator,
        irreversible,
        risk_class: irreversible ? "irreversible" : risk,
      });
    } else if (d.kind === "waitFor") {
      steps.push({
        kind: "waitFor",
        locator,
        timeoutMs: 10000,
        risk_class: "read",
      });
    } else if (d.kind === "extract") {
      steps.push({
        kind: "extract",
        locator,
        outputName: d.outputName ?? Object.keys(outputs)[0] ?? "value",
        transform: "parseCurrency",
        risk_class: "read",
      });
    }
  }

  const memberNotFound: OutcomeRule = {
    match: {
      strategy: "text",
      text: "No records found",
      confidence: "high",
      rationale: "CoreServ empty-result banner",
    },
    classification: "business_outcome",
    code: "MEMBER_NOT_FOUND",
    message: "No records found",
  };
  const accessDenied: OutcomeRule = {
    match: {
      strategy: "text",
      text: "Access Denied",
      confidence: "high",
    },
    classification: "business_outcome",
    code: "PERMISSION_DENIED",
    message: "Access Denied",
  };
  const sessionExpired: OutcomeRule = {
    match: {
      strategy: "text",
      text: "Session expired",
      confidence: "high",
    },
    classification: "recoverable",
    code: "SESSION_EXPIRED",
    message: "Session expired",
    recoveryAction: "reauthenticate",
  };

  const searchClickIdx = steps.findIndex(
    (s) => s.kind === "click" && s.locator.primary.name === "Search"
  );
  if (searchClickIdx >= 0) {
    steps.splice(searchClickIdx + 1, 0, {
      kind: "assertOutcome",
      outcomes: [memberNotFound, accessDenied, sessionExpired],
      risk_class: "read",
    });
  }

  const requiresApproval =
    irreversibleSeen ||
    steps.some((s) => s.kind === "click" && s.irreversible);

  return {
    schema_version: SCHEMA_VERSION,
    artifactId: uuidv4().slice(0, 8),
    capabilityVersion: 1,
    name: "lookup_member_savings_balance",
    description: transcript.goal,
    targetApp: {
      name: "CoreServ Console",
      baseUrl,
      vendorProduct: "CoreServ Console",
      surfaceType: "web-legacy",
    },
    preconditions: {
      startUrl: "/login",
      authState: "anonymous",
      loginPath: "/login",
    },
    inputs: Object.keys(transcript.inputs).map((name) => ({
      name,
      type: "string" as const,
      required: true,
      description: `Input parameter ${name}`,
      sensitivity:
        /pass|secret|token/i.test(name)
          ? ("secret" as const)
          : /ssn|dob|email|phone/i.test(name)
            ? ("pii" as const)
            : /member|account|amount/i.test(name)
              ? ("financial" as const)
              : ("none" as const),
      example: String(transcript.inputs[name]),
    })),
    outputs: Object.keys(outputs).map((name) => ({
      name,
      type: "string" as const,
      description: `Extracted ${name}`,
      shape: "string",
    })),
    steps,
    checkpoint: {
      match: {
        strategy: "text",
        text: "$",
        confidence: "medium",
        rationale: "Currency present after successful inquiry",
      },
      classification: "continue",
    },
    errorHandling: {
      timeoutMs: 15000,
      retryPolicy: { maxRetries: 2, backoffMs: 1000 },
    },
    safety: {
      allowedActionKinds: [
        "navigate",
        "click",
        "type",
        "select",
        "waitFor",
        "extract",
        "assertOutcome",
      ],
      requiresApprovalToReplayUnattended: requiresApproval,
    },
    reviewStatus: requiresApproval ? "draft" : "approved",
    provenance: {
      discoveryRunId: transcript.runId,
      modelUsed: transcript.modelUsed,
      recordedAt: new Date().toISOString(),
      surfaceType: "web-legacy",
    },
    fingerprint: {
      vendor: "CoreServ Console",
      product: "CoreServ Console",
      version: "v7.2.1",
      // Avoid "Password" — password inputs often omit accessible text in AX
      screenSignature: ["Login", "Username"],
    },
    tenant_overrides: {
      harborview: {
        label: "Harborview FCU",
        startPath: "/login?tenant=harborview",
        labelRewrites: {
          "Member #": "Customer ID",
          "Member Search": "Customer Lookup",
        },
      },
    },
  };
}

/** Hand-authored CoreServ happy-path: login → member search → account inquiry → extract. */
export function buildSeededLookupArtifact(baseUrl: string): CapabilityArtifact {
  const userBox: Locator = {
    primary: {
      strategy: "css",
      css: 'input[name="username"]',
      confidence: "medium",
      rationale: "Login page uses name= attributes (exception to hostile rules)",
    },
    fallbacks: [
      {
        strategy: "role",
        role: "textbox",
        confidence: "low",
        rationale: "First textbox fallback",
      },
    ],
  };
  const passBox: Locator = {
    primary: {
      strategy: "css",
      css: 'input[name="password"]',
      confidence: "medium",
      rationale: "Password field by name",
    },
    fallbacks: [],
  };
  const terms: Locator = {
    primary: {
      strategy: "css",
      css: 'input[name="terms"]',
      confidence: "medium",
      rationale: "Terms checkbox",
    },
    fallbacks: [],
  };
  const loginBtn: Locator = {
    primary: {
      strategy: "css",
      css: 'input[type="submit"]',
      confidence: "medium",
      rationale: "Login submit",
    },
    fallbacks: [
      {
        strategy: "text",
        text: "Login",
        confidence: "medium",
        rationale: "Visible Login label",
      },
    ],
  };
  const memberBox: Locator = {
    primary: {
      strategy: "css",
      css: 'input[name="memberNo"]',
      confidence: "medium",
      rationale: "Member # field on CoreServ search",
    },
    fallbacks: [
      {
        strategy: "role",
        role: "textbox",
        confidence: "low",
        rationale: "Unnamed textbox fallback",
      },
    ],
  };
  const searchBtn: Locator = {
    primary: {
      strategy: "css",
      css: 'input[type="submit"]',
      confidence: "medium",
      rationale: "Search submit on results form",
    },
    fallbacks: [
      {
        strategy: "text",
        text: "Search",
        confidence: "medium",
        rationale: "Visible Search text — may be ambiguous with decoys; css preferred",
      },
    ],
  };
  const balanceCell: Locator = {
    primary: {
      strategy: "css",
      css: 'table.grid tr:has(td:text-is("Current")) > td:nth-child(2)',
      confidence: "high",
      rationale: "Current balance in inquiry grid — scoped to avoid nested pageShell tables",
    },
    fallbacks: [
      {
        strategy: "text",
        text: "$4,321.09",
        confidence: "medium",
        rationale: "Known fixture balance for member 12345 (may repeat across rows)",
      },
    ],
  };

  return {
    schema_version: SCHEMA_VERSION,
    artifactId: "seeded-lookup",
    capabilityVersion: 2,
    name: "lookup_member_savings_balance",
    description:
      "Authenticate to CoreServ, search member by ID, open account inquiry, extract savings/current balance.",
    targetApp: {
      name: "CoreServ Console",
      baseUrl,
      vendorProduct: "CoreServ Console",
      surfaceType: "web-legacy",
    },
    preconditions: {
      startUrl: "/login",
      authState: "anonymous",
      loginPath: "/login",
      requiredRole: "csr",
    },
    inputs: [
      {
        name: "username",
        type: "string",
        required: true,
        description: "CoreServ username",
        example: "csr1",
        sensitivity: "none",
      },
      {
        name: "password",
        type: "string",
        required: true,
        description: "CoreServ password",
        example: "csr-pass",
        sensitivity: "secret",
      },
      {
        name: "memberId",
        type: "string",
        required: true,
        description: "Member ID to look up",
        validation: "^[0-9]{4,6}$",
        example: "12345",
        sensitivity: "financial",
      },
    ],
    outputs: [
      {
        name: "savingsBalance",
        type: "string",
        description: "Savings / current balance string",
        shape: "currency_string",
        extractionLocator: balanceCell,
      },
    ],
    steps: [
      { kind: "navigate", path: "/login", risk_class: "read" },
      {
        kind: "type",
        locator: userBox,
        valueFrom: "inputs.username",
        risk_class: "reversible_write",
      },
      {
        kind: "type",
        locator: passBox,
        valueFrom: "inputs.password",
        risk_class: "reversible_write",
      },
      { kind: "click", locator: terms, risk_class: "reversible_write" },
      {
        kind: "click",
        locator: loginBtn,
        risk_class: "reversible_write",
      },
      {
        kind: "click",
        locator: loginBtn,
        optional: true,
        risk_class: "reversible_write",
      },
      {
        kind: "click",
        locator: {
          primary: {
            strategy: "css",
            css: 'input[type="submit"][value="Continue"]',
            confidence: "high",
            rationale:
              "Maintenance Continue only — avoid text:Continue matching concurrent-session copy",
          },
          fallbacks: [],
        },
        optional: true,
        risk_class: "read",
      },
      {
        kind: "navigate",
        path: "/app/members/search",
        risk_class: "read",
      },
      {
        kind: "type",
        locator: memberBox,
        valueFrom: "inputs.memberId",
        risk_class: "reversible_write",
      },
      { kind: "click", locator: searchBtn, risk_class: "read" },
      {
        kind: "assertOutcome",
        risk_class: "read",
        outcomes: [
          {
            match: {
              strategy: "text",
              text: "No records found",
              confidence: "high",
            },
            classification: "business_outcome",
            code: "MEMBER_NOT_FOUND",
            message: "No records found",
          },
          {
            match: {
              strategy: "text",
              text: "Access Denied",
              confidence: "high",
            },
            classification: "business_outcome",
            code: "PERMISSION_DENIED",
            message: "Access Denied",
          },
          {
            match: {
              strategy: "text",
              text: "Session expired",
              confidence: "high",
            },
            classification: "recoverable",
            code: "SESSION_EXPIRED",
            message: "Session expired",
            recoveryAction: "reauthenticate",
          },
        ],
      },
      {
        kind: "navigate",
        path: "/app/accounts/inquiry?acct=inputs.memberId-S01",
        risk_class: "read",
        known_interstitials: [],
      },
      {
        kind: "extract",
        locator: balanceCell,
        outputName: "savingsBalance",
        transform: "parseCurrency",
        risk_class: "read",
      },
    ],
    checkpoint: {
      match: {
        strategy: "text",
        text: "Account Inquiry",
        confidence: "high",
        rationale: "Inquiry heading proves success surface",
      },
      classification: "continue",
    },
    errorHandling: {
      timeoutMs: 15000,
      retryPolicy: { maxRetries: 2, backoffMs: 1000 },
    },
    safety: {
      allowedActionKinds: [
        "navigate",
        "click",
        "type",
        "select",
        "waitFor",
        "extract",
        "assertOutcome",
      ],
      requiresApprovalToReplayUnattended: false,
    },
    reviewStatus: "approved",
    provenance: {
      discoveryRunId: "seeded",
      modelUsed: "none (hand-authored)",
      recordedAt: new Date().toISOString(),
      surfaceType: "web-legacy",
    },
    fingerprint: {
      vendor: "CoreServ Console",
      product: "CoreServ Console",
      version: "v7.2.1",
      screenSignature: ["Login", "Username"],
    },
    tenant_overrides: {
      harborview: {
        label: "Harborview FCU",
        startPath: "/login?tenant=harborview",
        labelRewrites: {
          "Member #": "Customer ID",
          "Member Search": "Customer Lookup",
        },
      },
    },
  };
}

/**
 * Hand-authored WRITE capability fixture for draft→approve gating.
 * Unattended replay blocked until `npm run approve`.
 */
export function buildSeededOpenAccountDraftArtifact(
  baseUrl: string
): CapabilityArtifact {
  const userBox: Locator = {
    primary: {
      strategy: "css",
      css: 'input[name="username"]',
      confidence: "medium",
      rationale: "Login username field",
    },
    fallbacks: [],
  };
  const passBox: Locator = {
    primary: {
      strategy: "css",
      css: 'input[name="password"]',
      confidence: "medium",
      rationale: "Login password field",
    },
    fallbacks: [],
  };
  const terms: Locator = {
    primary: {
      strategy: "css",
      css: 'input[name="terms"]',
      confidence: "medium",
      rationale: "Terms checkbox",
    },
    fallbacks: [],
  };
  const loginBtn: Locator = {
    primary: {
      strategy: "css",
      css: 'input[type="submit"]',
      confidence: "medium",
      rationale: "Login submit",
    },
    fallbacks: [],
  };
  const confirmBtn: Locator = {
    primary: {
      strategy: "text",
      text: "Confirm",
      confidence: "high",
      rationale:
        "Confirm on account review — irreversible (record-time context: open/confirm)",
    },
    fallbacks: [],
  };

  return {
    schema_version: SCHEMA_VERSION,
    artifactId: "seeded-open-account-draft",
    capabilityVersion: 1,
    name: "open_share_certificate_to_confirm",
    description:
      "Authenticate, open New Account (certificate), reach Review, click Confirm (irreversible). Seeded WRITE fixture for draft→approve gating.",
    targetApp: {
      name: "CoreServ Console",
      baseUrl,
      vendorProduct: "CoreServ Console",
      surfaceType: "web-legacy",
    },
    preconditions: {
      startUrl: "/login",
      authState: "anonymous",
      loginPath: "/login",
      requiredRole: "csr",
    },
    inputs: [
      {
        name: "username",
        type: "string",
        required: true,
        example: "csr1",
        sensitivity: "none",
        description: "CoreServ username",
      },
      {
        name: "password",
        type: "string",
        required: true,
        example: "csr-pass",
        sensitivity: "secret",
        description: "CoreServ password",
      },
      {
        name: "memberId",
        type: "string",
        required: true,
        validation: "^[0-9]{4,6}$",
        example: "12345",
        sensitivity: "financial",
        description: "Member to open account for",
      },
      {
        name: "deposit",
        type: "string",
        required: true,
        example: "500",
        sensitivity: "financial",
        description: "Initial deposit",
      },
    ],
    outputs: [
      {
        name: "reachedConfirm",
        type: "string",
        description: "Whether confirm screen was reached",
        shape: "boolean_string",
      },
    ],
    steps: [
      { kind: "navigate", path: "/login", risk_class: "read" },
      {
        kind: "type",
        locator: userBox,
        valueFrom: "inputs.username",
        risk_class: "reversible_write",
      },
      {
        kind: "type",
        locator: passBox,
        valueFrom: "inputs.password",
        risk_class: "reversible_write",
      },
      { kind: "click", locator: terms, risk_class: "reversible_write" },
      { kind: "click", locator: loginBtn, risk_class: "reversible_write" },
      {
        kind: "click",
        locator: loginBtn,
        optional: true,
        risk_class: "reversible_write",
      },
      {
        kind: "click",
        locator: {
          primary: {
            strategy: "css",
            css: 'input[type="submit"][value="Continue"]',
            confidence: "high",
            rationale: "Maintenance Continue",
          },
          fallbacks: [],
        },
        optional: true,
        risk_class: "read",
      },
      {
        kind: "navigate",
        path: "/app/accounts/open?memberId=inputs.memberId&product=C01",
        risk_class: "read",
      },
      {
        kind: "click",
        locator: confirmBtn,
        irreversible: true,
        risk_class: "irreversible",
      },
    ],
    checkpoint: {
      match: {
        strategy: "text",
        text: "Open",
        confidence: "medium",
        rationale: "Open-account surface",
      },
      classification: "continue",
    },
    errorHandling: {
      timeoutMs: 15000,
      retryPolicy: { maxRetries: 1, backoffMs: 500 },
    },
    safety: {
      allowedActionKinds: [
        "navigate",
        "click",
        "type",
        "select",
        "waitFor",
        "extract",
        "assertOutcome",
      ],
      requiresApprovalToReplayUnattended: true,
    },
    reviewStatus: "draft",
    provenance: {
      discoveryRunId: "seeded-write",
      modelUsed: "none (hand-authored write fixture)",
      recordedAt: new Date().toISOString(),
      surfaceType: "web-legacy",
    },
    fingerprint: {
      vendor: "CoreServ Console",
      product: "CoreServ Console",
      version: "v7.2.1",
      screenSignature: ["Login", "Username"],
    },
  };
}
