@echo off
rem Legacy entry kept for old favorites/shortcuts. No logic here:
rem delegates to the main launcher in this same folder (matched by
rem ASCII wildcard so this file stays 100% ASCII).
for %%F in ("%~dp0AniTracker*.bat") do call "%%F"
