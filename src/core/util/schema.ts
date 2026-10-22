import * as v from 'valibot';

/**
 * The building blocks of the schemas of what is stored (settings, presets, the details of
 * tracks): each value with its check and its default, so that the type, the defaults and the
 * check of a stored thing come from one place. Whatever was stored (by an older version, by
 * hand, or broken) is read as far as it is valid: a value that is missing or invalid takes its
 * default, numbers are clamped to their range, and keys nobody knows are dropped.
 */

/** A number in `[min, max]` (clamped, rounded where `integer`), or `fallback`. */
export function clamped(fallback: number, min: number, max: number, integer = false) {
  return v.fallback(
    v.pipe(
      v.number(),
      v.finite(),
      v.transform((value) => {
        const inRange = Math.min(max, Math.max(min, value));
        return integer ? Math.round(inRange) : inRange;
      }),
    ),
    fallback,
  );
}

/** One of `options`, or `fallback`. */
export function oneOf<const T extends readonly (string | number)[]>(
  options: T,
  fallback: T[number],
) {
  return v.fallback(v.picklist(options), fallback);
}

export function flag(fallback: boolean) {
  return v.fallback(v.boolean(), fallback);
}

export function text(fallback: string) {
  return v.fallback(v.string(), fallback);
}

/** A string trimmed and cut to `maxLength`; an empty one, or none, gives `fallback`. */
export function trimmedText(fallback: string, maxLength: number) {
  return v.fallback(
    v.pipe(
      v.string(),
      v.transform((value) => value.trim().slice(0, maxLength)),
      v.minLength(1),
    ),
    fallback,
  );
}

/** A list of strings, each once (anything else in it dropped); anything but a list gives none. */
export function uniqueTexts() {
  return v.fallback(
    v.pipe(
      v.array(v.unknown()),
      v.transform((list) => [
        ...new Set(list.filter((item): item is string => typeof item === 'string')),
      ]),
    ),
    (): string[] => [],
  );
}

const COLOR = /^#[0-9a-f]{6}$/i;

/** A value of `schema`, or null: for none, and for anything else. */
export function orNone<S extends v.GenericSchema>(schema: S) {
  return v.fallback(v.nullable(schema), null);
}

/** A colour as `#rrggbb`, or `fallback`. */
export function color(fallback: string) {
  return v.fallback(v.pipe(v.string(), v.regex(COLOR)), fallback);
}

/** Exactly `count` colours as `#rrggbb` (anything else in the list dropped), or `fallback`. */
export function colorList(count: number, fallback: () => string[]) {
  return v.fallback(
    v.pipe(
      v.array(v.unknown()),
      v.transform((list) =>
        list.filter((item): item is string => typeof item === 'string' && COLOR.test(item)),
      ),
      v.length(count),
    ),
    fallback,
  );
}

/**
 * Whatever `read` makes of the value, also of none: for a value with a check of its own. (A
 * missing key would fail the whole record without the fallback.)
 */
export function readWith<T>(read: (value: unknown) => T) {
  return v.fallback(v.pipe(v.unknown(), v.transform(read)), () => read(undefined));
}

/**
 * An object of `entries`, each read with its own check and default; anything but an object
 * gives all the defaults. Each read makes a new object, so a result can be changed freely.
 */
export function record<const E extends v.ObjectEntries>(entries: E) {
  const schema = v.object(entries);
  return v.fallback(schema, () => v.parse(schema, {}));
}

/** Reads `value` with `schema`: never throws, as each part has its default. */
export function sanitize<S extends v.GenericSchema>(schema: S, value: unknown): v.InferOutput<S> {
  return v.parse(schema, value);
}

/** The defaults of `schema`: what reading nothing gives. */
export function defaults<S extends v.GenericSchema>(schema: S): v.InferOutput<S> {
  return v.parse(schema, undefined);
}

/** The type of what `schema` reads. */
export type Infer<S extends v.GenericSchema> = v.InferOutput<S>;
