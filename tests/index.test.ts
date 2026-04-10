import { describe, it, expect, mock } from "bun:test";

import { createFetcher } from "nanoflight";

describe("nanoflight", () => {
  it("should deduplicate concurrent async calls", async () => {
    const fetcher = createFetcher();

    // Track how many times the actual work function runs
    const task = mock(async () => {
      await new Promise((r) => setTimeout(r, 10)); // Simulate network delay
      return "payload";
    });

    // Fire 3 requests at the same time
    const results = await Promise.all([
      fetcher("user-1", task),
      fetcher("user-1", task),
      fetcher("user-1", task),
    ]);

    // The task should only have executed ONCE
    expect(task).toHaveBeenCalledTimes(1);
    expect(results).toEqual(["payload", "payload", "payload"]);
  });

  it("should rotate items from curr to prev and eventually evict", async () => {
    // Limit of 2: curr can hold 2, prev can hold 2.
    const fetcher = createFetcher(2);
    const task = mock((key) => Promise.resolve(`val-${key}`));

    // 1. Fill curr: [1, 2]
    await fetcher("1", task);
    await fetcher("2", task);
    expect(task).toHaveBeenCalledTimes(2);

    // 2. Trigger rotation: curr: [3], prev: [1, 2]
    await fetcher("3", task);
    expect(task).toHaveBeenCalledTimes(3);

    // 3. Access '1': It should be in 'prev', so no new task call.
    // It also gets moved back to 'curr' per the 'keep' logic.
    const res = await fetcher("1", task);
    expect(res).toBe("val-1");
    expect(task).toHaveBeenCalledTimes(3);

    // 4. Evict: Fill curr with 2 more new items to push 'prev' out
    await fetcher("4", task);
    await fetcher("5", task);

    // Now '2' (which stayed in prev) should be gone.
    await fetcher("2", task);
    expect(task).toHaveBeenCalledTimes(6); // Incremented because '2' was evicted
  });

  it("should allow retrying if the initial task fails", async () => {
    const fetcher = createFetcher();
    let shouldFail = true;

    const task = mock(async () => {
      if (shouldFail) throw new Error("Network Error");
      return "Success";
    });

    // First attempt fails
    expect(fetcher("key", task)).rejects.toThrow("Network Error");

    // Second attempt (after failure)
    shouldFail = false;
    const result = await fetcher("key", task);

    expect(result).toBe("Success");
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("should pass the key as the first argument to the fetch method", async () => {
    const fetcher = createFetcher();
    const task = mock(async (passedKey: string) => {
      return `result-for-${passedKey}`;
    });

    const targetKey = "unique-id-123";
    const result = await fetcher(targetKey, task);

    // Assertions
    expect(result).toBe("result-for-unique-id-123");
    expect(task).toHaveBeenCalledWith(targetKey); // This confirms the key injection
  });

  it("should return the exact same promise instance for concurrent calls", async () => {
    const fetcher = createFetcher();
    const task = mock(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return "data";
    });

    const a = fetcher("key", task);
    const b = fetcher("key", task);

    expect(a).toBe(b);
    await a;
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("should handle nested calls for the same key (re-entry)", async () => {
    const fetcher = createFetcher();
    const task = mock(async (key: string) => {
      // Calling itself while still in-flight
      const internal = fetcher(key, async () => "nested");
      expect(internal).toBeDefined();
      return "original";
    });

    const result = await fetcher("zalgo-key", task);
    expect(result).toBe("original");
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("should follow the correct microtask execution order", async () => {
    const fetcher = createFetcher();
    const log: string[] = [];
    const task = async () => {
      log.push("start");
      await Promise.resolve();
      log.push("end");
      return "done";
    };

    const one = fetcher("time-key", task);
    await one;

    // By now, 'time-key' should be out of inFlight and in curr
    log.push("next");
    await fetcher("time-key", async () => {
      log.push("should-not-happen");
      return "done";
    });

    expect(log).toEqual(["start", "end", "next"]);
  });
});
