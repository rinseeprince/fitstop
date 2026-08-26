import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  getRedisClient: vi.fn(),
}));

import {
  getCachedClientId,
  getCachedCoachId,
} from "./auth-cache";
import { getRedisClient } from "@/lib/rate-limit";

type RedisStub = {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
};

function makeRedis(): RedisStub {
  return { get: vi.fn(), set: vi.fn() };
}

describe("auth-cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getCachedClientId", () => {
    it("(a) bypasses cache when Redis is unavailable (control)", async () => {
      vi.mocked(getRedisClient).mockReturnValue(null);
      const loader = vi.fn().mockResolvedValue("client-1");

      const result = await getCachedClientId("user-1", loader);

      expect(result).toBe("client-1");
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("(b) returns the cached value without calling the loader", async () => {
      const redis = makeRedis();
      redis.get.mockResolvedValue("client-cached");
      vi.mocked(getRedisClient).mockReturnValue(redis as never);
      const loader = vi.fn().mockResolvedValue("client-fresh");

      const result = await getCachedClientId("user-1", loader);

      expect(result).toBe("client-cached");
      expect(loader).not.toHaveBeenCalled();
      expect(redis.get).toHaveBeenCalledWith("authmap:client:user-1");
    });

    it("(c) on miss, runs loader and caches with the right key + value + ttl", async () => {
      const redis = makeRedis();
      redis.get.mockResolvedValue(null);
      vi.mocked(getRedisClient).mockReturnValue(redis as never);
      const loader = vi.fn().mockResolvedValue("client-fresh");

      const result = await getCachedClientId("user-7", loader);

      expect(result).toBe("client-fresh");
      expect(loader).toHaveBeenCalledTimes(1);
      expect(redis.set).toHaveBeenCalledWith(
        "authmap:client:user-7",
        "client-fresh",
        { ex: 60 },
      );
    });

    it("(d) never caches a null loader result", async () => {
      const redis = makeRedis();
      redis.get.mockResolvedValue(null);
      vi.mocked(getRedisClient).mockReturnValue(redis as never);
      const loader = vi.fn().mockResolvedValue(null);

      const result = await getCachedClientId("user-1", loader);

      expect(result).toBeNull();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it("(e) falls through to the loader when get throws", async () => {
      const redis = makeRedis();
      redis.get.mockRejectedValue(new Error("redis down"));
      vi.mocked(getRedisClient).mockReturnValue(redis as never);
      const loader = vi.fn().mockResolvedValue("client-fresh");

      const result = await getCachedClientId("user-1", loader);

      expect(result).toBe("client-fresh");
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("(f) still returns the fresh value when set throws", async () => {
      const redis = makeRedis();
      redis.get.mockResolvedValue(null);
      redis.set.mockRejectedValue(new Error("redis down"));
      vi.mocked(getRedisClient).mockReturnValue(redis as never);
      const loader = vi.fn().mockResolvedValue("client-fresh");

      const result = await getCachedClientId("user-1", loader);

      expect(result).toBe("client-fresh");
    });
  });

  describe("getCachedCoachId", () => {
    it("(a) bypasses cache when Redis is unavailable (control)", async () => {
      vi.mocked(getRedisClient).mockReturnValue(null);
      const loader = vi.fn().mockResolvedValue("coach-1");

      const result = await getCachedCoachId("user-1", loader);

      expect(result).toBe("coach-1");
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("(b) returns the cached value without calling the loader", async () => {
      const redis = makeRedis();
      redis.get.mockResolvedValue("coach-cached");
      vi.mocked(getRedisClient).mockReturnValue(redis as never);
      const loader = vi.fn().mockResolvedValue("coach-fresh");

      const result = await getCachedCoachId("user-1", loader);

      expect(result).toBe("coach-cached");
      expect(loader).not.toHaveBeenCalled();
      expect(redis.get).toHaveBeenCalledWith("authmap:coach:user-1");
    });

    it("(c) on miss, runs loader and caches with the right key + value + ttl", async () => {
      const redis = makeRedis();
      redis.get.mockResolvedValue(null);
      vi.mocked(getRedisClient).mockReturnValue(redis as never);
      const loader = vi.fn().mockResolvedValue("coach-fresh");

      const result = await getCachedCoachId("user-7", loader);

      expect(result).toBe("coach-fresh");
      expect(loader).toHaveBeenCalledTimes(1);
      expect(redis.set).toHaveBeenCalledWith(
        "authmap:coach:user-7",
        "coach-fresh",
        { ex: 60 },
      );
    });

    it("(d) never caches a null loader result", async () => {
      const redis = makeRedis();
      redis.get.mockResolvedValue(null);
      vi.mocked(getRedisClient).mockReturnValue(redis as never);
      const loader = vi.fn().mockResolvedValue(null);

      const result = await getCachedCoachId("user-1", loader);

      expect(result).toBeNull();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it("(e) does not collide with the client key for the same user", async () => {
      const redis = makeRedis();
      redis.get.mockResolvedValue(null);
      vi.mocked(getRedisClient).mockReturnValue(redis as never);

      await getCachedCoachId("user-1", vi.fn().mockResolvedValue("coach-1"));
      await getCachedClientId("user-1", vi.fn().mockResolvedValue("client-1"));

      expect(redis.get).toHaveBeenNthCalledWith(1, "authmap:coach:user-1");
      expect(redis.get).toHaveBeenNthCalledWith(2, "authmap:client:user-1");
    });
  });
});
