# Resenhazinha Mobile

O app Android usa Capacitor sobre a mesma aplicação web do Resenhazinha.

## Desenvolvimento

Na raiz do projeto:

```bash
npm install
npm run build
cd mobile
npm install
npx cap add android
node scripts/patch-android.mjs
npx cap sync android
npx cap open android
```

O projeto Android é gerado pelo Capacitor e não precisa ser mantido manualmente no repositório nesta primeira etapa.

## Escopo inicial

- Chat e servidores
- Upload de imagens/arquivos com armazenamento web local
- Perfil, avatar e configurações
- Voz via Cloudflare Realtime SFU
- Mute/deafen e câmera
- Interface adaptada para toque e telas pequenas

O compartilhamento de tela local do PC continua sendo uma função do app desktop.
