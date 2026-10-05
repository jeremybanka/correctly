import * as vscode from "vscode"
import { LanguageClient, TransportKind } from "vscode-languageclient/node"

let client: LanguageClient | undefined
export async function activate(context: vscode.ExtensionContext) {
	if (!vscode.workspace.isTrusted) return
	const watcher = vscode.workspace.createFileSystemWatcher("**/*")
	context.subscriptions.push(watcher)
	client = new LanguageClient(
		"correctly",
		"Correctly",
		{
			module: context.asAbsolutePath("dist/server.mjs"),
			transport: TransportKind.stdio,
		},
		{
			documentSelector: [{ scheme: "file" }],
			synchronize: { fileEvents: watcher },
		},
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("correctly.restartServer", async () => {
			await client?.restart()
		}),
	)
	await client.start()
}
export async function deactivate() {
	await client?.stop()
	client = undefined
}
