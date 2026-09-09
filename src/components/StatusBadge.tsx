/** Git 文件状态徽标（SCM 视图与提交记录视图共用）：M/A/D/U/R 彩色状态字母 */
export default function StatusBadge({ status, staged }: { status: string; staged: boolean }) {
  let color = "text-[var(--aluka-text-dim)]";
  if (status === "M") color = staged ? "text-[#89d185]" : "text-[#e2c08d]";
  else if (status === "A" || status === "U") color = "text-[#73c991]";
  else if (status === "D") color = "text-[#f14c4c]";
  else if (status === "R") color = "text-[#3b8eea]";

  return <span className={`font-mono text-[11px] font-semibold ${color}`}>{status}</span>;
}
