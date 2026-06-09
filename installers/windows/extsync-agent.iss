; ExtSync Agent installer (Inno Setup 6).
; Per-user install under %LOCALAPPDATA% (no admin). Registers the extsync://
; protocol and the Native Messaging Host under HKCU, creates a logon Scheduled
; Task, and provides a full uninstaller. See §4, §13, §27.
;
; Build prerequisites (run from repo root):
;   dotnet publish apps/agent-windows/ExtSync.Agent/ExtSync.Agent.csproj -c Release ^
;       -r win-x64 --self-contained true /p:PublishSingleFile=false ^
;       -o installers/windows/stage/agent
;   dotnet publish apps/native-host/ExtSync.NativeHost.csproj -c Release ^
;       -r win-x64 -o installers/windows/stage/native-host
;   copy your platform public keys to installers/windows/stage/agent/keys.json
;       (format: { "key-2026-01": "<base64 ed25519 public key>" })
; Then: iscc installers/windows/extsync-agent.iss

#define AppName "ExtSync Agent"
#define AppVersion "1.0.0"
#define AppPublisher "ExtSync"
#define HostName "com.extsync.agent"

[Setup]
AppId={{E7A9F3C2-7B1D-4E55-9C0A-2F3B6D8A1C44}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\ExtSync\Agent
DisableDirPage=yes
DefaultGroupName=ExtSync
PrivilegesRequired=lowest
OutputDir=Output
OutputBaseFilename=ExtSyncAgentSetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#AppName}
SetupLogging=yes

[Languages]
Name: "hebrew"; MessagesFile: "compiler:Default.isl"

[Files]
; Agent (published, self-contained)
Source: "stage\agent\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion
; Native Messaging Host (single-file, self-contained) goes to the NativeHost dir
Source: "stage\native-host\extsync-native-host.exe"; DestDir: "{localappdata}\ExtSync\NativeHost"; Flags: ignoreversion

[Dirs]
Name: "{localappdata}\ExtSync\NativeHost"
Name: "{localappdata}\ExtSync\Data"
Name: "{localappdata}\ExtSync\Logs"
Name: "{localappdata}\ExtSync\Extensions"
Name: "{localappdata}\ExtSync\Temp"

[Registry]
; --- Custom URI protocol: extsync:// (HKCU) ---
Root: HKCU; Subkey: "Software\Classes\extsync"; ValueType: string; ValueName: ""; ValueData: "URL:ExtSync Protocol"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\extsync"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\extsync\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\ExtSyncAgent.exe,0"
Root: HKCU; Subkey: "Software\Classes\extsync\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\ExtSyncAgent.exe"" ""%1"""

; --- Native Messaging Host registration (HKCU) for Chrome/Edge/Chromium ---
; The Agent keeps the manifest's allowed_origins in sync at runtime (ADR-0006).
Root: HKCU; Subkey: "Software\Google\Chrome\NativeMessagingHosts\{#HostName}"; ValueType: string; ValueName: ""; ValueData: "{localappdata}\ExtSync\NativeHost\{#HostName}.json"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Microsoft\Edge\NativeMessagingHosts\{#HostName}"; ValueType: string; ValueName: ""; ValueData: "{localappdata}\ExtSync\NativeHost\{#HostName}.json"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Chromium\NativeMessagingHosts\{#HostName}"; ValueType: string; ValueName: ""; ValueData: "{localappdata}\ExtSync\NativeHost\{#HostName}.json"; Flags: uninsdeletekey

[Icons]
Name: "{group}\ExtSync Agent"; Filename: "{app}\ExtSyncAgent.exe"
Name: "{userdesktop}\ExtSync Agent"; Filename: "{app}\ExtSyncAgent.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "צור קיצור דרך בשולחן העבודה"; Flags: unchecked

[Run]
; Create a logon Scheduled Task so the Agent starts with the session (§6).
; The Agent's internal scheduler then performs periodic update checks (default 4h).
Filename: "schtasks.exe"; \
  Parameters: "/Create /F /TN ""ExtSync Agent Logon"" /TR ""'{app}\ExtSyncAgent.exe'"" /SC ONLOGON"; \
  Flags: runhidden runascurrentuser
; Launch the Agent now and write the native host manifest.
Filename: "{app}\ExtSyncAgent.exe"; Description: "הפעל את ExtSync Agent"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "schtasks.exe"; Parameters: "/Delete /F /TN ""ExtSync Agent Logon"""; Flags: runhidden; RunOnceId: "DelTask"

[UninstallDelete]
; Remove the native host manifest we generate; leave user Data/Extensions unless
; the user explicitly chose to remove them in the Agent (§45 #20 — no surprise deletes).
Type: files; Name: "{localappdata}\ExtSync\NativeHost\{#HostName}.json"
Type: filesandordirs; Name: "{localappdata}\ExtSync\NativeHost"
Type: filesandordirs; Name: "{localappdata}\ExtSync\Temp"

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    MsgBox('ExtSync הוסר. קבצי התוספים שהותקנו וה-Data נשארו במחשב. ' +
           'ניתן למחוק אותם ידנית מתיקיית %LOCALAPPDATA%\ExtSync אם תרצה.',
           mbInformation, MB_OK);
  end;
end;
