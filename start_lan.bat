@echo off
rem Uruchamia gre dostepna w sieci lokalnej (np. w akademiku). Adres dla znajomych pojawi sie ponizej.
cd /d "%~dp0"
if not exist .venv (
  python -m venv .venv
  .venv\Scripts\python -m pip install -r requirements.txt
)
.venv\Scripts\python app.py --lan
