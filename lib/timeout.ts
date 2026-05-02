export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string = 'Operation'
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new TimeoutError(`${operationName} exceeded ${timeoutMs}ms timeout`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    clearTimeout(timeoutId!);
  }
}
