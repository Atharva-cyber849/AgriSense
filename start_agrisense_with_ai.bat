@echo off
setlocal
cd /d "%~dp0"
echo AgriSense Web App + Persistent AI Inference
echo.
echo server.js will auto-start the Python inference service.
echo Press Ctrl+C to stop.
echo.
npm start
