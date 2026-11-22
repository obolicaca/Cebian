import { strToU8, unzipSync, zipSync } from 'fflate';
import { parseFrontmatter, serializeFrontmatter } from '@/lib/content/frontmatter';
import { vfs } from '@/lib/persistence/vfs';

export interface MarkdownFile {
  filename: string;
  name: string;
  content: string;
}

export type ConflictChoice = 'skip' | 'overwrite' | 'rename';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 500;
const key = (value: string) => value.toLowerCase();

export function isMarkdownFilename(filename: string): boolean {
  return /^[^/\\<>:"|?*\u0000-\u001f]+\.md$/i.test(filename) && !filename.startsWith('.');
}

function readMarkdown(filename: string, content: string): MarkdownFile {
  if (!isMarkdownFilename(filename)) throw new Error(filename);
  const normalized = filename.replace(/\.md$/i, '.md');
  const { data } = parseFrontmatter(content);
  return { filename: normalized, name: typeof data?.name === 'string' ? data.name : normalized.slice(0, -3), content };
}

export async function readMarkdownImports(files: readonly File[]): Promise<MarkdownFile[]> {
  const result: MarkdownFile[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let count = 0;
  const reserve = (size: number) => {
    bytes += size;
    count++;
    if (bytes > MAX_BYTES || count > MAX_FILES) throw new Error('Import limit exceeded');
  };
  if (files.reduce((total, file) => total + file.size, 0) > MAX_BYTES) throw new Error('Import limit exceeded');
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      const archive = unzipSync(new Uint8Array(await file.arrayBuffer()), {
        filter: ({ name, originalSize }) => {
          if (!isMarkdownFilename(name)) throw new Error(name);
          reserve(originalSize);
          return true;
        },
      });
      for (const [filename, data] of Object.entries(archive)) result.push(readMarkdown(filename, decoder.decode(data)));
    } else {
      reserve(file.size);
      result.push(readMarkdown(file.name, decoder.decode(await file.arrayBuffer())));
    }
  }
  if (!result.length) throw new Error('No Markdown files');
  return result;
}

export async function listMarkdownFilenames(root: string): Promise<string[]> {
  const entries = await vfs.readdir(root).catch(() => []);
  const files = await Promise.all(entries.filter(isMarkdownFilename).map(async (name) => {
    const stat = await vfs.stat(root + '/' + name).catch(() => null);
    return stat?.isFile() ? name : null;
  }));
  return files.filter((name) => name !== null).sort();
}

async function readMarkdownText(root: string, filename: string): Promise<string> {
  const raw = await vfs.readFile(root + '/' + filename, 'utf8');
  return typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
}

export async function readInstalledMarkdown(root: string): Promise<MarkdownFile[]> {
  return Promise.all((await listMarkdownFilenames(root)).map(async (filename) => {
    const content = await readMarkdownText(root, filename);
    try { return { ...readMarkdown(filename, content), filename }; }
    catch { return { filename, name: filename.slice(0, -3), content }; }
  }));
}

export function getMarkdownConflicts(incoming: MarkdownFile, files: readonly MarkdownFile[], matchName: boolean): MarkdownFile[] {
  return files.filter((file) => key(file.filename) === key(incoming.filename) || (matchName && key(file.name) === key(incoming.name)));
}

export function resolveMarkdownImport(incoming: MarkdownFile, files: readonly MarkdownFile[], choice: ConflictChoice, matchName: boolean): MarkdownFile | undefined {
  const conflicts = getMarkdownConflicts(incoming, files, matchName);
  if (!conflicts.length) return incoming;
  if (choice === 'skip') return;
  if (choice === 'overwrite') {
    return conflicts.length === 1 ? { ...incoming, filename: conflicts[0].filename } : undefined;
  }
  const stem = incoming.filename.slice(0, -3);
  const names = new Set(files.map((file) => key(file.name)));
  const filenames = new Set(files.map((file) => key(file.filename)));
  let suffix = 2;
  while ((matchName && names.has(key(`${incoming.name}-${suffix}`))) || filenames.has(key(`${stem}-${suffix}.md`))) suffix++;
  const filename = `${stem}-${suffix}.md`;
  if (!matchName) return { ...incoming, filename };
  const name = `${incoming.name}-${suffix}`;
  const { data, body } = parseFrontmatter(incoming.content);
  return { filename, name, content: serializeFrontmatter({ ...data, name }, body) };
}

export async function writeMarkdownExport(root: string, filenames: readonly string[], handle: FileSystemFileHandle, zip: boolean) {
  const files = await Promise.all(filenames.map(async (filename) => {
    if (!isMarkdownFilename(filename)) throw new Error(filename);
    const content = await readMarkdownText(root, filename);
    return [filename, content] as const;
  }));
  if (!files.length) return;
  const blob = zip
    ? new Blob([zipSync(Object.fromEntries(files.map(([name, text]) => [name, strToU8(text)]))) as BlobPart], { type: 'application/zip' })
    : new Blob([files[0][1]], { type: 'text/markdown;charset=utf-8' });
  await blob.stream().pipeTo(await handle.createWritable());
}
