/**
 * Where she cooks.
 *
 * The food table used to have one bit on it - `desi: true` - which was the
 * right instinct with the wrong resolution. A protein target you cannot hit
 * with the food actually in your kitchen is a target you abandon in a
 * fortnight, and that is as true in Lagos, Manila and Mexico City as it is in
 * Lahore. So the table carries a region, the app asks her country once, and
 * every list of food she is shown leads with what she actually eats.
 *
 * A country maps to exactly one region. That is a simplification and it is a
 * deliberate one: the alternative is asking her to describe her cuisine, which
 * is a question nobody wants to answer on the third screen of an onboarding.
 * She can change the region directly on You afterwards, and the map is only
 * ever used to *order* a list - nothing is hidden because of it, so the cost
 * of the app guessing Mediterranean for a Turkish user is that hummus sorts
 * two rows lower than it should.
 */

export type Cuisine =
  | 'south-asian'
  | 'middle-eastern'
  | 'east-asian'
  | 'southeast-asian'
  | 'mediterranean'
  | 'western'
  | 'african'
  | 'latin-american';

export const CUISINES: Cuisine[] = [
  'south-asian',
  'middle-eastern',
  'east-asian',
  'southeast-asian',
  'mediterranean',
  'western',
  'african',
  'latin-american',
];

export const CUISINE_LABEL: Record<Cuisine, string> = {
  'south-asian': 'South Asian',
  'middle-eastern': 'Middle Eastern',
  'east-asian': 'East Asian',
  'southeast-asian': 'Southeast Asian',
  mediterranean: 'Mediterranean',
  western: 'Western',
  african: 'African',
  'latin-american': 'Latin American',
};

/** What she will recognise on the plate, said in food rather than in geography. */
export const CUISINE_HINT: Record<Cuisine, string> = {
  'south-asian': 'Roti, daal, karahi, biryani, chana',
  'middle-eastern': 'Hummus, shawarma, kebab, rice, labneh',
  'east-asian': 'Rice, tofu, noodles, stir fry, kimchi',
  'southeast-asian': 'Rice, pho, adobo, tempeh, curry',
  mediterranean: 'Olive oil, fish, beans, feta, pasta',
  western: 'Bread, oats, chicken, potatoes, dairy',
  african: 'Beans, stew, plantain, injera, rice',
  'latin-american': 'Beans, tortillas, rice, eggs, chicken',
};

export interface Country {
  /** ISO 3166-1 alpha-2. Stored on the profile; never shown to her. */
  code: string;
  name: string;
  cuisine: Cuisine;
}

/**
 * Countries, with the region whose food table best matches an everyday shop
 * there. Written out by region because that is the only way to keep it
 * checkable by eye.
 */
export const COUNTRIES: Country[] = [
  /* ----------------------------- South Asian ----------------------------- */
  { code: 'PK', name: 'Pakistan', cuisine: 'south-asian' },
  { code: 'IN', name: 'India', cuisine: 'south-asian' },
  { code: 'BD', name: 'Bangladesh', cuisine: 'south-asian' },
  { code: 'LK', name: 'Sri Lanka', cuisine: 'south-asian' },
  { code: 'NP', name: 'Nepal', cuisine: 'south-asian' },
  { code: 'AF', name: 'Afghanistan', cuisine: 'south-asian' },
  { code: 'BT', name: 'Bhutan', cuisine: 'south-asian' },
  { code: 'MV', name: 'Maldives', cuisine: 'south-asian' },

  /* ---------------------------- Middle Eastern ---------------------------- */
  { code: 'AE', name: 'United Arab Emirates', cuisine: 'middle-eastern' },
  { code: 'SA', name: 'Saudi Arabia', cuisine: 'middle-eastern' },
  { code: 'QA', name: 'Qatar', cuisine: 'middle-eastern' },
  { code: 'KW', name: 'Kuwait', cuisine: 'middle-eastern' },
  { code: 'BH', name: 'Bahrain', cuisine: 'middle-eastern' },
  { code: 'OM', name: 'Oman', cuisine: 'middle-eastern' },
  { code: 'JO', name: 'Jordan', cuisine: 'middle-eastern' },
  { code: 'LB', name: 'Lebanon', cuisine: 'middle-eastern' },
  { code: 'SY', name: 'Syria', cuisine: 'middle-eastern' },
  { code: 'IQ', name: 'Iraq', cuisine: 'middle-eastern' },
  { code: 'IR', name: 'Iran', cuisine: 'middle-eastern' },
  { code: 'TR', name: 'Türkiye', cuisine: 'middle-eastern' },
  { code: 'IL', name: 'Israel', cuisine: 'middle-eastern' },
  { code: 'PS', name: 'Palestine', cuisine: 'middle-eastern' },
  { code: 'YE', name: 'Yemen', cuisine: 'middle-eastern' },
  { code: 'EG', name: 'Egypt', cuisine: 'middle-eastern' },
  { code: 'MA', name: 'Morocco', cuisine: 'middle-eastern' },
  { code: 'DZ', name: 'Algeria', cuisine: 'middle-eastern' },
  { code: 'TN', name: 'Tunisia', cuisine: 'middle-eastern' },
  { code: 'LY', name: 'Libya', cuisine: 'middle-eastern' },
  { code: 'AZ', name: 'Azerbaijan', cuisine: 'middle-eastern' },
  { code: 'UZ', name: 'Uzbekistan', cuisine: 'middle-eastern' },
  { code: 'KZ', name: 'Kazakhstan', cuisine: 'middle-eastern' },

  /* ------------------------------ East Asian ------------------------------ */
  { code: 'CN', name: 'China', cuisine: 'east-asian' },
  { code: 'JP', name: 'Japan', cuisine: 'east-asian' },
  { code: 'KR', name: 'South Korea', cuisine: 'east-asian' },
  { code: 'TW', name: 'Taiwan', cuisine: 'east-asian' },
  { code: 'HK', name: 'Hong Kong', cuisine: 'east-asian' },
  { code: 'MN', name: 'Mongolia', cuisine: 'east-asian' },

  /* --------------------------- Southeast Asian --------------------------- */
  { code: 'ID', name: 'Indonesia', cuisine: 'southeast-asian' },
  { code: 'MY', name: 'Malaysia', cuisine: 'southeast-asian' },
  { code: 'SG', name: 'Singapore', cuisine: 'southeast-asian' },
  { code: 'TH', name: 'Thailand', cuisine: 'southeast-asian' },
  { code: 'VN', name: 'Vietnam', cuisine: 'southeast-asian' },
  { code: 'PH', name: 'Philippines', cuisine: 'southeast-asian' },
  { code: 'MM', name: 'Myanmar', cuisine: 'southeast-asian' },
  { code: 'KH', name: 'Cambodia', cuisine: 'southeast-asian' },
  { code: 'LA', name: 'Laos', cuisine: 'southeast-asian' },
  { code: 'BN', name: 'Brunei', cuisine: 'southeast-asian' },

  /* ---------------------------- Mediterranean ---------------------------- */
  { code: 'IT', name: 'Italy', cuisine: 'mediterranean' },
  { code: 'GR', name: 'Greece', cuisine: 'mediterranean' },
  { code: 'ES', name: 'Spain', cuisine: 'mediterranean' },
  { code: 'PT', name: 'Portugal', cuisine: 'mediterranean' },
  { code: 'CY', name: 'Cyprus', cuisine: 'mediterranean' },
  { code: 'MT', name: 'Malta', cuisine: 'mediterranean' },
  { code: 'HR', name: 'Croatia', cuisine: 'mediterranean' },
  { code: 'AL', name: 'Albania', cuisine: 'mediterranean' },
  { code: 'RS', name: 'Serbia', cuisine: 'mediterranean' },
  { code: 'BA', name: 'Bosnia and Herzegovina', cuisine: 'mediterranean' },
  { code: 'BG', name: 'Bulgaria', cuisine: 'mediterranean' },
  { code: 'RO', name: 'Romania', cuisine: 'mediterranean' },

  /* -------------------------------- Western -------------------------------- */
  { code: 'GB', name: 'United Kingdom', cuisine: 'western' },
  { code: 'IE', name: 'Ireland', cuisine: 'western' },
  { code: 'US', name: 'United States', cuisine: 'western' },
  { code: 'CA', name: 'Canada', cuisine: 'western' },
  { code: 'AU', name: 'Australia', cuisine: 'western' },
  { code: 'NZ', name: 'New Zealand', cuisine: 'western' },
  { code: 'DE', name: 'Germany', cuisine: 'western' },
  { code: 'FR', name: 'France', cuisine: 'western' },
  { code: 'NL', name: 'Netherlands', cuisine: 'western' },
  { code: 'BE', name: 'Belgium', cuisine: 'western' },
  { code: 'AT', name: 'Austria', cuisine: 'western' },
  { code: 'CH', name: 'Switzerland', cuisine: 'western' },
  { code: 'SE', name: 'Sweden', cuisine: 'western' },
  { code: 'NO', name: 'Norway', cuisine: 'western' },
  { code: 'DK', name: 'Denmark', cuisine: 'western' },
  { code: 'FI', name: 'Finland', cuisine: 'western' },
  { code: 'IS', name: 'Iceland', cuisine: 'western' },
  { code: 'PL', name: 'Poland', cuisine: 'western' },
  { code: 'CZ', name: 'Czechia', cuisine: 'western' },
  { code: 'SK', name: 'Slovakia', cuisine: 'western' },
  { code: 'HU', name: 'Hungary', cuisine: 'western' },
  { code: 'SI', name: 'Slovenia', cuisine: 'western' },
  { code: 'UA', name: 'Ukraine', cuisine: 'western' },
  { code: 'RU', name: 'Russia', cuisine: 'western' },
  { code: 'LT', name: 'Lithuania', cuisine: 'western' },
  { code: 'LV', name: 'Latvia', cuisine: 'western' },
  { code: 'EE', name: 'Estonia', cuisine: 'western' },

  /* -------------------------------- African -------------------------------- */
  { code: 'NG', name: 'Nigeria', cuisine: 'african' },
  { code: 'GH', name: 'Ghana', cuisine: 'african' },
  { code: 'KE', name: 'Kenya', cuisine: 'african' },
  { code: 'TZ', name: 'Tanzania', cuisine: 'african' },
  { code: 'UG', name: 'Uganda', cuisine: 'african' },
  { code: 'ET', name: 'Ethiopia', cuisine: 'african' },
  { code: 'SO', name: 'Somalia', cuisine: 'african' },
  { code: 'SD', name: 'Sudan', cuisine: 'african' },
  { code: 'ZA', name: 'South Africa', cuisine: 'african' },
  { code: 'ZW', name: 'Zimbabwe', cuisine: 'african' },
  { code: 'ZM', name: 'Zambia', cuisine: 'african' },
  { code: 'CM', name: 'Cameroon', cuisine: 'african' },
  { code: 'SN', name: 'Senegal', cuisine: 'african' },
  { code: 'CI', name: "Côte d'Ivoire", cuisine: 'african' },
  { code: 'CD', name: 'DR Congo', cuisine: 'african' },
  { code: 'RW', name: 'Rwanda', cuisine: 'african' },
  { code: 'MW', name: 'Malawi', cuisine: 'african' },
  { code: 'MZ', name: 'Mozambique', cuisine: 'african' },
  { code: 'AO', name: 'Angola', cuisine: 'african' },
  { code: 'MU', name: 'Mauritius', cuisine: 'african' },

  /* ---------------------------- Latin American ---------------------------- */
  { code: 'MX', name: 'Mexico', cuisine: 'latin-american' },
  { code: 'BR', name: 'Brazil', cuisine: 'latin-american' },
  { code: 'AR', name: 'Argentina', cuisine: 'latin-american' },
  { code: 'CO', name: 'Colombia', cuisine: 'latin-american' },
  { code: 'CL', name: 'Chile', cuisine: 'latin-american' },
  { code: 'PE', name: 'Peru', cuisine: 'latin-american' },
  { code: 'VE', name: 'Venezuela', cuisine: 'latin-american' },
  { code: 'EC', name: 'Ecuador', cuisine: 'latin-american' },
  { code: 'BO', name: 'Bolivia', cuisine: 'latin-american' },
  { code: 'PY', name: 'Paraguay', cuisine: 'latin-american' },
  { code: 'UY', name: 'Uruguay', cuisine: 'latin-american' },
  { code: 'GT', name: 'Guatemala', cuisine: 'latin-american' },
  { code: 'HN', name: 'Honduras', cuisine: 'latin-american' },
  { code: 'SV', name: 'El Salvador', cuisine: 'latin-american' },
  { code: 'NI', name: 'Nicaragua', cuisine: 'latin-american' },
  { code: 'CR', name: 'Costa Rica', cuisine: 'latin-american' },
  { code: 'PA', name: 'Panama', cuisine: 'latin-american' },
  { code: 'CU', name: 'Cuba', cuisine: 'latin-american' },
  { code: 'DO', name: 'Dominican Republic', cuisine: 'latin-american' },
  { code: 'PR', name: 'Puerto Rico', cuisine: 'latin-american' },
  { code: 'JM', name: 'Jamaica', cuisine: 'latin-american' },
  { code: 'TT', name: 'Trinidad and Tobago', cuisine: 'latin-american' },
];

const BY_CODE = new Map(COUNTRIES.map((country) => [country.code, country]));

export function getCountry(code: string | null | undefined): Country | undefined {
  return code ? BY_CODE.get(code.toUpperCase()) : undefined;
}

export function countryName(code: string | null | undefined): string | null {
  return getCountry(code)?.name ?? null;
}

/**
 * The region whose food she is shown first.
 *
 * Null - "she has not said" - is a real answer and is handled everywhere
 * rather than defaulted, because a wrong guess here is worse than no guess:
 * ordering the list by a region she has nothing to do with is a list that
 * looks broken, and an unsorted list only looks arbitrary.
 */
export function cuisineForCountry(code: string | null | undefined): Cuisine | null {
  return getCountry(code)?.cuisine ?? null;
}

/** Alphabetical, for a picker. The declaration order above is by region. */
export function countriesByName(): Country[] {
  return [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Countries whose name or code contains the query, best matches first.
 *
 * A prefix match sorts above a substring one so typing "in" offers India
 * before Argentina, which is the only reason a search box beats a long select.
 */
export function searchCountries(query: string, limit = 8): Country[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];

  const scored = COUNTRIES.map((country) => {
    const name = country.name.toLowerCase();
    if (name.startsWith(needle)) return { country, score: 0 };
    if (country.code.toLowerCase() === needle) return { country, score: 1 };
    if (name.includes(needle)) return { country, score: 2 };
    return null;
  }).filter((entry): entry is { country: Country; score: number } => entry !== null);

  return scored
    .sort((a, b) => a.score - b.score || a.country.name.localeCompare(b.country.name))
    .slice(0, limit)
    .map((entry) => entry.country);
}
