export type PostgrestLikeError = {
  code?: string | null;
  message?: string | null;
};

export type ReadResult<T> = {
  data: T;
  error: PostgrestLikeError | null;
};

export type RecoveryEvent = {
  classification: "transient-jwt-future";
  attempt: number;
  delayMs: number;
  recovered: boolean;
};

type RecoveryOptions = {
  delaysMs?: readonly number[];
  sleep?: (milliseconds: number) => Promise<void>;
  onRecoveryEvent?: (event: RecoveryEvent) => void;
};

const DEFAULT_DELAYS_MS = [750, 2250] as const;

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export function isPostgrestFutureJwtError(
  error: PostgrestLikeError | null | undefined
): boolean {
  return error?.code === "PGRST303" && error?.message === "JWT issued at future";
}

/**
 * READ OPERATIONS ONLY.
 * Never wrap inserts, updates, deletes, command RPCs, or any operation with side effects.
 */
export async function readWithPostgrestFutureJwtRecovery<T>(
  operation: () => PromiseLike<ReadResult<T>>,
  options: RecoveryOptions = {}
): Promise<ReadResult<T>> {
  const delaysMs = options.delaysMs ?? DEFAULT_DELAYS_MS;
  const sleep = options.sleep ?? defaultSleep;

  let result = await operation();

  for (let retryIndex = 0; retryIndex < delaysMs.length; retryIndex += 1) {
    if (!isPostgrestFutureJwtError(result.error)) return result;

    const delayMs = delaysMs[retryIndex];

    options.onRecoveryEvent?.({
      classification: "transient-jwt-future",
      attempt: retryIndex + 1,
      delayMs,
      recovered: false,
    });

    await sleep(delayMs);
    result = await operation();

    if (!isPostgrestFutureJwtError(result.error)) {
      options.onRecoveryEvent?.({
        classification: "transient-jwt-future",
        attempt: retryIndex + 1,
        delayMs,
        recovered: true,
      });
      return result;
    }
  }

  return result;
}
