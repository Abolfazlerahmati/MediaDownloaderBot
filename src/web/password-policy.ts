import { PASSWORD_MIN_LENGTH } from '../limits';

/** Returns an error message, or null when the password is acceptable. */
export function passwordProblem(password: string, username: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > 200) return 'Use at most 200 characters.';
  if (password.toLowerCase() === username.toLowerCase()) return 'The password must not equal the username.';
  if (new Set(password).size < 4) return 'Use more varied characters.';
  return null;
}
