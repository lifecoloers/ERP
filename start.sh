#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then echo "Node.js غير مثبت — ثبّته من https://nodejs.org"; exit 1; fi
echo "جارٍ تشغيل نظام ألوان الحياة للديكور... اترك هذه النافذة مفتوحة."
( sleep 2; (command -v open >/dev/null && open http://localhost:3000) || (command -v xdg-open >/dev/null && xdg-open http://localhost:3000) ) >/dev/null 2>&1 &
node server.js
