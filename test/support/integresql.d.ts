export type IntegreSqlContext = {
  url: string;
  templateHash: string;
  host: string;
  port: number;
  /** Host directory holding Postgres' unix socket (Linux/CI only); when set, workers connect through it. */
  socketDir?: string;
};

declare module "vitest" {
  interface ProvidedContext {
    integresql: IntegreSqlContext;
  }
}
