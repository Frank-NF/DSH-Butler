; DSH 管家 —— Windows 安装版脚本
;
; 编译方式（Inno Setup 6）：
;   ISCC.exe scripts\butler-setup.iss
;
; 设计要点：
;   1) 免管理员：装到当前用户目录（{localappdata}），双击就装，不弹 UAC；
;   2) 环境内置：Git / Node.js / pnpm 随包分发到 {%USERPROFILE}\.dsh-butler\toolchain ——
;      这正是管家"自动获取环境"时使用的位置，所以装完即被识别为已内置，不会再联网下载；
;   3) AppId 固定：升级安装靠它识别同一个应用，改了会装出两份。

#define MyAppName "DSH 管家"
#define MyAppVersion "2.0.0-rc.4"
#define MyAppPublisher "昊天工作室"
#define MyAppURL "https://dsh.huilinsh.cn"
#define MyAppExeName "dsh-butler.exe"

[Setup]
AppId={{7F3A9C21-4B8E-4D6A-9C15-2E8F7A1D3B64}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={localappdata}\Programs\DSH-Butler
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\dist
OutputBaseFilename=DSH-Butler-v{#MyAppVersion}-setup
SetupIconFile=..\dist\dsh-butler\AppIcon.ico
UninstallDisplayName={#MyAppName} {#MyAppVersion}
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/max
SolidCompression=yes
LZMAUseSeparateProcess=yes
LZMANumBlockThreads=4
WizardStyle=modern
WizardResizable=yes
CloseApplications=yes
RestartApplications=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
LicenseFile=..\LICENSE
OutputManifestFile=..\dist\setup-manifest.txt

[Languages]
; 中文语言文件随手稿自带：Inno 默认安装里没有中文包，且我们不改系统目录。
Name: "chinesesimplified"; MessagesFile: "languages\ChineseSimplified.isl"

[Tasks]
Name: "startmenu"; Description: "创建开始菜单快捷方式"; GroupDescription: "附加图标:"; Flags: checkedonce
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加图标:"; Flags: checkedonce

[Files]
Source: "..\dist\dsh-butler\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\dsh-butler\dsh-butler.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\dsh-butler\AppIcon.ico"; DestDir: "{app}"; Flags: ignoreversion
; Excludes：PortableGit 里带一个 etc\mtab 符号链接（指向 Linux 的 /proc/mounts），
; Windows 上本就用不到，且 ISCC 读它会直接报"系统无法访问此文件"导致编译中止。
Source: "..\dist\bundle\toolchain\*"; DestDir: "{%USERPROFILE}\.dsh-butler\toolchain"; Excludes: "git\etc\mtab"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: startmenu
Name: "{group}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"; Tasks: startmenu
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "安装完成后启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent
