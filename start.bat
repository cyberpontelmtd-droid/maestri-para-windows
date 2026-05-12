@echo off
title Maestri Windows - Iniciador
color 0B

echo Iniciando o Servidor (Backend)...
cd "%~dp0\backend"
start cmd /k "npm run dev"

timeout /t 3 >nul

echo Iniciando a Interface (Frontend)...
cd "%~dp0\frontend"
start cmd /k "npm run dev"

echo.
echo Tudo rodando! Pode acessar no seu navegador.
pause
