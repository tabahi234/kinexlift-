import { getCountry } from '../domain/cuisines';

/**
 * A first guess at where she is, from the browser and nothing else.
 *
 * Offline, no network call, no IP lookup, no permission prompt - which rules
 * out the accurate options and is the right trade for this app. It is only
 * ever used to pre-select an answer she is looking straight at and can change
 * in one tap, so being wrong costs her a tap and being right saves her the
 * whole question.
 *
 * The locale is tried first because `en-PK` names a country outright. The time
 * zone is the fallback, and only for the handful of zones whose city is
 * unambiguous - a mapping of every IANA zone would be a second country table
 * to keep correct, for a guess.
 */

const ZONE_COUNTRY: Record<string, string> = {
  'Asia/Karachi': 'PK',
  'Asia/Kolkata': 'IN',
  'Asia/Calcutta': 'IN',
  'Asia/Dhaka': 'BD',
  'Asia/Colombo': 'LK',
  'Asia/Kathmandu': 'NP',
  'Asia/Dubai': 'AE',
  'Asia/Riyadh': 'SA',
  'Asia/Qatar': 'QA',
  'Asia/Kuwait': 'KW',
  'Asia/Amman': 'JO',
  'Asia/Beirut': 'LB',
  'Asia/Baghdad': 'IQ',
  'Asia/Tehran': 'IR',
  'Europe/Istanbul': 'TR',
  'Asia/Istanbul': 'TR',
  'Asia/Jerusalem': 'IL',
  'Africa/Cairo': 'EG',
  'Africa/Casablanca': 'MA',
  'Africa/Lagos': 'NG',
  'Africa/Accra': 'GH',
  'Africa/Nairobi': 'KE',
  'Africa/Dar_es_Salaam': 'TZ',
  'Africa/Kampala': 'UG',
  'Africa/Addis_Ababa': 'ET',
  'Africa/Johannesburg': 'ZA',
  'Asia/Shanghai': 'CN',
  'Asia/Hong_Kong': 'HK',
  'Asia/Taipei': 'TW',
  'Asia/Tokyo': 'JP',
  'Asia/Seoul': 'KR',
  'Asia/Jakarta': 'ID',
  'Asia/Kuala_Lumpur': 'MY',
  'Asia/Singapore': 'SG',
  'Asia/Bangkok': 'TH',
  'Asia/Ho_Chi_Minh': 'VN',
  'Asia/Saigon': 'VN',
  'Asia/Manila': 'PH',
  'Europe/London': 'GB',
  'Europe/Dublin': 'IE',
  'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE',
  'Europe/Amsterdam': 'NL',
  'Europe/Madrid': 'ES',
  'Europe/Lisbon': 'PT',
  'Europe/Rome': 'IT',
  'Europe/Athens': 'GR',
  'Europe/Warsaw': 'PL',
  'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO',
  'Europe/Copenhagen': 'DK',
  'Europe/Helsinki': 'FI',
  'Europe/Moscow': 'RU',
  'Europe/Kyiv': 'UA',
  'Europe/Kiev': 'UA',
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Los_Angeles': 'US',
  'America/Toronto': 'CA',
  'America/Vancouver': 'CA',
  'America/Mexico_City': 'MX',
  'America/Bogota': 'CO',
  'America/Lima': 'PE',
  'America/Santiago': 'CL',
  'America/Sao_Paulo': 'BR',
  'America/Argentina/Buenos_Aires': 'AR',
  'Australia/Sydney': 'AU',
  'Australia/Melbourne': 'AU',
  'Australia/Perth': 'AU',
  'Pacific/Auckland': 'NZ',
};

/** An ISO country code the app has food for, or null. Never throws. */
export function guessCountry(): string | null {
  try {
    for (const tag of navigator.languages ?? [navigator.language]) {
      // 'en-PK' or 'ur-PK'. A bare 'en' names no country and is skipped.
      const region = tag?.split('-')[1];
      if (region && getCountry(region)) return region.toUpperCase();
    }
  } catch {
    // Intl or navigator missing. The question still gets asked.
  }

  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const code = zone ? ZONE_COUNTRY[zone] : undefined;
    if (code && getCountry(code)) return code;
  } catch {
    // Same.
  }

  return null;
}
