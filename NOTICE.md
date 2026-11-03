# NOTICE

DSH-IDE is an **unofficial** integration that turns Visual Studio Code into a client surface
for **DeepSeek Harness (DSH)**. It is **not affiliated with, endorsed by, or supported by**
Microsoft Corporation or DeepSeek.

## Upstream components

- **Visual Studio Code** — DSH-IDE is a modified fork of the VS Code source tree under
  `vscode-1.143.1/`. VS Code is licensed under the MIT License; the original copyright notice
  is retained verbatim in `vscode-1.143.1/LICENSE.txt` ("Copyright (c) 2015 - present Microsoft
  Corporation"). Portions of the workbench (notably the chat framework and message renderers)
  have been modified by DSH-IDE contributors; those modifications are likewise released under
  the MIT License.
- **DeepSeek Harness (DSH)** — DSH-IDE connects to a locally running DSH desktop Host over DSH's
  official client transport and treats DSH as the sole agent kernel. DSH-IDE does not bundle or
  redistribute the DSH runtime; it is installed and updated separately through the official DSH
  plugin mechanism (`dsh-ide` bundle).

## Trademarks

"Visual Studio Code", "VS Code", and "Microsoft" are trademarks of Microsoft Corporation.
"DeepSeek" and "DeepSeek Harness" are trademarks of their respective owners. All trademarks are
used only for descriptive/interoperability purposes. No trademark license is granted.

## License

Unless otherwise noted, the DSH-IDE-authored source in this repository (the `dsh-ide/` bundle and
the DSH integration files under `vscode-1.143.1/src/vs/...`) is provided under the MIT License.
Retain both this NOTICE and `vscode-1.143.1/LICENSE.txt` when redistributing.
