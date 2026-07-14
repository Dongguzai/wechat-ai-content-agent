import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  TopicEventType,
  TopicPrimaryDomain,
  TopicProfile
} from "../types/topicProfile.js";

export type PolicyScope = "research" | "editorial" | "review";

export interface PolicyMatch {
  primaryDomains?: TopicPrimaryDomain[];
  eventTypes?: TopicEventType[];
  riskDimensions?: string[];
  fallback?: boolean;
}

export interface PolicyDefinition {
  id: string;
  version: string;
  title: string;
  scope: PolicyScope;
  match: PolicyMatch;
  priority: number;
  instructions: string[];
  riskRules: string[];
}

export interface ResolvedPolicy extends PolicyDefinition {
  sourcePath: string;
  matchReasons: string[];
}

export interface PolicyRegistry {
  policies: ResolvedPolicy[];
  loadedAt: string;
  configRoot: string;
}

export interface ResolvePoliciesOptions {
  configRoot?: string;
  scopes?: PolicyScope[];
  now?: Date;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultConfigRoot = join(currentDir, "..", "..", "config");

const policyDirectories: Record<PolicyScope, string> = {
  research: "research-policies",
  editorial: "editorial-patterns",
  review: "review-policies"
};

const policyScopes: PolicyScope[] = ["research", "editorial", "review"];
const allowedPrimaryDomains: TopicPrimaryDomain[] = [
  "model",
  "product",
  "tooling",
  "research",
  "business",
  "policy",
  "application",
  "creator",
  "security",
  "other"
];
const allowedEventTypes: TopicEventType[] = [
  "launch",
  "update",
  "benchmark",
  "pricing",
  "funding",
  "acquisition",
  "regulation",
  "case_study",
  "incident",
  "opinion",
  "tutorial",
  "research_release"
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Policy config invalid: ${label} must be a non-empty string.`);
  }

  return value.trim();
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Policy config invalid: ${label} must be an array.`);
  }

  const result = value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`Policy config invalid: ${label}[${index}] must be a non-empty string.`);
    }

    return item.trim();
  });

  if (result.length === 0) {
    throw new Error(`Policy config invalid: ${label} must not be empty.`);
  }

  return result;
}

function asOptionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return asStringArray(value, label);
}

function asOptionalPrimaryDomains(
  value: unknown,
  label: string
): TopicPrimaryDomain[] | undefined {
  const values = asOptionalStringArray(value, label);
  if (!values) {
    return undefined;
  }

  for (const item of values) {
    if (!allowedPrimaryDomains.includes(item as TopicPrimaryDomain)) {
      throw new Error(`Policy config invalid: ${label} contains unsupported domain "${item}".`);
    }
  }

  return values as TopicPrimaryDomain[];
}

function asOptionalEventTypes(
  value: unknown,
  label: string
): TopicEventType[] | undefined {
  const values = asOptionalStringArray(value, label);
  if (!values) {
    return undefined;
  }

  for (const item of values) {
    if (!allowedEventTypes.includes(item as TopicEventType)) {
      throw new Error(`Policy config invalid: ${label} contains unsupported event type "${item}".`);
    }
  }

  return values as TopicEventType[];
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Policy config invalid: ${label} must be a finite number.`);
  }

  return value;
}

function asScope(value: unknown, label: string): PolicyScope {
  const scope = asNonEmptyString(value, label);
  if (!policyScopes.includes(scope as PolicyScope)) {
    throw new Error(`Policy config invalid: ${label} has unsupported scope "${scope}".`);
  }

  return scope as PolicyScope;
}

function asMatch(value: unknown, label: string): PolicyMatch {
  if (!isRecord(value)) {
    throw new Error(`Policy config invalid: ${label} must be an object.`);
  }

  const match: PolicyMatch = {
    primaryDomains: asOptionalPrimaryDomains(value.primaryDomains, `${label}.primaryDomains`),
    eventTypes: asOptionalEventTypes(value.eventTypes, `${label}.eventTypes`),
    riskDimensions: asOptionalStringArray(value.riskDimensions, `${label}.riskDimensions`),
    fallback: typeof value.fallback === "boolean" ? value.fallback : undefined
  };

  if (
    !match.fallback &&
    !match.primaryDomains?.length &&
    !match.eventTypes?.length &&
    !match.riskDimensions?.length
  ) {
    throw new Error(`Policy config invalid: ${label} must include at least one matcher.`);
  }

  return match;
}

function parsePolicy(value: unknown, sourcePath: string, index: number): ResolvedPolicy {
  if (!isRecord(value)) {
    throw new Error(`Policy config invalid: ${sourcePath}[${index}] must be an object.`);
  }

  const policy: PolicyDefinition = {
    id: asNonEmptyString(value.id, `${sourcePath}[${index}].id`),
    version: asNonEmptyString(value.version, `${sourcePath}[${index}].version`),
    title: asNonEmptyString(value.title, `${sourcePath}[${index}].title`),
    scope: asScope(value.scope, `${sourcePath}[${index}].scope`),
    match: asMatch(value.match, `${sourcePath}[${index}].match`),
    priority: asNumber(value.priority, `${sourcePath}[${index}].priority`),
    instructions: asStringArray(value.instructions, `${sourcePath}[${index}].instructions`),
    riskRules: asStringArray(value.riskRules, `${sourcePath}[${index}].riskRules`)
  };

  return {
    ...policy,
    sourcePath,
    matchReasons: []
  };
}

async function readPolicyFile(path: string, sourcePath: string): Promise<ResolvedPolicy[]> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Policy config parse failed for ${sourcePath}: ${message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Policy config invalid: ${sourcePath} must contain a JSON array.`);
  }

  return parsed.map((item, index) => parsePolicy(item, sourcePath, index));
}

async function loadPoliciesForScope(input: {
  configRoot: string;
  scope: PolicyScope;
}): Promise<ResolvedPolicy[]> {
  const dir = join(input.configRoot, policyDirectories[input.scope]);
  let entries: string[];

  try {
    entries = await readdir(dir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Policy config directory unavailable for ${input.scope}: ${message}`);
  }

  const jsonFiles = entries.filter((entry) => entry.endsWith(".json")).sort();
  if (jsonFiles.length === 0) {
    throw new Error(`Policy config directory has no JSON files for ${input.scope}: ${dir}`);
  }

  const nested = await Promise.all(
    jsonFiles.map((fileName) => {
      const absolutePath = join(dir, fileName);
      const sourcePath = relative(input.configRoot, absolutePath);
      return readPolicyFile(absolutePath, sourcePath);
    })
  );

  return nested.flat().map((policy) => {
    if (policy.scope !== input.scope) {
      throw new Error(
        `Policy config invalid: ${policy.sourcePath} declares scope ${policy.scope}, expected ${input.scope}.`
      );
    }

    return policy;
  });
}

function duplicateKey(policy: ResolvedPolicy): string {
  return `${policy.scope}:${policy.id}:${policy.version}`;
}

function assertNoDuplicatePolicies(policies: ResolvedPolicy[]): void {
  const seen = new Set<string>();
  for (const policy of policies) {
    const key = duplicateKey(policy);
    if (seen.has(key)) {
      throw new Error(`Policy config invalid: duplicate policy ${key}.`);
    }
    seen.add(key);
  }
}

export async function loadPolicyRegistry(
  options: ResolvePoliciesOptions = {}
): Promise<PolicyRegistry> {
  const configRoot = options.configRoot ?? defaultConfigRoot;
  const scopes = options.scopes ?? policyScopes;
  const policies = (
    await Promise.all(scopes.map((scope) => loadPoliciesForScope({ configRoot, scope })))
  ).flat();

  assertNoDuplicatePolicies(policies);

  return {
    policies,
    configRoot,
    loadedAt: (options.now ?? new Date()).toISOString()
  };
}

function overlap<T>(left: T[] | undefined, right: T[]): T[] {
  if (!left?.length) {
    return [];
  }

  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item));
}

function matchPolicy(policy: ResolvedPolicy, profile: TopicProfile): string[] {
  if (policy.match.fallback) {
    return [];
  }

  const primaryDomainMatches = overlap(policy.match.primaryDomains, [profile.primaryDomain]);
  if (policy.match.primaryDomains?.length && primaryDomainMatches.length === 0) {
    return [];
  }

  const eventTypeMatches = overlap(policy.match.eventTypes, profile.eventTypes);
  if (policy.match.eventTypes?.length && eventTypeMatches.length === 0) {
    return [];
  }

  const riskDimensionMatches = overlap(policy.match.riskDimensions, profile.riskDimensions);
  if (policy.match.riskDimensions?.length && riskDimensionMatches.length === 0) {
    return [];
  }

  const reasons = [
    ...primaryDomainMatches.map((domain) => `primaryDomain:${domain}`),
    ...eventTypeMatches.map((eventType) => `eventType:${eventType}`),
    ...riskDimensionMatches.map((risk) => `riskDimension:${risk}`)
  ];

  return reasons;
}

function clonePolicyWithReasons(policy: ResolvedPolicy, matchReasons: string[]): ResolvedPolicy {
  return {
    ...policy,
    matchReasons: [...matchReasons]
  };
}

function sortPolicies(policies: ResolvedPolicy[]): ResolvedPolicy[] {
  return [...policies].sort(
    (left, right) =>
      right.priority - left.priority ||
      left.scope.localeCompare(right.scope) ||
      left.id.localeCompare(right.id)
  );
}

export function selectPoliciesForProfile(input: {
  registry: PolicyRegistry;
  profile: TopicProfile;
  scopes?: PolicyScope[];
}): ResolvedPolicy[] {
  const scopes = input.scopes ?? policyScopes;
  const selected = scopes.flatMap((scope) => {
    const scopedPolicies = input.registry.policies.filter((policy) => policy.scope === scope);
    const matched = scopedPolicies.flatMap((policy) => {
      const reasons = matchPolicy(policy, input.profile);
      return reasons.length > 0 ? [clonePolicyWithReasons(policy, reasons)] : [];
    });

    if (matched.length > 0) {
      return matched;
    }

    const fallback = scopedPolicies.filter((policy) => policy.match.fallback);
    if (fallback.length === 0) {
      throw new Error(`Policy registry has no generic-safe fallback policy for ${scope}.`);
    }

    return fallback.map((policy) =>
      clonePolicyWithReasons(policy, ["fallback:generic-safe"])
    );
  });

  return sortPolicies(selected);
}

export async function resolvePoliciesForProfile(
  profile: TopicProfile,
  options: ResolvePoliciesOptions = {}
): Promise<ResolvedPolicy[]> {
  const registry = await loadPolicyRegistry(options);
  return selectPoliciesForProfile({
    registry,
    profile,
    scopes: options.scopes
  });
}
