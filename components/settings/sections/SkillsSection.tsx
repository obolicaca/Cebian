import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { Blocks, Download, FilePlus, FolderDown, FolderPlus, Pencil, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import {
  FileWorkspace,
  type FileWorkspaceAction, type FileWorkspaceHandle,
} from './FileWorkspace';
import { encodeRelPath } from '@/lib/persistence/vfs';
import { CEBIAN_SKILLS_DIR, SKILL_ENTRY_FILE } from '@/lib/persistence/vfs-paths';
import { settingsFilePanelWidth } from '@/lib/persistence/storage';
import { createSkillTemplate } from '@/lib/ai-config/skill-creator';
import {
  exportSkillPackage,
  exportAllSkillsPackage,
  inspectSkillPackage,
  SkillPackageError,
  type SkillImportResult,
} from '@/lib/ai-config/skill-transfer';
import { showConfirm, showDialog } from '@/lib/ui/dialog';
import { vfs, normalizePath } from '@/lib/persistence/vfs';
import { Checkbox } from '@/components/ui/checkbox';
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu';
import type { FileTreeNodeActions } from '@/components/editor/FileTree';
import type { SettingsOutletContext } from '@/components/settings/SettingsLayout';
import { t } from '@/lib/i18n';

/**
 * SkillsSection — multi-file agent skill manager under /settings/skills[/*].
 *
 * Supports nested paths (e.g. `my-skill/scripts/foo.js`). Edits and imports
 * go through `vfs.writeFile`, which broadcasts change events across
 * extension contexts so the background scanner's cached skill index is
 * invalidated automatically — no manual notification needed.
 *
 * Contributes four toolbar actions: create, import, export current, export
 * all. The domain scaffolding lives in `lib/ai-config/skill-creator.ts` and
 * `lib/ai-config/skill-transfer.ts` so `FileWorkspace` stays free of any
 * business concepts.
 */
export function SkillsSection() {
  const { basePath, breakpoint } = useOutletContext<SettingsOutletContext>();
  const params = useParams();
  const navigate = useNavigate();
  const workspaceRef = useRef<FileWorkspaceHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [checkedFolders, setCheckedFolders] = useState<string[]>([]);
  const skillsRoot = normalizePath(CEBIAN_SKILLS_DIR);
  const selectedSkillNames = useMemo(() => checkedFolders.map((path) => path.slice(skillsRoot.length + 1)), [checkedFolders, skillsRoot]);
  const canExportSelection = selectedSkillNames.length > 0 && selectedSkillNames.every((name) => !name.includes('/'));
  const splat = params['*'] ?? '';
  const relativePath = splat || undefined;

  const handleSelect = useCallback((rel: string | null) => {
    if (rel) {
      navigate(`${basePath}/skills/${encodeRelPath(rel)}`, { replace: true });
    } else {
      navigate(`${basePath}/skills`, { replace: true });
    }
  }, [basePath, navigate]);

  const handleCreateSkill = useCallback(async () => {
    const { entryFile } = await createSkillTemplate(CEBIAN_SKILLS_DIR);
    workspaceRef.current?.refresh();
    workspaceRef.current?.selectAbs(entryFile);
  }, []);

  // ─── Import / Export ──────────────────────────────────────────────

  /** Localized message for a SkillPackageError, falling back to the raw
   *  message for non-domain errors. WXT generates separate overloads for
   *  keys with vs without `$N` placeholders, so we dispatch by the code's
   *  shape rather than passing one variable to a single `t()` call. */
  const formatError = useCallback((err: unknown): string => {
    if (err instanceof SkillPackageError) {
      const arg = err.arg ?? '';
      switch (err.code) {
        case 'invalid':           return t('errors.skillPackage.invalid');
        case 'tooLarge':          return t('errors.skillPackage.tooLarge');
        case 'tooManyFiles':      return t('errors.skillPackage.tooManyFiles');
        case 'missingEntry':      return t('errors.skillPackage.missingEntry');
        case 'parseFrontmatter':  return t('errors.skillPackage.parseFrontmatter');
        case 'unsafePath':            return t('errors.skillPackage.unsafePath', [arg]);
        case 'unsupportedPermission': return t('errors.skillPackage.unsupportedPermission', [arg]);
        case 'invalidName':           return t('errors.skillPackage.invalidName', [arg]);
        case 'reservedName':          return t('errors.skillPackage.reservedName', [arg]);
      }
    }
    return err instanceof Error ? err.message : String(err);
  }, []);

  const exportSkills = useCallback(async (names?: readonly string[], single?: string) => {
    try {
      const pickerWindow = window as Window & {
        showSaveFilePicker?: (options: {
          suggestedName: string;
          types: { description: string; accept: Record<string, string[]> }[];
        }) => Promise<FileSystemFileHandle>;
      };
      if (!pickerWindow.showSaveFilePicker) throw new Error('Save picker is unavailable');
      const date = new Date().toISOString().slice(0, 10);
      const handle = await pickerWindow.showSaveFilePicker({
        suggestedName: single ? `${single}.cebian-skill.zip` : `cebian-skills-${names ? 'selected' : 'backup'}-${date}.zip`,
        types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }],
      });
      const { blob, count } = single
        ? { blob: await exportSkillPackage(`${normalizePath(CEBIAN_SKILLS_DIR)}/${single}`), count: 1 }
        : await exportAllSkillsPackage(names);
      await blob.stream().pipeTo(await handle.createWritable());
      toast.success(single ? t('settings.skills.exportSuccess', [single]) : t('settings.skills.exportAllSuccess', count));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (!names && !single && err instanceof SkillPackageError && err.code === 'missingEntry') {
        toast(t('settings.skills.exportEmpty'));
        return;
      }
      toast.error(formatError(err));
    }
  }, [formatError]);

  const deletePaths = useCallback(async (paths: string[]) => {
    if (!paths.length) return;
    paths = paths.filter((path) => !paths.some((parent) => path.startsWith(parent + '/')));
    const names = paths.map((path) => path.split('/').at(-1) ?? path);
    const confirmed = await showConfirm({
      title: t('settings.skills.confirmDeleteTitle'),
      description: t('settings.skills.confirmDeleteDescription', [names.join(', ')]),
      confirmText: t('common.delete'),
      destructive: true,
    });
    if (!confirmed) return;
    const deleted: string[] = [];
    for (const path of paths) {
      try {
        const stat = await vfs.stat(path);
        if (stat.isDirectory()) await vfs.rm(path, { recursive: true });
        else await vfs.unlink(path);
        deleted.push(path);
      } catch (error) {
        toast.error(formatError(error));
      }
    }
    const root = normalizePath(CEBIAN_SKILLS_DIR);
    setCheckedFolders((current) => current.filter((path) => !deleted.some((parent) => path === parent || path.startsWith(parent + '/'))));
    if (relativePath && deleted.some((path) => root + '/' + relativePath === path || (root + '/' + relativePath).startsWith(path + '/'))) {
      handleSelect(null);
    }
    workspaceRef.current?.refresh();
  }, [formatError, handleSelect, relativePath]);

  const deleteAllSkills = useCallback(async () => {
    try {
      const root = normalizePath(CEBIAN_SKILLS_DIR);
      const names = await vfs.readdir(root);
      const candidates = await Promise.all(names.map(async (name) => {
        const path = root + '/' + name;
        const entry = await vfs.stat(path + '/' + SKILL_ENTRY_FILE).catch(() => null);
        return entry && !entry.isDirectory() ? path : null;
      }));
      await deletePaths(candidates.filter((path) => path !== null));
    } catch (error) {
      toast.error(formatError(error));
    }
  }, [deletePaths, formatError]);

  const nodeActions: FileTreeNodeActions = {
    trailing: (node) => node.isInternal ? (
      <Checkbox
        aria-label={t('common.select') + ' ' + node.data.name}
        checked={checkedFolders.includes(normalizePath(node.id))}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onCheckedChange={(checked) => setCheckedFolders((previous) => checked === true
          ? [...new Set([...previous, normalizePath(node.id)])]
          : previous.filter((path) => path !== normalizePath(node.id)))}
      />
    ) : null,
    contextMenu: (node, tree) => {
      const root = normalizePath(CEBIAN_SKILLS_DIR);
      const isSkill = node?.level === 0 && node.isInternal && node.data.children?.some((child) => child.name === SKILL_ENTRY_FILE);
      const parent = node?.isInternal ? node.id : root;
      const targets = checkedFolders.length ? checkedFolders : node ? [normalizePath(node.id)] : [];
      return (
        <>
          <ContextMenuItem disabled={checkedFolders.length ? !canExportSelection : !isSkill} onSelect={() => {
            if (checkedFolders.length) void exportSkills(selectedSkillNames);
            else if (isSkill && node) void exportSkills(undefined, node.data.name);
          }}>
            <Download className="size-3.5 mr-2" /> {t('settings.skills.exportCurrent')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => tree?.createFile(parent)}>
            <FilePlus className="size-3.5 mr-2" /> {t('common.newFile')}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => tree?.createFolder(parent)}>
            <FolderPlus className="size-3.5 mr-2" /> {t('common.newFolder')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={!node} onSelect={() => node?.edit()}>
            <Pencil className="size-3.5 mr-2" /> {t('common.rename')}
          </ContextMenuItem>
          <ContextMenuItem disabled={!targets.length} onSelect={() => void deletePaths(targets)} className="text-destructive focus:text-destructive">
            <Trash2 className="size-3.5 mr-2" /> {t('common.delete')}
          </ContextMenuItem>
        </>
      );
    },
  };

  /** Caller for the import preview dialog. Refreshes the file tree and
   *  shows a localized success toast based on package type. The scanner's
   *  cached skill index is invalidated automatically via the vfs change
   *  events emitted by the underlying writes — no manual notification
   *  needed. */
  const handleImported = useCallback((result: SkillImportResult) => {
    workspaceRef.current?.refresh();
    if (result.installed.length === 1) {
      toast.success(t('settings.skills.importSuccess', [result.installed[0].targetDirName]));
    } else {
      toast.success(t('settings.skills.importSuccessBackup', result.installed.length));
    }
  }, []);

  const handleImportFile = useCallback(async (file: File) => {
    try {
      const preview = await inspectSkillPackage(file);
      showDialog('skill-import-preview', {
        blob: file,
        preview,
        onImported: handleImported,
        onError: (err) => toast.error(formatError(err)),
      });
    } catch (err) {
      toast.error(formatError(err));
    }
  }, [formatError, handleImported]);

  const handleImportClick = useCallback(() => {
    // Reset the input so re-picking the same file still fires onChange.
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleImportFile(file);
  }, [handleImportFile]);

  const toolbarActions = useMemo<FileWorkspaceAction[]>(() => [
    {
      id: 'new-skill',
      icon: Blocks,
      label: t('settings.skills.create'),
      separatorBefore: true,
      onSelect: handleCreateSkill,
    },
    {
      id: 'import-skill',
      icon: Upload,
      label: t('settings.skills.import'),
      onSelect: handleImportClick,
    },
    {
      id: 'export-current-skill',
      icon: Download,
      label: t('settings.skills.exportCurrent'),
      disabled: !canExportSelection,
      onSelect: () => exportSkills(selectedSkillNames),
    },
    {
      id: 'export-all-skills',
      icon: FolderDown,
      label: t('settings.skills.exportAll'),
      onSelect: () => exportSkills(),
    },
    {
      id: 'delete-selected-skills',
      icon: Trash2,
      label: t('common.delete'),
      disabled: checkedFolders.length === 0,
      destructive: true,
      onSelect: () => deletePaths(checkedFolders),
    },
    {
      id: 'delete-all-skills',
      icon: Trash2,
      label: t('settings.skills.deleteAll'),
      destructive: true,
      onSelect: deleteAllSkills,
    },
  ], [handleCreateSkill, handleImportClick, exportSkills, selectedSkillNames, canExportSelection, checkedFolders, deletePaths, deleteAllSkills]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-6 pt-6 pb-4 shrink-0 border-b border-border">
        <h2 className="text-base font-semibold">{t('settings.skills.title')}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t('settings.skills.hint')}
        </p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,application/zip"
        onChange={handleFileInputChange}
        className="hidden"
        aria-hidden
      />
      <FileWorkspace
        ref={workspaceRef}
        root={CEBIAN_SKILLS_DIR}
        relativePath={relativePath}
        onSelectRelative={handleSelect}
        allowNewFolder
        panelWidthStorage={settingsFilePanelWidth}
        compactMode={breakpoint === 'compact'}
        className="flex-1"
        toolbarActions={toolbarActions}
        nodeActions={nodeActions}
      />
    </div>
  );
}

