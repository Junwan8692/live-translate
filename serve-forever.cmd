@echo off
REM 정적 서버를 죽으면 자동 재시작 (크래시/종료 시 3초 후 재기동).
REM 시작 프로그램에 등록하면 로그인 시 자동 실행됨 (아래 안내 참고).
cd /d "%~dp0"
:loop
echo [%date% %time%] http-server 시작 (127.0.0.1:8787)
npx -y http-server -p 8787 -a 127.0.0.1 -c-1
echo [%date% %time%] http-server 종료됨 - 3초 후 재시작...
timeout /t 3 /nobreak >nul
goto loop
