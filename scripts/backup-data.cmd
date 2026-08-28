@echo off
rem ============================================================
rem  Nightly wrapper for scripts/backup-data.mjs
rem ============================================================
rem  Companion to backup-storage.cmd. That one copies the FILES; this one
rem  copies the DATA, which until now existed nowhere outside Supabase.
rem
rem  Task Scheduler does not capture a program's output, so a task that fails
rem  every night looks exactly like one that works. This writes everything to
rem  backups\logs\data-YYYY-MM-DD.log and passes the exit code back, so the
rem  task's Last Run Result is the truth and the log says why.
rem
rem  Also runnable by hand:  scripts\backup-data.cmd
rem ============================================================
setlocal

rem UTF-8 console, or the script's output lands in the log as mojibake.
chcp 65001 >nul

set "ROOT=%~dp0.."
set "LOGDIR=%ROOT%\backups\logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

rem Locale-proof date. %DATE% formats differ per machine and would produce
rem log files called things like data-18/08/2026.log, which cannot exist.
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%i"
set "LOG=%LOGDIR%\data-%TODAY%.log"

set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"

echo. >> "%LOG%"
echo ============================================================ >> "%LOG%"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format o"') do echo Started %%i >> "%LOG%"

rem Arguments pass straight through, so the scheduled task can name a
rem destination:  backup-data.cmd \\192.168.20.5\data\PCPrime-Backups\data
rem The log stays on this machine deliberately — if the destination is
rem unreachable, the explanation has to land somewhere that still works.
pushd "%ROOT%"
"%NODE%" scripts\backup-data.mjs %* >> "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
popd

echo Exit code %RC% >> "%LOG%"

rem Keep a month of logs. They are small, but not infinite.
powershell -NoProfile -Command "Get-ChildItem '%LOGDIR%\data-*.log' -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force -ErrorAction SilentlyContinue" >nul 2>&1

exit /b %RC%
