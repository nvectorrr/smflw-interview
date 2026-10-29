export function passwordChangeError(
  password: string,
  confirmation: string,
): string {
  if (password.length < 6)
    return "Use at least 6 characters for your new password.";
  if (password !== confirmation) return "The new passwords do not match.";
  return "";
}
