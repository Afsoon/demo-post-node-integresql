export type PgTestContext = {
  host: string;
  port: number;
};

declare module "vitest" {
  interface ProvidedContext {
    pgtest: PgTestContext;
  }
}
