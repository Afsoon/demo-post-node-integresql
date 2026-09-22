import { GenericContainer, getContainerRuntimeClient, type WaitStrategy } from "testcontainers";

/** Retain pgtest for inspection, including when its readiness check fails. */
export class PgtestContainer extends GenericContainer {
  private containerId?: string;
  private startupFailure?: { error: unknown };

  constructor(image: string) {
    super(image);
    this.createOpts.StopSignal = "SIGINT";
    this.withAutoCleanup(false);
    this.withAutoRemove(false);
    this.withReuse();
  }

  override withWaitStrategy(strategy: WaitStrategy) {
    // Testcontainers removes containers on readiness errors regardless of its
    // cleanup flags. Rethrow after start() returns, outside that removal path.
    const retained: WaitStrategy = {
      waitUntilReady: async (...args) => {
        this.startupFailure = undefined;
        try {
          await strategy.waitUntilReady(...args);
        } catch (error) {
          this.startupFailure = { error };
        }
      },
      withStartupTimeout: (timeout) => {
        strategy.withStartupTimeout(timeout);
        return retained;
      },
      isStartupTimeoutSet: () => strategy.isStartupTimeoutSet(),
      getStartupTimeout: () => strategy.getStartupTimeout(),
    };
    return super.withWaitStrategy(retained);
  }

  override async start() {
    const container = await super.start();
    if (this.startupFailure) throw this.startupFailure.error;
    return container;
  }

  protected override async containerCreated(id: string) {
    this.containerId = id;
    console.info(`[pgtest] container retained for inspection: ${id}`);
  }

  async stopForInspection() {
    if (!this.containerId) return;
    const client = await getContainerRuntimeClient();
    const container = client.container.getById(this.containerId);
    let state;
    try {
      state = await container.inspect();
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode !== 404) throw error;
      return;
    }
    if (state.State.Running) await container.stop({ t: 30 });
  }
}

/** Let managed containers stop before Vitest's immediate signal exit. */
export function deferTerminationUntil(cleanup: () => Promise<void>) {
  const signals = ["SIGINT", "SIGTERM"] as const;
  const previous = signals.map((signal) => [signal, process.rawListeners(signal)] as const);
  let terminating = false;
  const handlers = signals.map((signal) => {
    const handler = () => {
      if (terminating) return;
      terminating = true;
      void cleanup()
        .catch(console.error)
        .finally(() => {
          restore();
          process.kill(process.pid, signal);
        });
    };
    process.removeAllListeners(signal);
    process.on(signal, handler);
    return [signal, handler] as const;
  });
  let restored = false;
  function restore() {
    if (restored) return;
    restored = true;
    for (const [signal, handler] of handlers) process.off(signal, handler);
    for (const [signal, listeners] of previous) {
      for (const listener of listeners) process.on(signal, listener);
    }
  }
  return restore;
}
