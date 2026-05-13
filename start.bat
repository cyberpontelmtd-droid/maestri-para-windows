@echo off
title Maestri Windows
color 0B

echo.
echo  ╔══════════════════════════════════════╗
echo  ║         MAESTRI WINDOWS              ║
echo  ╚══════════════════════════════════════╝
echo.

echo [1/2] Construindo o Frontend...
cd "%~dp0\frontend"
call npm run build
if errorlevel 1 (
  echo ERRO: Falha ao construir o frontend.
  pause
  exit /b 1
)

echo.
echo [2/2] Iniciando o Servidor...
cd "%~dp0\backend"
echo.
echo  Acesse em: http://localhost:3001
echo.
cmd /k "npm run dev"
