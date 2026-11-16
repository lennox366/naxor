# NAXORA

Eigenständige Desktop-KI-Anwendung für Windows: Dark-Glass-Chat & Sprachsystem.

## Tech-Stack

- **Electron 37** + **React 19** + **TypeScript** + **Vite 7**
- **SQLite** (sql.js/WebAssembly) für Chatverlauf, Nachrichten und Einstellungen — Datei: `%APPDATA%/ai-developer-studio/studio.db`
- **KI**: Ollama (lokal, Standard `http://localhost:11434`), OpenAI, oder beliebiger OpenAI-kompatibler Endpoint
- **Sprache**: STT via Web Speech API (oder Whisper-kompatibler `/audio/transcriptions`-Endpoint), TTS via `speechSynthesis`

## Starten

```bash
npm install
npm run dev      # Vite + Electron mit Hot Reload
# oder
npm run build && npx electron .   # Production-Modus (dist/)
npm run dist     # Windows-Installer (electron-builder, NSIS)
```

## Funktionen

- Dashboard mit Schnellzugriffen, das beim ersten Senden in eine Chatoberfläche übergeht
- Chat wie bei ChatGPT: Markdown, Syntax-Highlighting, Copy-Buttons, Anhänge, Streaming
- Sprachmodus: Mikrofon-Button (Web Speech API), optionaler Whisper-Endpunkt, TTS pro Antwort, durchgehender Speak-&-Listen-Modus
- Chatverlauf in SQLite: umbenennen (Doppelklick), löschen, suchen, sitzungsübergreifend
- Studios: Coding (Datei-Explorer + Editor + KI-Bearbeitung), Design (HTML-Generierung + Vorschau), Bildgenerierung (Pollinations.ai oder eigener Endpoint), Präsentationen (JSON→Folien→HTML/PDF-Export), Dokumente (Markdown + KI), Dateiverwaltung
- Einstellungen: Provider, API-Keys (lokal gespeichert), Stimme, Tempo, STT-Endpoint

## Hinweise

- **Ollama**: `ollama serve` starten, Modell pullen (z. B. `ollama pull llama3.1`), in den Einstellungen Modell wählen.
- **STT**: Die Electron-/Chromium-Web-Speech-API ist von der Google-Sprachdienst-Infrastruktur abhängig und kann in Electron nicht funktionieren. Dann STT-Endpunkt (z. B. `faster-whisper` HTTP-Server oder OpenAI `/v1/audio/transcriptions`) in den Einstellungen eintragen.
- API-Keys liegen unverschlüsselt in der lokalen SQLite-Datei — für echte Secrets ggf. später OS-Keychain anbinden.
