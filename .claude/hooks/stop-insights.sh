#!/usr/bin/env bash
data=$(cat)
sid=$(node -e "
try {
  const d = JSON.parse(process.argv[1]);
  process.stdout.write(String(d.session_id || 'x').slice(0,36));
} catch(e) {
  process.stdout.write('x');
}
" "$data" 2>/dev/null || echo x)
sid=$(echo "$sid" | tr -dc 'a-zA-Z0-9-'); sid=${sid:-x}
sentinel="/tmp/cc-ins-${sid}"
if [ ! -f "$sentinel" ]; then
    touch "$sentinel"
    node -e "
process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'Stop',additionalContext:'Run /engineering-insights now to capture discoveries from this session into the relevant insights.md files.'}}));
"
fi
