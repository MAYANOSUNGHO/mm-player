Option Explicit
Dim sh, fso, dir
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

If sh.Run("cmd /c where node >nul 2>nul", 0, True) <> 0 Then
  sh.Run "cmd /c echo Node.js is required. Install it from https://nodejs.org then try again. & pause", 1, True
  WScript.Quit 1
End If

If Not fso.FolderExists(dir & "\node_modules") Then
  If sh.Run("cmd /c npm install", 1, True) <> 0 Then
    sh.Run "cmd /c echo npm install failed. & pause", 1, True
    WScript.Quit 1
  End If
End If

sh.Run "cmd /c npm run dev", 0, False
