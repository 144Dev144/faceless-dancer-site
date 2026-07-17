import { Router } from "express";
import { supportRequestSchema } from "@faceless/shared";
import { sendSupportEmail } from "./mailer.js";

const router = Router();
const windowMs = 10 * 60 * 1000;
const maxRequestsPerWindow = 5;
const requestCounts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  for (const [entryKey, entry] of requestCounts) {
    if (entry.resetAt <= now) requestCounts.delete(entryKey);
  }

  const current = requestCounts.get(key);
  if (!current || current.resetAt <= now) {
    requestCounts.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  current.count += 1;
  return current.count > maxRequestsPerWindow;
}

router.post("/", async (req, res) => {
  const clientKey = req.ip || "unknown";
  if (isRateLimited(clientKey)) {
    return res.status(429).json({ error: "Too many support requests. Please try again later." });
  }

  const parsed = supportRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Enter a valid email, issue type, and message." });
  }

  try {
    await sendSupportEmail(parsed.data, {
      ip: clientKey,
      userAgent: String(req.get("user-agent") ?? ""),
    });
    console.info(`[support] request sent issue_type=${parsed.data.issueType}`);
    return res.status(202).json({ submitted: true });
  } catch (error) {
    console.error("[support] email delivery failed", error instanceof Error ? error.message : error);
    return res.status(503).json({ error: "Support is temporarily unavailable. Please try again shortly." });
  }
});

export const supportRouter = router;
