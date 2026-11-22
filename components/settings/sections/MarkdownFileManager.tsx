import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { Download, FilePlus, FolderDown, Pencil, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { FileTreeNodeActions } from '@/components/editor/FileTree';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { showConfirm } from '@/lib/ui/dialog';
import {
  getMarkdownConflicts, isMarkdownFilename, listMarkdownFilenames, readInstalledMarkdown,
  readMarkdownImports, resolveMarkdownImport, writeMarkdownExport, type ConflictChoice, type MarkdownFile,
} from '@/lib/ai-config/prompt-transfer';
import { FileWorkspace, type FileWorkspaceAction, type FileWorkspaceHandle } from './FileWorkspace';
import { encodeRelPath, normalizePath, vfs } from '@/lib/persistence/vfs';
import { settingsFilePanelWidth } from '@/lib/persistence/storage';
import type { SettingsOutletContext } from '@/components/settings/SettingsLayout';
import { t } from '@/lib/i18n';

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle>;
};

interface ImportRow {
  file: MarkdownFile;
  conflicts: MarkdownFile[];
  choice: ConflictChoice;
}

interface MarkdownFileManagerProps {
  section: 'prompts' | 'memory';
  directory: string;
  newFileTemplate: string;
  workspaceRef?: RefObject<FileWorkspaceHandle | null>;
}

export function MarkdownFileManager({ section, directory, newFileTemplate, workspaceRef }: MarkdownFileManagerProps) {
  const root = normalizePath(directory);
  const matchName = section === 'prompts';
  const { basePath, breakpoint } = useOutletContext<SettingsOutletContext>();
  const params = useParams();
  const navigate = useNavigate();
  const localWorkspace = useRef<FileWorkspaceHandle>(null);
  const workspace = workspaceRef ?? localWorkspace;
  const fileInput = useRef<HTMLInputElement>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null);
  const [importing, setImporting] = useState(false);
  const importBusy = useRef(false);
  useEffect(() => vfs.onChange((event) => {
    if (event.kind === 'write') return;
    const oldPath = event.kind === 'rename' ? event.oldPath : event.path;
    if (!oldPath.startsWith(root + '/')) return;
    const oldName = oldPath.slice(root.length + 1);
    const newName = event.kind === 'rename' && event.path.startsWith(root + '/')
      ? event.path.slice(root.length + 1) : '';
    setChecked((items) => items.flatMap((name) => name !== oldName
      ? [name] : isMarkdownFilename(newName) ? [newName] : []));
  }), [root]);

  // react-router v6 decodes splat params; fallback to '' means no file selected.
  const splat = params['*'] ?? '';
  const relativePath = splat || undefined;

  const handleSelect = useCallback((rel: string | null) => {
    if (rel) {
      navigate(`${basePath}/${section}/${encodeRelPath(rel)}`, { replace: true });
    } else {
      navigate(`${basePath}/${section}`, { replace: true });
    }
  }, [basePath, navigate, section]);

  const exportFiles = async (filenames?: readonly string[]) => {
    const zip = filenames?.length !== 1;
    const picker = window as SavePickerWindow;
    try {
      if (!picker.showSaveFilePicker) throw new Error('Save picker unavailable');
      const handle = await picker.showSaveFilePicker({
        suggestedName: zip ? (matchName ? 'cebian-prompts.zip' : 'cebian-memories.zip') : filenames[0],
        types: zip
          ? [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }]
          : [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
      });
      await writeMarkdownExport(root, filenames ?? await listMarkdownFilenames(root), handle, zip);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) toast.error(t(`settings.${section}.exportFailed`));
    }
  };

  const deleteFiles = async (filenames: readonly string[]) => {
    if (!filenames.length) return;
    const confirmed = await showConfirm({
      title: t(`settings.${section}.deleteConfirmTitle`, [String(filenames.length)]),
      description: filenames.join(', '),
      confirmText: t('common.delete'),
      destructive: true,
    });
    if (!confirmed) return;
    const results = await Promise.allSettled(filenames.map((name) => vfs.unlink(root + '/' + name)));
    const removed = new Set(filenames.filter((_, index) => results[index].status === 'fulfilled'));
    setChecked((items) => items.filter((name) => !removed.has(name)));
    if (relativePath && removed.has(relativePath)) handleSelect(null);
    workspace.current?.refresh();
    if (removed.size < filenames.length) toast.error(t(`settings.${section}.deleteFailed`));
  };

  const applyImport = async (rows: ImportRow[]) => {
    if (importBusy.current) return;
    importBusy.current = true;
    setImporting(true);
    let written = 0;
    try {
      const installed = await readInstalledMarkdown(root);
      for (const row of rows) {
        const current = getMarkdownConflicts(row.file, installed, matchName);
        // Overwrite only a conflict that was shown to the user.
        const choice = row.choice === 'overwrite' && current.some((file) => !row.conflicts.some((previous) => previous.filename === file.filename))
          ? 'skip' : row.choice;
        const resolved = resolveMarkdownImport(row.file, installed, choice, matchName);
        if (!resolved) continue;
        await vfs.writeFile(root + '/' + resolved.filename, resolved.content, 'utf8');
        const index = installed.findIndex(({ filename }) => filename === resolved.filename);
        if (index < 0) installed.push(resolved);
        else installed[index] = resolved;
        written++;
      }
      setImportRows(null);
      if (written) toast.success(t(`settings.${section}.imported`, [String(written)]));
    } catch {
      toast.error(t(`settings.${section}.importFailed`));
    } finally {
      if (written) workspace.current?.refresh();
      importBusy.current = false;
      setImporting(false);
    }
  };

  const prepareImport = async (files: File[]) => {
    if (importBusy.current) return;
    importBusy.current = true;
    setImporting(true);
    let rows: ImportRow[];
    try {
      const [incoming, installed] = await Promise.all([readMarkdownImports(files), readInstalledMarkdown(root)]);
      rows = incoming.map((file) => {
        const conflicts = getMarkdownConflicts(file, installed, matchName);
        installed.push(file);
        return { file, conflicts, choice: 'skip' };
      });
    } catch {
      toast.error(t(`settings.${section}.importFailed`));
      return;
    } finally {
      importBusy.current = false;
      setImporting(false);
    }
    if (rows.some(({ conflicts }) => conflicts.length)) setImportRows(rows);
    else await applyImport(rows);
  };

  const toolbarActions: FileWorkspaceAction[] = [
    { id: 'import-files', icon: Upload, label: t('settings.prompts.import'), disabled: importing, onSelect: () => fileInput.current?.click() },
    { id: 'export-files', icon: Download, label: t('settings.prompts.export'), disabled: !checked.length, onSelect: () => exportFiles(checked) },
    { id: 'export-all-files', icon: FolderDown, label: t('settings.prompts.exportAll'), onSelect: () => exportFiles() },
    { id: 'delete-files', icon: Trash2, label: t('common.delete'), disabled: !checked.length, destructive: true, onSelect: () => deleteFiles(checked) },
    { id: 'delete-all-files', icon: Trash2, label: t('settings.prompts.deleteAll'), destructive: true, onSelect: async () => deleteFiles(await listMarkdownFilenames(root)) },
  ];
  const nodeActions: FileTreeNodeActions = {
    trailing: (node) => node.level === 0 && node.isLeaf && isMarkdownFilename(node.data.name) ? (
      <Checkbox aria-label={t('common.select') + ' ' + node.data.name} checked={checked.includes(node.data.name)}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onCheckedChange={(value) => setChecked((names) => value === true
          ? [...new Set([...names, node.data.name])] : names.filter((name) => name !== node.data.name))}
      />
    ) : null,
    contextMenu: (node, tree) => {
      const isMarkdown = node?.level === 0 && node.isLeaf && isMarkdownFilename(node.data.name);
      const targets = checked.length ? checked : isMarkdown && node ? [node.data.name] : [];
      return (
        <>
          <ContextMenuItem onSelect={() => tree?.createFile(root, newFileTemplate)}>
            <FilePlus className="size-3.5 mr-2" /> {t(matchName ? 'settings.prompts.newPrompt' : 'settings.memory.newMemory')}
          </ContextMenuItem>
          <ContextMenuItem disabled={!targets.length} onSelect={() => void exportFiles(targets)}>
            <Download className="size-3.5 mr-2" /> {t('settings.prompts.export')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={!isMarkdown} onSelect={() => node?.edit()}>
            <Pencil className="size-3.5 mr-2" /> {t('common.rename')}
          </ContextMenuItem>
          <ContextMenuItem disabled={!targets.length} onSelect={() => void deleteFiles(targets)} className="text-destructive focus:text-destructive">
            <Trash2 className="size-3.5 mr-2" /> {t('common.delete')}
          </ContextMenuItem>
        </>
      );
    },
  };

  return (
    <>
      {checked.length > 0 && (
        <div className="flex items-center justify-between border-b px-3 py-1 text-sm text-muted-foreground">
          <span>{t('settings.prompts.selected', [String(checked.length)])}</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => setChecked([])}>{t('settings.prompts.clearSelection')}</Button>
        </div>
      )}
      <input ref={fileInput} type="file" multiple accept=".md,.zip,text/markdown,application/zip" className="hidden" onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (files.length) void prepareImport(files);
      }} />
      <FileWorkspace
        ref={workspace}
        toolbarActions={toolbarActions}
        toolbarActionsInOverflow
        nodeActions={nodeActions}
        root={directory}
        relativePath={relativePath}
        onSelectRelative={handleSelect}
        newFileTemplate={newFileTemplate}
        templateVarScene={matchName ? 'prompts' : undefined}
        panelWidthStorage={settingsFilePanelWidth}
        compactMode={breakpoint === 'compact'}
        className="flex-1"
      />
      <Dialog open={importRows !== null} onOpenChange={(open) => { if (!open && !importing) setImportRows(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(`settings.${section}.importConflicts`)}</DialogTitle>
            <DialogDescription>{t(`settings.${section}.conflictHint`)}</DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {importRows?.map((row, index) => row.conflicts.length ? (
              <label key={index} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                <span className="min-w-0 break-all">
                  <span className="block font-medium">{row.file.filename}{matchName && ' · /' + row.file.name}</span>
                  <span className="block text-xs text-muted-foreground">{row.conflicts.map((file) => matchName ? file.filename + ' · /' + file.name : file.filename).join(', ')}</span>
                </span>
                <select value={row.choice} disabled={importing} className="rounded border bg-background px-2 py-1"
                  onChange={(event) => {
                    const choice = event.target.value as ConflictChoice;
                    setImportRows((rows) => rows?.map((item, i) => i === index ? { ...item, choice } : item) ?? null);
                  }}>
                  <option value="skip">{t('settings.prompts.skip')}</option>
                  <option value="overwrite" disabled={new Set(row.conflicts.map(({ filename }) => filename.toLowerCase())).size > 1}>{t('settings.prompts.overwrite')}</option>
                  <option value="rename">{t('settings.prompts.renameImport')}</option>
                </select>
              </label>
            ) : null)}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={importing} onClick={() => setImportRows(null)}>{t('common.cancel')}</Button>
            <Button type="button" disabled={importing} onClick={() => { if (importRows) void applyImport(importRows); }}>{t('settings.prompts.import')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
