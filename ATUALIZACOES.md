# Atualizações do Resenhazinha

## 4.4.3

- Simplifica a aceitação de chamadas WebRTC para o comportamento estável das versões antigas.
- Voz e tela não são mais bloqueadas por diferença de sessionId antes do primeiro stream remoto existir.
- A tela pode chegar antes do evento "AO VIVO" sem ser encerrada pelo reconciliador.
- A janela de negociação aumenta para 30 segundos.
- Mantém Cloudflare como servidor central e PeerJS apenas como transporte/sinalização da mídia.
- Adiciona diagnóstico de estados ICE/WebRTC para identificar falhas de rota se ainda houver problema.


## 4.4.2

- Restaura apenas a reconexão da sinalização PeerJS, sem sair da call e sem fechar streams.
- Corrige o cenário em que Cloudflare/roster funcionavam, mas voz e tela não conseguiam iniciar novas conexões WebRTC.
- Antes de entrar na call, compartilhar tela ou ligar câmera, o app verifica se a sinalização de mídia está pronta.
- Se o PeerJS cair, ele reconecta silenciosamente e refaz apenas a negociação necessária.
- Diagnóstico agora diferencia Cloudflare conectado de sinalização de mídia indisponível.


## 4.4.1

- Corrige negociação de voz e tela após a migração para o servidor Cloudflare.
- Presença de voz e compartilhamento recebem eventos dedicados do Worker, sem depender só do timing do roster.
- Peer ID de mídia é atualizado pelo clientId estável após reconexões.
- Adiciona novas tentativas curtas e controladas de negociação de voz/tela/câmera.
- Corrige avatar/banner sumindo ao entrar ou reconectar no servidor.
- Perfis são ressincronizados automaticamente quando alguém entra.
- Sons de entrada/saída e compartilhamento ganham fallback local caso o áudio remoto falhe ou demore.
- Fechamento de uma sessão antiga não apaga o estado de uma conexão nova.


## 4.4.0

- Cloudflare Worker + Durable Object volta a ser a autoridade do servidor.
- O servidor continua online mesmo com o PC do Owner fechado.
- Todos os clientes recebem roster, presença da call, chat e administração direto da nuvem.
- PeerJS fica restrito à mídia P2P (voz, câmera e tela), sem hospedar o servidor.
- Presença de voz revisionada da 4.3.1 é sincronizada pelo Cloudflare.
- Owner pode recuperar a chave cloud após a regressão da linha 4.3.x.
- Chat, anexos, reações e perfis voltam a usar o backend persistente.


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
