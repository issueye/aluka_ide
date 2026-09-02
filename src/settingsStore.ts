import { create } from "zustand";
import { getSettings, setSettings, type UserSettings } from "./tauri";
import { applyTheme, allThemes, getTheme } from "./theme";

/**
 * 用户设置（M4 / FR-12）。
 * 持久化：Tauri 端写 ~/.aluka-ide/settings.json；
 * 纯浏览器 dev 无后端时降级 localStorage 镜像，保证离线/开发双通。
 */
export interface Settings extends UserSettings {}

const DEFAULTS: Settings = { theme: "dark-plus", fontSize: 14, autoSave: "off" };
const LS_KEY = "aluka.settings";

interface SettingsStore extends Settings {
  loaded: boolean;
  update: (patch: Partial<Settings>) => void;
}

function snapshot(s: Settings): Settings {
  return { theme: s.theme, fontSize: s.fontSize, autoSave: s.autoSave };
}

/** 双写：localStorage 镜像（秒开兜底）+ 后端 settings.json */
function persist(s: Settings): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    /* 忽略 */
  }
  void setSettings(snapshot(s)).catch((e) => console.error("写入 settings.json 失败:", e));
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...DEFAULTS,
  loaded: false,
  update: (patch) => {
    set(patch);
    if (patch.theme) applyTheme(getTheme(patch.theme));
    persist(snapshot(get()));
  },
}));

/**
 * 启动加载：优先 Tauri settings.json → 回退 localStorage → 回退默认。
 * 应用主题后回填 store；在挂载前 await，确保首帧即正确主题。
 */
export async function loadSettings(): Promise<void> {
  let s: Settings | null = null;
  try {
    const remote = await getSettings();
    if (remote) s = { ...DEFAULTS, ...remote };
  } catch {
    /* 无后端环境 */
  }
  if (!s) {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) s = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
    } catch {
      /* 忽略坏数据 */
    }
  }
  const final: Settings = s ?? DEFAULTS;
  applyTheme(getTheme(final.theme));
  useSettingsStore.setState({ ...final, loaded: true });
}

/** 主题选项（命令面板 / 主题切换命令用）：内置 + 扩展主题 */
export function themeOptions(): { id: string; label: string }[] {
  return allThemes().map((t) => ({ id: t.id, label: t.label }));
}
