/**
 * Match a service name from health monitoring (Prometheus) to its name in the log store (ELK).
 *
 * Three stages: exact, without the "-service" suffix, then a short list of known aliases for
 * services the two systems name differently. There is deliberately no fuzzy or substring stage:
 * it copied one service's counts onto similarly named ones. A name with no match has no log figures.
 *
 * Each alias below was confirmed on 2026-11-19 by the server the service runs on matching the
 * server its logs come from, except the two "instance 2" entries, which are second instances of
 * a service and share its service-wide figures.
 */
const ALIASES: Record<string, string> = {
  "RW-Amazon-Payments-Service": "rw-amazon-payment-service",
  "RW-Auth-Service": "rw-authorization-service",
  "RW-ES-Service": "rw-elastic-search-service",
  "RW-Jobs-Service": "rw-job-manager-service",
  "RW-Notification-Shared-Service-Spr": "rw-notification-shared-service",
  "RW-order-core-service": "rw-order-management-core-service",
  "RW-Order-Service(Instance 2)": "rw-order-service",
  "RW-QB-Bulk-Service": "rw-quickbooks-bulk-service",
  "RW-Server-Config-Service": "rw-server-configuration-service",
  "RW-SNS-Service": "rw-sns-handler-service",
  "RW-user-service-instance-2": "rw-users-service",
};

const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, "");
const strip = (s: string) => s.replace(/service$/i, "").replace(/svc$/i, "");
const ALIAS_BY_KEY = new Map(Object.entries(ALIASES).map(([from, to]) => [norm(from), norm(to)]));

export function buildServiceLookup<T extends { service: string }>(logServices: T[]): (healthName: string) => T | undefined {
  const exact = new Map(logServices.map((s) => [norm(s.service), s]));
  const stripped = new Map(logServices.map((s) => [strip(norm(s.service)), s]));
  return (name) => {
    const key = norm(name);
    const short = strip(key);
    const alias = ALIAS_BY_KEY.get(key);
    return exact.get(key) ?? (short !== key ? stripped.get(short) : undefined) ?? (alias ? exact.get(alias) : undefined);
  };
}
