import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentState, WebviewPost } from './types.js';
import {
	launchNewTerminal,
	removeAgent,
	restoreAgents,
	persistAgents,
	sendExistingAgents,
	sendLayout,
	getProjectDirPath,
} from './agentManager.js';
import { ensureProjectScan } from './fileWatcher.js';
import { loadFurnitureAssets, sendAssetsToWebview, loadFloorTiles, sendFloorTilesToWebview, loadWallTiles, sendWallTilesToWebview, loadCharacterSprites, sendCharacterSpritesToWebview, loadDefaultLayout } from './assetLoader.js';
import { WORKSPACE_KEY_AGENT_SEATS, GLOBAL_KEY_SOUND_ENABLED } from './constants.js';
import { writeLayoutToFile, readLayoutFromFile, watchLayoutFile } from './layoutPersistence.js';
import type { LayoutWatcher } from './layoutPersistence.js';

export class PixelAgentsViewProvider implements vscode.WebviewViewProvider {
	nextAgentId = { current: 1 };
	nextTerminalIndex = { current: 1 };
	agents = new Map<number, AgentState>();
	webviewView: vscode.WebviewView | undefined;

	// Per-agent timers
	fileWatchers = new Map<number, fs.FSWatcher>();
	pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
	waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
	jsonlPollTimers = new Map<number, ReturnType<typeof setInterval>>();
	permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();

	// /clear detection: project-level scan for new JSONL files
	activeAgentId = { current: null as number | null };
	knownJsonlFiles = new Set<string>();
	projectScanTimer = { current: null as ReturnType<typeof setInterval> | null };

	// Bundled default layout (loaded from assets/default-layout.json)
	defaultLayout: Record<string, unknown> | null = null;

	// Cross-window layout sync
	layoutWatcher: LayoutWatcher | null = null;

	/** Editor tabs that show the same Pixel Agents UI (receive broadcast updates). */
	editorWebviews: vscode.Webview[] = [];

	constructor(private readonly context: vscode.ExtensionContext) {}

	private get extensionUri(): vscode.Uri {
		return this.context.extensionUri;
	}

	private get webview(): vscode.Webview | undefined {
		return this.webviewView?.webview;
	}

	/** Post to panel and all editor-tab webviews. */
	private postToAll(msg: unknown): void {
		this.webview?.postMessage(msg);
		for (const w of this.editorWebviews) {
			w.postMessage(msg);
		}
	}

	private get broadcast(): WebviewPost {
		return { postMessage: (msg) => this.postToAll(msg) };
	}

	private persistAgents = (): void => {
		persistAgents(this.agents, this.context);
	};

	private async handleMessage(message: { type: string; [k: string]: unknown }, fromWebview: vscode.Webview): Promise<void> {
		if (message.type === 'openClaude') {
			launchNewTerminal(
				this.nextAgentId, this.nextTerminalIndex,
				this.agents, this.activeAgentId, this.knownJsonlFiles,
				this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
				this.jsonlPollTimers, this.projectScanTimer,
				this.broadcast, this.persistAgents,
			);
		} else if (message.type === 'focusAgent') {
			const agent = this.agents.get(message.id as number);
			if (agent) {
				agent.terminalRef?.show();
			}
		} else if (message.type === 'closeAgent') {
			const agent = this.agents.get(message.id as number);
			if (agent) {
				if (agent.terminalRef) {
					agent.terminalRef.dispose(); // triggers onDidCloseTerminal → removeAgent
				} else {
					// Orphan agent — no terminal, remove directly
					removeAgent(
						message.id as number, this.agents,
						this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
						this.jsonlPollTimers, this.persistAgents,
					);
					this.postToAll({ type: 'agentClosed', id: message.id as number });
				}
			}
		} else if (message.type === 'saveAgentSeats') {
			console.log(`[Pixel Agents] saveAgentSeats:`, JSON.stringify(message.seats));
			this.context.workspaceState.update(WORKSPACE_KEY_AGENT_SEATS, message.seats);
		} else if (message.type === 'saveLayout') {
			this.layoutWatcher?.markOwnWrite();
			writeLayoutToFile(message.layout as Record<string, unknown>);
		} else if (message.type === 'setSoundEnabled') {
			this.context.globalState.update(GLOBAL_KEY_SOUND_ENABLED, message.enabled);
		} else if (message.type === 'webviewReady') {
			restoreAgents(
				this.context,
				this.nextAgentId, this.nextTerminalIndex,
				this.agents, this.knownJsonlFiles,
				this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
				this.jsonlPollTimers, this.projectScanTimer, this.activeAgentId,
				this.broadcast, this.persistAgents,
			);
			const soundEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_SOUND_ENABLED, true);
			fromWebview.postMessage({ type: 'settingsLoaded', soundEnabled });

				const projectDir = getProjectDirPath();
				const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
				console.log('[Extension] workspaceRoot:', workspaceRoot);
				console.log('[Extension] projectDir:', projectDir);
				if (projectDir) {
					ensureProjectScan(
						projectDir, this.knownJsonlFiles, this.projectScanTimer, this.activeAgentId,
						this.nextAgentId, this.agents,
						this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
						this.broadcast, this.persistAgents,
					);

					(async () => {
						try {
							console.log('[Extension] Loading furniture assets...');
							const extensionPath = this.extensionUri.fsPath;
							const bundledAssetsDir = path.join(extensionPath, 'dist', 'assets');
							let assetsRoot: string | null = null;
							if (fs.existsSync(bundledAssetsDir)) {
								assetsRoot = path.join(extensionPath, 'dist');
							} else if (workspaceRoot) {
								assetsRoot = workspaceRoot;
							}

							if (!assetsRoot) {
								console.log('[Extension] ⚠️  No assets directory found');
								sendLayout(this.context, fromWebview, this.defaultLayout);
								this.startLayoutWatcher();
								return;
							}

							this.defaultLayout = loadDefaultLayout(assetsRoot);
							const charSprites = await loadCharacterSprites(assetsRoot);
							if (charSprites) {
								sendCharacterSpritesToWebview(fromWebview, charSprites);
							}
							const floorTiles = await loadFloorTiles(assetsRoot);
							if (floorTiles) {
								sendFloorTilesToWebview(fromWebview, floorTiles);
							}
							const wallTiles = await loadWallTiles(assetsRoot);
							if (wallTiles) {
								sendWallTilesToWebview(fromWebview, wallTiles);
							}
							const assets = await loadFurnitureAssets(assetsRoot);
							if (assets) {
								sendAssetsToWebview(fromWebview, assets);
							}
						} catch (err) {
							console.error('[Extension] ❌ Error loading assets:', err);
						}
						sendLayout(this.context, fromWebview, this.defaultLayout);
						this.startLayoutWatcher();
					})();
				} else {
					(async () => {
						try {
							const ep = this.extensionUri.fsPath;
							const bundled = path.join(ep, 'dist', 'assets');
							if (fs.existsSync(bundled)) {
								const distRoot = path.join(ep, 'dist');
								this.defaultLayout = loadDefaultLayout(distRoot);
								const cs = await loadCharacterSprites(distRoot);
								if (cs) { sendCharacterSpritesToWebview(fromWebview, cs); }
								const ft = await loadFloorTiles(distRoot);
								if (ft) { sendFloorTilesToWebview(fromWebview, ft); }
								const wt = await loadWallTiles(distRoot);
								if (wt) { sendWallTilesToWebview(fromWebview, wt); }
							}
						} catch { /* ignore */ }
						sendLayout(this.context, fromWebview, this.defaultLayout);
						this.startLayoutWatcher();
					})();
				}
				sendExistingAgents(this.agents, this.context, fromWebview);
			} else if (message.type === 'openSessionsFolder') {
				const projectDir = getProjectDirPath();
				if (projectDir && fs.existsSync(projectDir)) {
					vscode.env.openExternal(vscode.Uri.file(projectDir));
				}
			} else if (message.type === 'exportLayout') {
				const layout = readLayoutFromFile();
				if (!layout) {
					vscode.window.showWarningMessage('Pixel Agents: No saved layout to export.');
					return;
				}
				const uri = await vscode.window.showSaveDialog({
					filters: { 'JSON Files': ['json'] },
					defaultUri: vscode.Uri.file(path.join(os.homedir(), 'pixel-agents-layout.json')),
				});
				if (uri) {
					fs.writeFileSync(uri.fsPath, JSON.stringify(layout, null, 2), 'utf-8');
					vscode.window.showInformationMessage('Pixel Agents: Layout exported successfully.');
				}
			} else if (message.type === 'importLayout') {
				const uris = await vscode.window.showOpenDialog({
					filters: { 'JSON Files': ['json'] },
					canSelectMany: false,
				});
				if (!uris || uris.length === 0) return;
				try {
					const raw = fs.readFileSync(uris[0].fsPath, 'utf-8');
					const imported = JSON.parse(raw) as Record<string, unknown>;
					if (imported.version !== 1 || !Array.isArray(imported.tiles)) {
						vscode.window.showErrorMessage('Pixel Agents: Invalid layout file.');
						return;
					}
					this.layoutWatcher?.markOwnWrite();
					writeLayoutToFile(imported);
					this.postToAll({ type: 'layoutLoaded', layout: imported });
					vscode.window.showInformationMessage('Pixel Agents: Layout imported successfully.');
				} catch {
					vscode.window.showErrorMessage('Pixel Agents: Failed to read or parse layout file.');
				}
			}
	}

	resolveWebviewView(webviewView: vscode.WebviewView) {
		this.webviewView = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);
		webviewView.webview.onDidReceiveMessage((message) => this.handleMessage(message as { type: string; [k: string]: unknown }, webviewView.webview));

		vscode.window.onDidChangeActiveTerminal((terminal) => {
			this.activeAgentId.current = null;
			if (!terminal) { return; }
			for (const [id, agent] of this.agents) {
				if (agent.terminalRef === terminal) {
					this.activeAgentId.current = id;
					this.postToAll({ type: 'agentSelected', id });
					break;
				}
			}
		});

		vscode.window.onDidCloseTerminal((closed) => {
			for (const [id, agent] of this.agents) {
				if (agent.terminalRef === closed) {
					if (this.activeAgentId.current === id) {
						this.activeAgentId.current = null;
					}
					removeAgent(
						id, this.agents,
						this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
						this.jsonlPollTimers, this.persistAgents,
					);
					this.postToAll({ type: 'agentClosed', id });
				}
			}
		});
	}

	/** Open Pixel Agents in an editor tab (so it can sit beside terminal in panel). */
	openInEditor(): void {
		const panel = vscode.window.createWebviewPanel(
			'pixel-agents.editor',
			'Pixel Agents',
			vscode.ViewColumn.One,
			{ enableScripts: true, retainContextWhenHidden: true },
		);
		panel.webview.html = getWebviewContent(panel.webview, this.extensionUri);
		this.editorWebviews.push(panel.webview);
		panel.onDidDispose(() => {
			const i = this.editorWebviews.indexOf(panel.webview);
			if (i !== -1) {
				this.editorWebviews.splice(i, 1);
			}
		});
		panel.webview.onDidReceiveMessage((message) => this.handleMessage(message as { type: string; [k: string]: unknown }, panel.webview));
	}

	/** Export current saved layout to webview-ui/public/assets/default-layout.json (dev utility) */
	exportDefaultLayout(): void {
		const layout = readLayoutFromFile();
		if (!layout) {
			vscode.window.showWarningMessage('Pixel Agents: No saved layout found.');
			return;
		}
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('Pixel Agents: No workspace folder found.');
			return;
		}
		const targetPath = path.join(workspaceRoot, 'webview-ui', 'public', 'assets', 'default-layout.json');
		const json = JSON.stringify(layout, null, 2);
		fs.writeFileSync(targetPath, json, 'utf-8');
		vscode.window.showInformationMessage(`Pixel Agents: Default layout exported to ${targetPath}`);
	}

	private startLayoutWatcher(): void {
		if (this.layoutWatcher) return;
		this.layoutWatcher = watchLayoutFile((layout) => {
			console.log('[Pixel Agents] External layout change — pushing to webview');
			this.postToAll({ type: 'layoutLoaded', layout });
		});
	}

	dispose() {
		this.layoutWatcher?.dispose();
		this.layoutWatcher = null;
		for (const id of [...this.agents.keys()]) {
			removeAgent(
				id, this.agents,
				this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
				this.jsonlPollTimers, this.persistAgents,
			);
		}
		if (this.projectScanTimer.current) {
			clearInterval(this.projectScanTimer.current);
			this.projectScanTimer.current = null;
		}
	}
}

export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const distPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
	const indexPath = vscode.Uri.joinPath(distPath, 'index.html').fsPath;

	let html = fs.readFileSync(indexPath, 'utf-8');

	html = html.replace(/(href|src)="\.\/([^"]+)"/g, (_match, attr, filePath) => {
		const fileUri = vscode.Uri.joinPath(distPath, filePath);
		const webviewUri = webview.asWebviewUri(fileUri);
		return `${attr}="${webviewUri}"`;
	});

	return html;
}
