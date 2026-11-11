type Named = { fullName?: string | null; username?: string | null; primaryEmailAddress?: { emailAddress: string } | null };

/** A person's name as the app shows it: their full name, else their username, else the start of their email. */
export function displayName(user: Named | null | undefined) {
  return user?.fullName || user?.username || user?.primaryEmailAddress?.emailAddress.split('@')[0] || '';
}
