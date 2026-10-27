/** Shared execution policy. `automatic` must come from a trusted local setting,
 * never from request arguments, a synced profile, or an MCP tool result. */
export type ConfirmationMode = "per-request" | "automatic";
export type MutationApproval = "read" | "automatic" | "prompt" | "confirmation-required";

export function confirmationMode(automatic: boolean): ConfirmationMode {
  return automatic === true ? "automatic" : "per-request";
}

export function mutationApproval(input: { mutation: boolean; automatic: boolean; confirmed?: boolean }): MutationApproval {
  if (!input.mutation) return "read";
  if (input.automatic === true) return "automatic";
  return input.confirmed === true ? "prompt" : "confirmation-required";
}
