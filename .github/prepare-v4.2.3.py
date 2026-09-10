from pathlib import Path

path = Path('.github/workflows/release.yml')
text = path.read_text(encoding='utf-8')

old_version = '  APP_VERSION: "4.2.2"'
new_version = '  APP_VERSION: "4.2.3"'
if old_version in text:
    text = text.replace(old_version, new_version, 1)
elif new_version not in text:
    raise SystemExit('Não encontrei APP_VERSION 4.2.2')

step = '''      - name: Aplicar janela maximizada e fullscreen real v4.2.3
        shell: pwsh
        run: |
          $ErrorActionPreference = "Stop"
          python ".github/apply-v4.2.3.py"
          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
          git diff --check
          node --check electron/main.cjs
          node --check electron/preload.cjs
          node --check src/v4.2.2.js
          $main = Get-Content "electron/main.cjs" -Raw
          $preload = Get-Content "electron/preload.cjs" -Raw
          if ($main -notmatch 'mainWindow\.maximize\(\)') { throw "Abertura maximizada não foi aplicada." }
          if ($main -notmatch 'setFullScreen\(target\)') { throw "Fullscreen real não foi aplicado." }
          if ($preload -notmatch 'setWindowFullscreen') { throw "Bridge de fullscreen não foi aplicada." }

'''
anchor = '      - name: Preparar Node.js\n'
if 'Aplicar janela maximizada e fullscreen real v4.2.3' not in text:
    if anchor not in text:
        raise SystemExit('Não encontrei o ponto antes de Preparar Node.js')
    text = text.replace(anchor, step + anchor, 1)

path.write_text(text, encoding='utf-8')
print('release.yml preparado para v4.2.3')
