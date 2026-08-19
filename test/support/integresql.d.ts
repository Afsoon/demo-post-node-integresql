export type IntegreSqlContext = {
  url: string;
  templateHash: string;
  host: string;
  port: number;
};

declare module "vitest" {
  interface ProvidedContext {
    integresql: IntegreSqlContext;
  }
}
