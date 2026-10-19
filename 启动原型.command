#!/bin/zsh
cd -- "$(dirname "$0")"
if curl -fsS --max-time 2 http://127.0.0.1:4173/api/health >/dev/null 2>&1; then
  echo "已有原型窗口在运行。请先关闭旧的启动窗口，再重新双击本文件，这样新输入的 Key 才会生效。"
  read -r "reply?按回车关闭此窗口。"
  exit 1
fi
if [[ -z "$DEEPSEEK_API_KEY" ]]; then
  read -r -s "DEEPSEEK_API_KEY?请粘贴 DeepSeek API Key（直接回车进入演示模式）："
  echo
  export DEEPSEEK_API_KEY
fi
echo "正在启动文献辅助汇报工具…"
node server.mjs &
app_pid=$!
trap 'kill $app_pid 2>/dev/null' EXIT
for attempt in {1..30}; do
  if ! kill -0 $app_pid 2>/dev/null; then
    echo "启动失败，请查看上面的错误信息。"
    read -r "reply?按回车关闭此窗口。"
    exit 1
  fi
  if curl -fsS http://127.0.0.1:4173/api/health >/dev/null 2>&1; then break; fi
  sleep 0.2
done
if ! curl -fsS http://127.0.0.1:4173/api/health >/dev/null 2>&1; then
  echo "启动超时，请查看上面的错误信息。"
  read -r "reply?按回车关闭此窗口。"
  exit 1
fi
open http://127.0.0.1:4173
echo "浏览器已打开。关闭本窗口即可停止原型服务。"
wait $app_pid
