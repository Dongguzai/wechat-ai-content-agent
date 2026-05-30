export interface RunArchiveEntry {
  sourcePath: string;
  archivedPath: string;
  relativePath: string;
  kind: "file" | "directory";
}

export interface RunArchiveManifest {
  version: 1;
  archivedAt: string;
  sourceOutputDir: string;
  archiveDir: string;
  entries: RunArchiveEntry[];
  missing: string[];
}

export interface RunArchiveResult {
  archiveDir: string;
  manifestPath: string;
  entries: RunArchiveEntry[];
  missing: string[];
  archivedAt: string;
}
