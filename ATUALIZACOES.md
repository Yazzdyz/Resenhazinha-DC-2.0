# Atualizações do Resenhazinha

## 4.3.1

- Corrige o bug em que duas pessoas entravam na call mas cada uma aparecia sozinha.
- Roster atrasado não consegue mais cancelar uma entrada de voz mais nova.
- Presença da call é reenviada no heartbeat e em uma sincronização curta após entrar/sair.
- Oferta WebRTC válida consegue recuperar presença de voz quando o roster chega atrasado.
- Remoção por ADM continua autoritativa através de revisão de presença.


## 4.3.0

- Call reconstruída com uma única sessão de voz por pessoa.
- Presença deduplicada pela identidade estável da instalação.
- Voz, câmera e compartilhamento de tela possuem ciclos independentes.
- Eventos atrasados não removem mais áudio ou vídeo de uma sessão nova.
- Recuperação de mídia limitada, sem loops infinitos de reconexão.
- Áudio da tela usa o mixer por aplicativo e fallback de loopback do Windows.
- Pipeline de publicação consolidado, sem a antiga cadeia de patches em tempo de build.
