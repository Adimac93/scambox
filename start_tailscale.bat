@echo off
rem Uruchamia gre i udostepnia ja w Twojej sieci Tailscale (tylko dla osob z Twojej sieci, przez HTTPS).
cd /d "%~dp0"
if not exist .venv (
  python -m venv .venv
  .venv\Scripts\python -m pip install -r requirements.txt
)
"C:\Program Files\Tailscale\tailscale.exe" serve --bg 5000
echo.
echo Adres gry dla znajomych z Twojej sieci Tailscale jest wyzej (https://....ts.net)
echo Zeby wylaczyc udostepnianie: tailscale serve --https=443 off
echo.
.venv\Scripts\python app.py
