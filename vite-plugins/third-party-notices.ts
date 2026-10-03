import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin, Rollup } from 'vite';

/** A part of others in the built app, with its licence (About → Licences lists them). */
export interface Notice {
  name: string;
  version: string;
  /** SPDX identifier, as the part states it. */
  license: string;
  /** Where its source is. */
  url: string | null;
  /** What it is in the app, and what its licence asks for beyond the texts. */
  note?: string;
  /** The licence texts and notices. */
  texts: { file: string; text: string }[];
}

/** The package that `id` (a module of the build) belongs to, by the last node_modules in it. */
export function packageOf(id: string): { name: string; dir: string } | null {
  if (id.startsWith('\0')) return null;
  const path = id.split('?')[0]!.replaceAll('\\', '/');
  const at = path.lastIndexOf('/node_modules/');
  if (at < 0) return null;
  const rest = path.slice(at + '/node_modules/'.length).split('/');
  const name = rest[0]?.startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  if (!name || name.startsWith('.')) return null;
  return { name, dir: `${path.slice(0, at)}/node_modules/${name}` };
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)([.-].*)?$/i;

/** The notice of the package in `dir`: its name, version, licence and licence files. */
export function packageNotice(dir: string): Notice {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
    license?: string | { type?: string };
    repository?: string | { url?: string };
    homepage?: string;
  };
  const license =
    typeof manifest.license === 'string' ? manifest.license : (manifest.license?.type ?? '?');
  const repository =
    typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  const texts = readdirSync(dir)
    .filter((file) => LICENSE_FILE.test(file))
    .sort()
    .map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8').trim() }));
  return {
    name: manifest.name,
    version: manifest.version,
    license,
    url: sourceUrl(repository) ?? manifest.homepage ?? null,
    texts,
  };
}

/** A repository field as a link: "git+https://github.com/a/b.git" → "https://github.com/a/b". */
export function sourceUrl(repository: string | undefined): string | null {
  if (!repository) return null;
  const short = /^(?:github:)?([\w.-]+\/[\w.-]+)$/.exec(repository);
  if (short) return `https://github.com/${short[1]}`;
  return repository
    .replace(/^git\+/, '')
    .replace(/^(?:ssh:\/\/)?git@([^:/]+)[:/]/, 'https://$1/')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '');
}

/**
 * Where to get the source of a package whose licence asks for it (the MPL: of every file of it
 * in the app): its npm package of that version, which holds its source.
 */
export function sourceNote(notice: Notice): string | undefined {
  if (!notice.license.startsWith('MPL')) return undefined;
  return `Under the Mozilla Public License 2.0: its source code, as this app uses it, is in its npm package, https://www.npmjs.com/package/${notice.name}/v/${notice.version}.`;
}

/** The notices as plain text, for licenses.txt. */
export function noticesText(appName: string, notices: Notice[]): string {
  const parts = notices.map((notice) =>
    [
      `${notice.name} ${notice.version} (${notice.license})`,
      ...(notice.url ? [`Source: ${notice.url}`] : []),
      ...(notice.note ? ['', notice.note] : []),
      ...notice.texts.flatMap(({ file, text }) => ['', `--- ${file} ---`, '', text]),
    ].join('\n'),
  );
  const rule = `\n\n${'='.repeat(78)}\n\n`;
  return `${appName} contains these parts of others, under their own licences.${rule}${parts.join(rule)}\n`;
}

interface Options {
  /** The name of the app, at the top of licenses.txt. */
  appName: string;
  /** Packages whose code the build takes in a way it cannot see (a virtual module). */
  packages?: string[];
  /** Licence texts that a package does not ship: files to add to its notice. */
  texts?: Record<string, string[]>;
  /** Parts that are not packages of their own, such as code compiled into a package's WASM. */
  extra?: Notice[];
  /** Packages of our own, left out. */
  ours?: (name: string) => boolean;
}

/**
 * Lists the parts of others in the built app (About → Licences shows them): every package with
 * code in the main build or in a worker's build, with its licence files, and the `extra` parts.
 * The main build writes them to licenses.json and licenses.txt; the workers' builds are done by
 * then, as the main build makes them when it meets a worker.
 *
 * Returns the plugin of the main build, and a maker of the workers' plugins; they share what they
 * see.
 */
export function thirdPartyNotices(options: Options): { main: Plugin; worker: () => Plugin } {
  const dirs = new Map<string, string>();
  for (const name of options.packages ?? []) dirs.set(name, join('node_modules', name));
  const gather = (bundle: Rollup.OutputBundle) => {
    for (const output of Object.values(bundle)) {
      if (output.type !== 'chunk') continue;
      for (const id of output.moduleIds) {
        // A module of which nothing went into the chunk is not in the app (but CSS, which goes
        // to a file of its own).
        const rendered = output.modules[id]?.renderedLength ?? 0;
        if (rendered === 0 && !/\.css($|\?)/.test(id)) continue;
        const found = packageOf(id);
        if (found && !dirs.has(found.name)) dirs.set(found.name, found.dir);
      }
    }
  };
  const worker = (): Plugin => ({
    name: 'third-party-notices:worker',
    apply: 'build',
    generateBundle(_, bundle) {
      gather(bundle);
    },
  });
  const main: Plugin = {
    name: 'third-party-notices',
    apply: 'build',
    generateBundle(_, bundle) {
      gather(bundle);
      const notices = [...dirs.values()]
        .filter((dir) => existsSync(join(dir, 'package.json')))
        .map(packageNotice)
        .filter((notice) => !options.ours?.(notice.name))
        .map((notice): Notice => {
          const note = notice.note ?? sourceNote(notice);
          return {
            ...notice,
            ...(note ? { note } : {}),
            texts: [
              ...notice.texts,
              ...(options.texts?.[notice.name] ?? []).map((path) => ({
                file: path.split('/').at(-1)!,
                text: readFileSync(path, 'utf8').trim(),
              })),
            ],
          };
        })
        .concat(options.extra ?? [])
        .sort((a, b) => a.name.localeCompare(b.name, 'en'));
      const bare = notices.filter((notice) => notice.texts.length === 0).map(({ name }) => name);
      if (bare.length > 0) this.error(`No licence text for: ${bare.join(', ')}`);
      this.emitFile({ type: 'asset', fileName: 'licenses.json', source: JSON.stringify(notices) });
      this.emitFile({
        type: 'asset',
        fileName: 'licenses.txt',
        source: noticesText(options.appName, notices),
      });
    },
  };
  return { main, worker };
}
