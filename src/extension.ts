import * as vscode from 'vscode'
import * as NodePath from 'path'

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('markdown-editor.startEditor', () => {
      EditorPanel.createOrShow(context.extensionUri)
    })
  )
}

function getWebviewOptions(
  extensionUri: vscode.Uri
): vscode.WebviewOptions & vscode.WebviewPanelOptions {
  return {
    // Enable javascript in the webview
    enableScripts: true,

    retainContextWhenHidden: true,
  }
}

/**
 * Manages cat coding webview panels
 */
class EditorPanel {
  /**
   * Track the currently panel. Only allow a single panel to exist at a time.
   */
  public static currentPanel: EditorPanel | undefined

  public static readonly viewType = 'markdown-editor'

  private _disposables: vscode.Disposable[] = []

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined

    // If we already have a panel, show it.
    if (EditorPanel.currentPanel) {
      EditorPanel.currentPanel._panel.reveal(column)
      return
    }
    if (!vscode.window.activeTextEditor) {
      vscode.window.showErrorMessage(`Cannot find markdown file!`)
      return
    }
    const doc = vscode.window.activeTextEditor.document
    if (doc.languageId !== 'markdown') {
      vscode.window.showErrorMessage(
        `Current file is not markdown:${doc.languageId}`
      )
      return
    }

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      EditorPanel.viewType,
      'markdown-editor',
      column || vscode.ViewColumn.One,
      getWebviewOptions(extensionUri)
    )

    EditorPanel.currentPanel = new EditorPanel(panel, extensionUri, doc)
  }

  public static revive(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    doc: vscode.TextDocument
  ) {
    EditorPanel.currentPanel = new EditorPanel(panel, extensionUri, doc)
  }

  private constructor(
    private readonly _panel: vscode.WebviewPanel,
    private readonly _extensionUri: vscode.Uri,
    public readonly _document: vscode.TextDocument
  ) {
    // Set the webview's initial html content

    this._init()

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)
    let textEditTimer: NodeJS.Timeout | void
    vscode.workspace.onDidChangeTextDocument((e) => {
      // 当 webview panel 激活时不将由 webview编辑导致的 vsc 编辑器更新同步回 webview
      if (this._panel.active) {
        return
      }
      textEditTimer && clearTimeout(textEditTimer)
      textEditTimer = setTimeout(() => {
        this._update()
      }, 500)
    }, this._disposables)
    let panelChangeTimer: NodeJS.Timeout | void
    // // Update the content based on view changes
    // this._panel.onDidChangeViewState(
    //   (e) => {
    //     console.log(
    //       'panelViewStateChange',
    //       this._panel.visible,
    //       this._panel.active
    //     )
    //     if (this._panel.active) {
    //       panelChangeTimer && clearTimeout(panelChangeTimer)
    //       panelChangeTimer = setTimeout(() => {
    //           this._update()
    //       }, 500)
    //     }
    //   },
    //   null,
    //   this._disposables
    // )

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        console.log('webview review', message)
        switch (message.command) {
          case 'ready':
            this._update()
            break
          case 'info':
            vscode.window.showInformationMessage(message.content)
            break
          case 'edit': {
            const edit = new vscode.WorkspaceEdit()
            edit.replace(
              this._document.uri,
              new vscode.Range(0, 0, this._document.lineCount, 0),
              message.content
            )
            await vscode.workspace.applyEdit(edit)
            break
          }
          case 'save': {
            const edit = new vscode.WorkspaceEdit()
            edit.replace(
              this._document.uri,
              new vscode.Range(0, 0, this._document.lineCount, 0),
              message.content
            )
            await vscode.workspace.applyEdit(edit)
            await this._document.save()
            break
          }
          case 'upload': {
            const assetsFolder = NodePath.join(
              NodePath.dirname(this._document.fileName),
              'assets'
            )
            await Promise.all(
              message.files.map(async (finfo: any) => {
                const f = Buffer.from(finfo.base64, 'base64')
                return vscode.workspace.fs.writeFile(
                  vscode.Uri.file(NodePath.join(assetsFolder, finfo.name)),
                  f
                )
              })
            )
            const files = message.files.map((f: any) => `./assets/${f.name}`)
            this._panel.webview.postMessage({
              command: 'uploaded',
              files,
            })
            break
          }
        }
      },
      null,
      this._disposables
    )
  }

  public dispose() {
    EditorPanel.currentPanel = undefined

    // Clean up our resources
    this._panel.dispose()

    while (this._disposables.length) {
      const x = this._disposables.pop()
      if (x) {
        x.dispose()
      }
    }
  }

  private _init() {
    const webview = this._panel.webview

    this._panel.webview.html = this._getHtmlForWebview(webview)
    console.log('init html', this._panel.webview.html)
  }

  // private fileToWebviewUri = (f: string) => {
  //   return this._panel.webview.asWebviewUri(vscode.Uri.file(f)).toString()
  // }


  private _update() {
    let md = this._document.getText()
    // const dir = NodePath.dirname(this._document.fileName)
    this._panel.webview.postMessage({
      command: 'update',
      content: md,
    })
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const toUri = (f: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, f))
    const baseHref =
      NodePath.dirname(webview.asWebviewUri(this._document.uri).toString()) +
      '/'
    const JsFiles = ['media/vditor/index.min.js', 'media/cash.min.js', 'media/main.js'].map(toUri)
    const CssFiles = ['media/vditor/index.css', 'media/main.css'].map(toUri)

    return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<base href="${baseHref}" />
				${CssFiles.map((f) => `<link href="${f}" rel="stylesheet">`).join('\n')}

				<title>Cat Coding</title>
			</head>
			<body>
				<div id="vditor"></div>
				${JsFiles.map((f) => `<script src="${f}"></script>`).join('\n')}
			</body>
			</html>`
  }
}
