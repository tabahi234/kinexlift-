import { useState } from 'react';
import {
  CUISINE_HINT,
  CUISINE_LABEL,
  countriesByName,
  cuisineForCountry,
  getCountry,
  searchCountries,
} from '../domain/cuisines';

/**
 * Where she cooks.
 *
 * A search box over a hundred and thirty countries rather than a select, for
 * the same reason the food search is a search box: a list this long is a list
 * you scroll past your own answer. Typing three letters is faster than any
 * dropdown, and the region the answer resolves to is shown underneath, because
 * a country picker that silently decides "Türkiye means Middle Eastern" should
 * say so where she can disagree with it.
 *
 * Nothing here filters anything. The answer only ever changes the *order* of
 * a list and which anchors a generated day reaches for first, and the copy
 * around it says that in words.
 */
export function CountryPicker({
  country,
  onPick,
  autoFocus = false,
}: {
  country: string | null;
  onPick: (code: string) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const selected = getCountry(country);
  const cuisine = cuisineForCountry(country);

  const results = query.trim() === '' ? [] : searchCountries(query, 6);
  // With nothing typed and nothing chosen, offer a handful rather than a wall.
  // Alphabetical, because any other order is the app having an opinion about
  // whose country matters.
  const suggestions = countriesByName();

  return (
    <div className="country-picker">
      {selected && (
        <div className="country-current">
          <span className="country-name">{selected.name}</span>
          {cuisine && (
            <span className="country-cuisine">
              {CUISINE_LABEL[cuisine]}: {CUISINE_HINT[cuisine]}
            </span>
          )}
        </div>
      )}

      <label className="search-field">
        <span className="sr-only">Search countries</span>
        <input
          type="search"
          value={query}
          autoFocus={autoFocus}
          placeholder={selected ? 'Type a different country' : 'Type your country'}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {results.length > 0 && (
        <div className="country-list">
          {results.map((option) => (
            <button
              key={option.code}
              type="button"
              className={`country-row ${option.code === country ? 'selected' : ''}`}
              onClick={() => {
                onPick(option.code);
                setQuery('');
              }}
            >
              <span className="country-name">{option.name}</span>
              <span className="country-cuisine">{CUISINE_LABEL[option.cuisine]}</span>
            </button>
          ))}
        </div>
      )}

      {query.trim() !== '' && results.length === 0 && (
        <p className="hint">
          Nothing matches that. Pick whichever country cooks closest to how you
          do. It only decides what the app shows you first.
        </p>
      )}

      {query.trim() === '' && !selected && (
        <>
          <p className="fineprint">Or scroll:</p>
          <div className="country-list scrolling">
            {suggestions.map((option) => (
              <button
                key={option.code}
                type="button"
                className="country-row"
                onClick={() => onPick(option.code)}
              >
                <span className="country-name">{option.name}</span>
                <span className="country-cuisine">{CUISINE_LABEL[option.cuisine]}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
