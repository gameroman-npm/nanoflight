export function createFetcher(max: number = 100) {
  let num: number,
    curr: Record<PropertyKey, unknown>,
    prev: Record<PropertyKey, unknown> = Object.create(null);

  const reset = () => {
    num = 0;
    curr = Object.create(null);
  };

  const keep = (key: PropertyKey, value: unknown) => {
    if (++num > (max || 1)) {
      prev = curr;
      reset();
      ++num;
    }
    curr[key] = value;
  };

  reset();

  const inFlight = new Map<PropertyKey, Promise<unknown>>();

  return function fetcher<K extends PropertyKey, T>(
    key: K,
    fetchMethod: (key: K) => Promise<T>,
  ): Promise<T> {
    let val = curr[key];
    if (val !== undefined) return Promise.resolve(val as T);

    val = prev[key];
    if (val !== undefined) {
      keep(key, val);
      return Promise.resolve(val as T);
    }

    const active = inFlight.get(key);
    if (active) return active as Promise<T>;

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
