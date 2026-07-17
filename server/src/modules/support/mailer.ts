import type { SupportRequest } from "@faceless/shared";
import { env } from "../../config/env.js";

const issueLabels: Record<SupportRequest["issueType"], string> = {
  bug_report: "Bug report",
  refund_request: "Refund request",
  general_support: "General support",
};

export async function sendSupportEmail(
  request: SupportRequest,
  metadata: { ip: string; userAgent: string },
): Promise<void> {
  if (!env.resendApiKey) {
    throw new Error("Resend API key is not configured");
  }

  const issueLabel = issueLabels[request.issueType];
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${env.supportFromName} <${env.supportFromEmail}>`,
      to: [env.supportEmail],
      reply_to: request.email,
      subject: `[Faceless Dancer Support] ${issueLabel}`,
      text: [
      `Issue type: ${issueLabel}`,
      `Reply email: ${request.email}`,
      "",
      request.message,
      "",
      `Submitted at: ${new Date().toISOString()}`,
      `Client IP: ${metadata.ip || "unknown"}`,
      `User agent: ${metadata.userAgent || "unknown"}`,
      ].join("\n"),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend returned HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
}
