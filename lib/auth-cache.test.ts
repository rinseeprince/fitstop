import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  getRedisClient: vi.fn(),
}));

import { getCachedClientId, getCachedClientWithCheckInDay } from "./auth-cache";
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

  describe("getCachedClientWithCheckInDay", () => {
    const fresh = { clientId: "client-fresh", checkInDay: "monday" };

    it("(a) bypasses cache when Redis is unavailable (control)", async () => {
      vi.mocked(getRedisClient).mockReturnValue(null);
      const loader = vi.fn().mockResolvedValue(fresh);

      const result = await getCachedClientWithCheckInDay("user-1", loader);

      expect(result).toEqual(fresh);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("(b) returns the cached value without calling the loader", async () => {
      const redis = makeRedis();
      const cached = { clientId: "client-cached", checkInDay: null };
      redis.get.mockResolvedValue(cached);
      vi.mocked(getRedisClient).mockReturnValue(redis as never);
      const loader = vi.fn().mockResolvedValue(fresh);

      const result = await getCachedClientWithCheckInDay("user-1", loader);

      expect(result).toEqual(cached);
      expect(loader).not.toHaveBeenCalled();
      expect(redis.get).toHaveBeenCalledWith("authmap:clientcid:user-1");
    });

    it("(c) on miss, runs loader and caches with the right key + value + ttl", async () => {
      const redis = makeRedis();
      redis.get.mockResolvedValue(null);
      vi.mocked(getRedisClient).mockReturnValue(redis as never);
      const loader = vi.fn().mockResolvedValue(fresh);

      const result = await getCachedClientWithCheckInDay("user-9", loader);

      expect(result).toEqual(fresh);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(redis.set).toHaveBeenCalledWith(
        "authmap:clientcid:user-9",
        fresh,
        { ex: 60 },
      );
    });

    it("(d) never caches a null loader result", async () => {
      const redis = makeRedis();
      redis.get.mockResolvedValue(null);
      vi.mocked(getRedisClient).mockReturnValue(redis as never);
      const loader = vi.fn().mockResolvedValue(null);

      const result = await getCachedClientWithCheckInDay("user-1", loader);

      expect(result).toBeNull();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it("(e) falls through to the loader when get throws", async () => {
      const redis = makeRedis();
      redis.get.mockRejectedValue(new Error("redis down"));
      vi.mocked(getRedisClient).mockReturnValue(redis as never);
      const loader = vi.fn().mockResolvedValue(fresh);

      const result = await getCachedClientWithCheckInDay("user-1", loader);

      expect(result).toEqual(fresh);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("(f) still returns the fresh value when set throws", async () => {
      const redis = makeRedis();
      redis.get.mockResolvedValue(null);
      redis.set.mockRejectedValue(new Error("redis down"));
      vi.mocked(getRedisClient).mockReturnValue(redis as never);
      const loader = vi.fn().mockResolvedValue(fresh);

      const result = await getCachedClientWithCheckInDay("user-1", loader);

      expect(result).toEqual(fresh);
    });
  });
});
