/** 资源管理器树节点（Rust `read_dir` 返回，单层懒加载） */
export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
}
