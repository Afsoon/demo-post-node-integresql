import { afterAll } from "vitest";
import { releaseGlobalTestDatabase } from "./support/database.ts";

afterAll(releaseGlobalTestDatabase);
