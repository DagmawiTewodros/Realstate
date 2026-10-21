/**
 * Normalizes phone numbers to international (E.164-like) format.
 * Ethiopian numbers in local form ("0911 23 45 67", "911234567") become "+251911234567".
 * Returns null when the input cannot be a valid phone number.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return null;

  let result: string;
  if (hasPlus) {
    result = `+${digits}`;
  } else if (digits.startsWith("00")) {
    result = `+${digits.slice(2)}`;
  } else if (digits.startsWith("251") && digits.length === 12) {
    result = `+${digits}`;
  } else if (digits.startsWith("0") && digits.length === 10) {
    result = `+251${digits.slice(1)}`;
  } else if (digits.length === 9 && /^[79]/.test(digits)) {
    result = `+251${digits}`;
  } else {
    return null;
  }

  const national = result.slice(1);
  if (national.length < 8 || national.length > 15) return null;
  if (national.startsWith("251") && national.length !== 12) return null;
  return result;
}

/** Masks a phone number for logs: "+2519****4567". Never log full numbers. */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  if (phone.length <= 8) return "****";
  return `${phone.slice(0, 5)}****${phone.slice(-4)}`;
}
