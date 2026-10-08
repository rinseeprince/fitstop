/**
 * An address with the middle of its local part hidden: "sam.smith@gmail.com"
 * reads "s•••h@gmail.com". The invite page shows it so the invited person can
 * recognise their address while whoever holds a forwarded link learns little
 * (D11). A one-letter local part keeps its letter alone.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "•••";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const tail = local.length > 1 ? local[local.length - 1] : "";
  return `${local[0]}•••${tail}@${domain}`;
}
