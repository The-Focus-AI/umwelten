#!/bin/bash
# Memory logger — samples every 60s.
# Uses pgrep to find actual model-hosting processes (not shell wrappers),
# then ps -o rss= to read their sizes.

while true; do
  ts=$(date +"%H:%M:%S")

  # System memory
  read free_gb active_gb wired_gb <<<$(vm_stat | awk '
    /page size/ { gsub(/[^0-9]/,"",$8); ps=$8 }
    /Pages free/ { gsub(/[^0-9]/,"",$3); free=$3 }
    /Pages active/ { gsub(/[^0-9]/,"",$3); active=$3 }
    /Pages wired/ { gsub(/[^0-9]/,"",$4); wired=$4 }
    END { printf "%.1f %.1f %.1f", free*ps/1024/1024/1024, active*ps/1024/1024/1024, wired*ps/1024/1024/1024 }
  ')
  swap_gb=$(sysctl -n vm.swapusage | awk '{gsub(/M/,"",$6); printf "%.1f", $6/1024}')

  # Model-hosting processes (not shell wrappers)
  # llama-swap child: /opt/homebrew/bin/llama-server -m ...
  # LlamaBarn child:  /Applications/LlamaBarn.app/.../llama-server --host 127.0.0.1 ... --model
  # Ollama runner:    /Applications/Ollama.app/.../ollama runner --ollama-engine ...
  procs=""
  total_kb=0

  # llama-swap
  for pid in $(pgrep -f "^[^ ]*/llama-server -m "); do
    rss=$(ps -o rss= -p $pid 2>/dev/null | tr -d ' ')
    [ -z "$rss" ] && continue
    total_kb=$((total_kb + rss))
    gb=$(awk "BEGIN {printf \"%.1f\", $rss/1024/1024}")
    procs="${procs:+$procs,}lsw:$pid:${gb}G"
  done

  # LlamaBarn
  for pid in $(pgrep -f "LlamaBarn.app/Contents/MacOS/llama-cpp/llama-server --host 127.0.0.1"); do
    rss=$(ps -o rss= -p $pid 2>/dev/null | tr -d ' ')
    [ -z "$rss" ] && continue
    total_kb=$((total_kb + rss))
    gb=$(awk "BEGIN {printf \"%.1f\", $rss/1024/1024}")
    procs="${procs:+$procs,}lb:$pid:${gb}G"
  done

  # Ollama
  for pid in $(pgrep -f "ollama runner --ollama-engine"); do
    rss=$(ps -o rss= -p $pid 2>/dev/null | tr -d ' ')
    [ -z "$rss" ] && continue
    total_kb=$((total_kb + rss))
    gb=$(awk "BEGIN {printf \"%.1f\", $rss/1024/1024}")
    procs="${procs:+$procs,}ol:$pid:${gb}G"
  done

  total_gb=$(awk "BEGIN {printf \"%.1f\", $total_kb/1024/1024}")

  echo "$ts | free=${free_gb}G active=${active_gb}G wired=${wired_gb}G swap=${swap_gb}G | models=${total_gb}G | ${procs:-(none)}"
  sleep 60
done
