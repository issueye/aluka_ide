import { create } from "zustand";
import {
  getGitStatus,
  gitCheckout,
  gitCommit,
  gitCreateBranch,
  gitDiscard,
  gitInit,
  gitListBranches,
  gitPull,
  gitPush,
  gitStage,
  gitUnstage,
} from "./tauri";
import type { GitRepoStatus } from "./tauri";

interface GitStore {
  status: GitRepoStatus | null;
  loading: boolean;
  commitMessage: string;
  branches: string[];
  branchMenuOpen: boolean;
  setCommitMessage: (msg: string) => void;
  setBranchMenuOpen: (open: boolean) => void;
  refresh: (root: string) => Promise<void>;
  stage: (root: string, paths?: string[]) => Promise<void>;
  unstage: (root: string, paths?: string[]) => Promise<void>;
  discard: (root: string, paths: string[], isUntracked?: boolean) => Promise<void>;
  commit: (root: string) => Promise<boolean>;
  push: (root: string) => Promise<void>;
  pull: (root: string) => Promise<void>;
  loadBranches: (root: string) => Promise<void>;
  checkout: (root: string, branch: string) => Promise<void>;
  createBranch: (root: string, name: string) => Promise<void>;
  initRepo: (root: string) => Promise<void>;
}

export const useGitStore = create<GitStore>((set, get) => ({
  status: null,
  loading: false,
  commitMessage: "",
  branches: [],
  branchMenuOpen: false,

  setCommitMessage: (commitMessage) => set({ commitMessage }),
  setBranchMenuOpen: (branchMenuOpen) => set({ branchMenuOpen }),

  refresh: async (root) => {
    if (!root) return;
    try {
      const status = await getGitStatus(root);
      set({ status });
    } catch (e) {
      console.error("刷新 Git 状态失败:", e);
    }
  },

  stage: async (root, paths = []) => {
    set({ loading: true });
    try {
      await gitStage(root, paths);
      await get().refresh(root);
    } finally {
      set({ loading: false });
    }
  },

  unstage: async (root, paths = []) => {
    set({ loading: true });
    try {
      await gitUnstage(root, paths);
      await get().refresh(root);
    } finally {
      set({ loading: false });
    }
  },

  discard: async (root, paths, isUntracked = false) => {
    set({ loading: true });
    try {
      await gitDiscard(root, paths, isUntracked);
      await get().refresh(root);
    } finally {
      set({ loading: false });
    }
  },

  commit: async (root) => {
    const { commitMessage, status } = get();
    const msg = commitMessage.trim();
    if (!msg) return false;

    set({ loading: true });
    try {
      // 若暂存区为空，但工作区有改动，则提示或默认全量暂存再提交
      if (status && status.staged.length === 0 && status.unstaged.length > 0) {
        await gitStage(root, []);
      }
      await gitCommit(root, msg);
      set({ commitMessage: "" });
      await get().refresh(root);
      return true;
    } catch (e) {
      console.error("Git 提交失败:", e);
      return false;
    } finally {
      set({ loading: false });
    }
  },

  push: async (root) => {
    set({ loading: true });
    try {
      await gitPush(root);
      await get().refresh(root);
    } catch (e) {
      console.error("Git 推送失败:", e);
    } finally {
      set({ loading: false });
    }
  },

  pull: async (root) => {
    set({ loading: true });
    try {
      await gitPull(root);
      await get().refresh(root);
    } catch (e) {
      console.error("Git 拉取失败:", e);
    } finally {
      set({ loading: false });
    }
  },

  loadBranches: async (root) => {
    try {
      const branches = await gitListBranches(root);
      set({ branches });
    } catch (e) {
      console.error("获取分支列表失败:", e);
    }
  },

  checkout: async (root, branch) => {
    set({ loading: true, branchMenuOpen: false });
    try {
      await gitCheckout(root, branch);
      await get().refresh(root);
    } catch (e) {
      console.error("切换分支失败:", e);
    } finally {
      set({ loading: false });
    }
  },

  createBranch: async (root, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set({ loading: true, branchMenuOpen: false });
    try {
      await gitCreateBranch(root, trimmed);
      await get().refresh(root);
    } catch (e) {
      console.error("创建分支失败:", e);
    } finally {
      set({ loading: false });
    }
  },

  initRepo: async (root) => {
    set({ loading: true });
    try {
      await gitInit(root);
      await get().refresh(root);
    } catch (e) {
      console.error("初始化仓库失败:", e);
    } finally {
      set({ loading: false });
    }
  },
}));
