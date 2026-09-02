import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// StrictMode 与 Monaco 单例服务存在兼容性冲突（M4 实证修复）：双挂载会让
// editor.create 的主 DOM 丢失。dev-only 严格检查损失为已知取舍。
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
