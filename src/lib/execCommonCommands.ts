/** 容器内交互 shell 常用指令（点击填入输入框，可再编辑后发送）。 */
export const EXEC_COMMON_COMMANDS: readonly string[] = [
  'ls -la',
  'pwd',
  'whoami',
  'id',
  'ps aux',
  'env | sort | head -40',
  'cat /etc/os-release',
  'df -h',
  'free -m',
  'uname -a',
  'ss -tuln',
  'find . -maxdepth 2 -type f 2>/dev/null | head -20',
  'cat /proc/1/cgroup 2>/dev/null | head -5',
]
