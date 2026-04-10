type FetchMethod<K, T> = (key: K) => Promise<T>;

export function createFetcher<K extends PropertyKey = string, T = any>(
  max: number = 100,
) {
  let num: number;
  let curr: Record<K, T>;
  let prev: Record<K, T>;
  const limit = max || 1;

  const reset = (isPartial?: boolean) => {
    num = 0;
    curr = Object.create(null);
    if (!isPartial) prev = Object.create(null);
  };

  const keep = (key: K, value: T) => {
    if (++num > limit) {
      prev = curr;
      reset(true);
      ++num;
    }
    curr[key] = value;
  };

  reset();

  const inFlight = new Map<K, Promise<T>>();

  return async function fetcher(
    key: K,
    fetchMethod: FetchMethod<K, T>,
  ): Promise<T> {
    let val = curr[key];
    if (val !== undefined) return val;

    val = prev[key];
    if (val !== undefined) {
      keep(key, val);
      return val;
    }

    const existing = inFlight.get(key);
    if (existing !== undefined) return existing;

    const work = (async () => {
      try {
        const result = await fetchMethod(key);

        if (curr[key] !== undefined) {
          curr[key] = result;
        } else {
          keep(key, result);
        }

        return result;
      } finally {
        inFlight.delete(key);
      }
    })();

    inFlight.set(key, work);
    return work;
  };
}
