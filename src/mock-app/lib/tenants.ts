export type Role = "readonly" | "teller" | "csr" | "supervisor" | "admin";

export interface TenantConfig {
  id: string;
  name: string;
  vendorProduct: string;
  vendorVersion: string;
  colors: { top: string; accent: string };
  labels: {
    memberId: string;
    account: string;
    memberSearchTitle: string;
  };
  tellerCashLimit: number;
  products: { code: string; name: string }[];
  menuOrder: string[];
  extraOpenAccountField?: string;
  removeOpenAccountField?: string;
  searchTwoColumn?: boolean;
  frameCount: 2 | 4;
}

export const TENANTS: Record<string, TenantConfig> = {
  meridian: {
    id: "meridian",
    name: "Meridian Credit Union",
    vendorProduct: "CoreServ Console",
    vendorVersion: "v7.2.1",
    colors: { top: "linear-gradient(90deg,#0a246a,#a6caf0)", accent: "#0a246a" },
    labels: {
      memberId: "Member #",
      account: "Acct #",
      memberSearchTitle: "Member Search",
    },
    tellerCashLimit: 2500,
    products: [
      { code: "S01", name: "Share Savings" },
      { code: "D01", name: "Share Draft/Checking" },
      { code: "M01", name: "Money Market" },
      { code: "C01", name: "Certificate" },
      { code: "I01", name: "IRA" },
      { code: "Y01", name: "Youth Savings" },
    ],
    menuOrder: [
      "members",
      "accounts",
      "teller",
      "loans",
      "cards",
      "queues",
      "reports",
      "admin",
    ],
    frameCount: 4,
  },
  harborview: {
    id: "harborview",
    name: "Harborview FCU",
    vendorProduct: "CoreServ Console",
    vendorVersion: "v7.4.0",
    colors: { top: "linear-gradient(90deg,#1a4a3a,#8fcfbb)", accent: "#1a4a3a" },
    labels: {
      memberId: "Customer ID",
      account: "Account",
      memberSearchTitle: "Customer Lookup",
    },
    tellerCashLimit: 1000,
    products: [
      { code: "S01", name: "Regular Share" },
      { code: "D01", name: "Checking" },
      { code: "M01", name: "Money Market Share" },
      { code: "C01", name: "Share Certificate" },
      { code: "I01", name: "IRA Share" },
      { code: "Y01", name: "Youth Share" },
    ],
    menuOrder: [
      "teller",
      "members",
      "accounts",
      "queues",
      "loans",
      "cards",
      "reports",
      "admin",
    ],
    extraOpenAccountField: "Referral Source",
    removeOpenAccountField: "nickname",
    searchTwoColumn: true,
    frameCount: 4,
  },
  tiny_cu: {
    id: "tiny_cu",
    name: "Tiny CU Online",
    vendorProduct: "CoreServ Lite",
    vendorVersion: "v5.0.3",
    colors: { top: "linear-gradient(90deg,#444,#aaa)", accent: "#444" },
    labels: {
      memberId: "Member #",
      account: "Acct #",
      memberSearchTitle: "Find Member",
    },
    tellerCashLimit: 500,
    products: [
      { code: "S01", name: "Savings" },
      { code: "D01", name: "Checking" },
    ],
    menuOrder: ["members", "accounts", "teller"],
    frameCount: 2,
  },
};

export function getTenant(id?: string | null): TenantConfig {
  const key = (id || process.env.TENANT || "meridian").toLowerCase();
  return TENANTS[key] ?? TENANTS.meridian;
}

export const ROLE_PERMS: Record<Role, Set<string>> = {
  readonly: new Set(["member.view", "account.view", "txn.view", "loan.view", "card.view"]),
  teller: new Set([
    "member.view",
    "account.view",
    "txn.view",
    "txn.cash",
    "txn.transfer",
    "drawer",
    "loan.view",
    "card.view",
  ]),
  csr: new Set([
    "member.view",
    "member.edit",
    "member.create",
    "account.view",
    "account.open",
    "account.maintain",
    "hold",
    "stop",
    "txn.view",
    "txn.cash",
    "txn.transfer",
    "drawer",
    "loan.view",
    "card.maintain",
  ]),
  supervisor: new Set([
    "member.view",
    "member.edit",
    "member.create",
    "member.reveal_ssn",
    "member.merge",
    "account.view",
    "account.open",
    "account.maintain",
    "account.close",
    "hold",
    "hold.release_supervisor",
    "stop",
    "txn.view",
    "txn.cash",
    "txn.transfer",
    "txn.wire",
    "txn.reverse",
    "txn.override",
    "drawer",
    "loan.view",
    "loan.pay",
    "card.maintain",
    "queue.approve",
    "reports",
    "audit",
  ]),
  admin: new Set(["*"]),
};

export function can(role: Role, perm: string): boolean {
  const set = ROLE_PERMS[role];
  return set.has("*") || set.has(perm);
}
