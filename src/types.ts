/** 资源管理器树节点（Rust `read_dir` 返回，单层懒加载） */
export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
}

/** 工作区文件变更事件（Rust `watch_workspace` 聚合后 emit） */
export interface WorkspaceChange {
  path: string;
  kind: "create" | "modify" | "remove" | "access" | "other";
}
