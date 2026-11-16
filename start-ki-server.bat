@echo off
REM CPU-only KI-Server fuer AI Developer Studio (umgeht die alte GTX 750 Ti)
REM Startet llama-server mit dem installierten qwen2.5-coder:3b Modell auf Port 8080.
REM In der App: Einstellungen -> Provider "Eigener Endpoint" -> http://localhost:8080/v1

set MODEL=C:\Users\User\.ollama\models\blobs\sha256-4a188102020e9c9530b687fd6400f775c45e90a0d7baafe65bd0a36963fbb7ba
set BIN=C:\Users\User\AppData\Local\Programs\Ollama\lib\ollama\llama-server.exe

"%BIN%" -m "%MODEL%" --port 8080 -ngl 0 -c 8192
pause
