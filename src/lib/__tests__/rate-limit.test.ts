// The rate limiter's idea of "who is this" must not be something the caller can choose. Behind
// Railway the real address is the LAST hop of X-Forwarded-For (the one the proxy appended); a
// client can put anything it likes in front of that. Without TRUST_PROXY the header is ignored.

import { describe, expect, it } from "vitest";
import { byIp, clientIp } from "@/lib/rate-limit";

const request = (headers: Record<string, string>) =>
  new Request("https://tielora.test/api/auth/login", { headers });

const trusted = { TRUST_PROXY: "1" };
const untrusted = {};

describe("clientIp / byIp behind a trusted proxy", () => {
  it("uses the last hop of X-Forwarded-For — the one the proxy appended", () => {
    const req = request({ "x-forwarded-for": "203.0.113.9, 198.51.100.7" });
    expect(clientIp(req, trusted)).toBe("198.51.100.7");
    expect(byIp(req, "login", trusted)).toBe("ip:login:198.51.100.7");
  });

  it("does not let a spoofed first hop change the limiter key", () => {
    const honest = request({ "x-forwarded-for": "198.51.100.7" });
    const spoofed = request({ "x-forwarded-for": "1.2.3.4, 198.51.100.7" });
    const spoofedAgain = request({ "x-forwarded-for": "5.6.7.8, 9.9.9.9, 198.51.100.7" });

    const key = byIp(honest, "login", trusted);
    expect(byIp(spoofed, "login", trusted)).toBe(key);
    expect(byIp(spoofedAgain, "login", trusted)).toBe(key);
  });

  it("falls back to x-real-ip, then 'unknown', when the header is empty", () => {
    expect(clientIp(request({ "x-real-ip": "198.51.100.7" }), trusted)).toBe("198.51.100.7");
    expect(byIp(request({}), "login", trusted)).toBe("ip:login:unknown");
  });
});

describe("clientIp / byIp without TRUST_PROXY", () => {
  it("ignores X-Forwarded-For entirely, because anybody can send one", () => {
    const req = request({ "x-forwarded-for": "1.2.3.4, 198.51.100.7", "x-real-ip": "192.0.2.1" });
    expect(clientIp(req, untrusted)).toBe("192.0.2.1");
    expect(byIp(req, "login", untrusted)).toBe("ip:login:192.0.2.1");
    expect(clientIp(request({ "x-forwarded-for": "1.2.3.4" }), untrusted)).toBeUndefined();
  });
});
