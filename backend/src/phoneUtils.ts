/**
 * Phone helpers for guest dedupe / lookup and WhatsApp JIDs.
 *
 * Comparison: Israeli E.164 (972…) maps to leading 0; local Israeli mobiles (05… / 5…) get a leading 0.
 * Numbers entered with a leading "+" keep their country code for WhatsApp (digits only + @c.us).
 * Local Israeli style without "+" (e.g. 058-4455883) is sent as 972… so WhatsApp resolves correctly.
 */

const digitsOnly = (phone: string): string => phone.replace(/\D/g, '');

/** Strip a leading international trunk 00 when followed by a full country code (not 972-only). */
const stripLeadingDoubleZero = (d: string): string => {
  if (!d.startsWith('00') || d.length <= 2) {
    return d;
  }
  return d.slice(2);
};

const isIsraeliMobileNineDigits = (d: string): boolean => d.length === 9 && /^5\d{8}$/.test(d);

const isIsraeliMobileTenDigits = (d: string): boolean => d.length === 10 && /^05\d{8}$/.test(d);

export const normalizePhoneForComparison = (phone: string): string => {
  let d = digitsOnly(phone);
  d = stripLeadingDoubleZero(d);

  if (d.startsWith('972')) {
    return `0${d.slice(3)}`;
  }
  if (isIsraeliMobileNineDigits(d)) {
    return `0${d}`;
  }
  return d;
};

export const formatPhoneForWhatsApp = (phone: string): string => {
  const trimmed = phone.trim();
  if (trimmed.startsWith('+')) {
    return `${digitsOnly(trimmed)}@c.us`;
  }

  let d = digitsOnly(trimmed);
  d = stripLeadingDoubleZero(d);

  if (d.startsWith('972')) {
    return `${d}@c.us`;
  }

  if (isIsraeliMobileNineDigits(d) || isIsraeliMobileTenDigits(d)) {
    const withoutLeadingZero = d.startsWith('0') ? d.slice(1) : d;
    return `972${withoutLeadingZero}@c.us`;
  }

  return `${d}@c.us`;
};
