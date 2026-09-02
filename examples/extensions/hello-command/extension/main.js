// Aluka 示例命令扩展（L3 沙箱垫片演示）。
// 可用 API 面（见 src/extHost/registry.ts createVscodeShim）：
//   vscode.commands.registerCommand(id, fn) / executeCommand(id)
//   vscode.window.showInformationMessage / showWarningMessage / showErrorMessage
//   vscode.workspace.rootPath / readFile(工作区内路径)
vscode.commands.registerCommand("aluka-hello.sayHello", function () {
  vscode.window.showInformationMessage(
    "Hello from Aluka 扩展！安装与命令注册均正常。"
  );
});

vscode.commands.registerCommand("aluka-hello.workspaceInfo", function () {
  var root = vscode.workspace.rootPath;
  if (root) {
    vscode.window.showInformationMessage("当前工作区：" + root);
  } else {
    vscode.window.showWarningMessage("尚未打开工作区");
  }
});
