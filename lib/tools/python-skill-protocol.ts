export interface PythonSnapshotPage {
  url: string;
  title: string;
  body: string;
}

export interface PythonSkillPackageRequest {
  type: 'python-skill:package';
  name: string;
  pages: PythonSnapshotPage[];
}

export type PythonSkillPackageResponse = { bytes: number[] } | { error: string };

export interface PythonSkillRunRequest {
  type: 'python-skill:run';
  id: string;
  code: string;
  argsJson: string;
}

export interface PythonSkillCancelRequest {
  type: 'python-skill:cancel';
  id: string;
}

export type PythonSkillRunResponse =
  | { resultJson: string; stdout: string; stderr: string }
  | { error: string };
