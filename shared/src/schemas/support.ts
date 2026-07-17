import { z } from "zod";

export const supportIssueTypeSchema = z.enum(["bug_report", "refund_request", "general_support"]);

export const supportRequestSchema = z.object({
  email: z.string().trim().email().max(320),
  issueType: supportIssueTypeSchema,
  message: z.string().trim().min(10).max(5000),
});

export type SupportIssueType = z.infer<typeof supportIssueTypeSchema>;
export type SupportRequest = z.infer<typeof supportRequestSchema>;
