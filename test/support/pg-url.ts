import type { IntegreSQLDatabaseConfig } from "@devoxa/integresql-client";

export type PgTarget = { host: string; port: number } | { socketDir: string };

/**
 * Connection string for a leased database. integresql reports its own view of the connection
 * (the socket dir it uses); from a worker we either reach Postgres over the mapped TCP port or,
 * on Linux with TEST_PG_SOCKET_DIR, over the same unix socket (`?host=<dir>` is how node-postgres
 * takes a socket directory).
 */
export function pgConnectionUrl(config: IntegreSQLDatabaseConfig, target: PgTarget) {
  const auth = `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}`;
  if ("socketDir" in target) {
    return `postgresql://${auth}@/${config.database}?host=${encodeURIComponent(target.socketDir)}&port=5432`;
  }
  return `postgresql://${auth}@${target.host}:${target.port}/${config.database}`;
}
