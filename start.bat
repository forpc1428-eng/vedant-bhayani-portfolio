@echo off
cd /d "%~dp0"
echo Black hole running at http://localhost:8090  - keep this window open.
start "" http://localhost:8090
where py >nul 2>nul && (py -m http.server 8090 & goto :eof)
where python >nul 2>nul && (python -m http.server 8090 & goto :eof)
where npx >nul 2>nul && (npx -y serve -l 8090 . & goto :eof)
echo Install Python from https://www.python.org/downloads/ (tick "Add to PATH"), then run this again.
pause
