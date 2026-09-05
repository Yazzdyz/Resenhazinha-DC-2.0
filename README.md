# Resenhazinha

O Resenhazinha é um mini servidor para grupos pequenos, inspirado na organização do Discord e mantido simples: até seis pessoas, no máximo um canal de texto e um canal de voz por servidor, cargos, moderação, chat, call e compartilhamento de tela.

## O que tem no Resenhazinha

- Um único servidor persistente: o código de convite é necessário só na primeira entrada de cada amigo.
- Um canal de texto e um canal de voz, que podem ser criados, renomeados ou removidos por administradores.
- Lista de membros no lado direito, com status de call e cargos.
- Cargos visuais com nome e cor; a cor também aparece no nome do membro.
- Cargos com permissão de **ADM**.
- Administradores podem atribuir cargos, mutar/desmutar alguém no servidor, tirar alguém da call e expulsar alguém do servidor. A expulsão não é ban: a pessoa pode voltar digitando o código novamente.
- Tela da call em grade, com avatar e estado do microfone de cada pessoa.
- O chat pode ser aberto a partir da call e ocupa a área central, no estilo de um canal de texto.
- Compartilhamento de tela e proteção de áudio por aplicativo da versão 1.4 foram mantidos.

## Como usar

1. Abra o `Resenhazinha.exe`.
2. Na primeira vez, o dono cria o único servidor e envia o código aos amigos.
3. Cada amigo usa esse código **uma vez**. O aplicativo guarda o servidor neste PC.
4. Nas próximas aberturas, o Resenhazinha entra automaticamente no servidor salvo; ninguém precisa criar outro servidor nem redigitar o código.
5. Você entra inicialmente **fora da call**, podendo ficar só no `# chat-principal`. Clique em `Call` e em **Entrar na call** quando quiser falar.
6. **Sair da call** encerra só voz e transmissão; você continua conectado ao servidor e ao chat.
7. O criador é o **Owner** do servidor. Owner tem todas as permissões e é protegido contra mute de servidor, remoção da call, expulsão e alteração de cargos feita por outros ADMs.
8. Para moderar alguém, use o botão de opções ao lado do membro na lista da direita.
9. Na call, use os controles para mutar o próprio microfone, sair/entrar e compartilhar a tela.

## Áudio do compartilhamento

Na seleção de tela, deixe **Transmitir som do computador** ativado para enviar o áudio de jogos, vídeos e outros programas. A proteção introduzida na versão 1.4 continua ativa: o processo do Resenhazinha fica fora da captura para evitar que a própria call volte para os participantes. Também é possível silenciar outros aplicativos individualmente.

A filtragem por aplicativo requer Windows 10 versão 2004 ou mais recente, Windows 11 e processador x64. Se a captura segura não puder ser iniciada, o aplicativo compartilha somente a imagem para evitar repetição da call.

## Como o servidor funciona

Existe somente um servidor vinculado por instalação. O nome, canais, cargos, atribuições de cargo e até 500 mensagens recentes são gravados no computador do dono e voltam quando o aplicativo é aberto novamente. Os amigos também guardam o vínculo localmente e não precisam redigitar o código depois da primeira entrada.

A conexão continua P2P: o servidor **permanece salvo**, mas o computador do dono ainda precisa estar com o Resenhazinha aberto para os outros enviarem novas mensagens ou entrarem na call. Se o dono ficar offline, os clientes mostram o servidor como offline e tentam reconectar quando ele voltar.

## Rodar o projeto

```bash
npm install
npm run dev
```

## Gerar a versão para Windows

```bash
npm run package:win
```

O aplicativo pronto será criado em `release/Resenhazinha-win32-x64`. Como o executável não possui assinatura digital paga, o Windows pode mostrar o SmartScreen; nesse caso, use **Mais informações** e **Executar assim mesmo** se você confia no arquivo que gerou.

## Observação sobre conexão

O Resenhazinha usa conexão direta entre os computadores com PeerJS. Redes muito bloqueadas podem impedir a conexão. Para funcionamento garantido em qualquer rede, uma versão futura pode usar um servidor TURN próprio.


## Novidades da v1.6.0

- Volume individual por pessoa: cada usuário ajusta localmente quanto quer ouvir cada amigo.
- Volume independente da transmissão de tela, com mute e slider de 0% a 100%.
- Compartilhamento em 720p, 1080p ou 1440p.
- Opções de 15, 30 ou 60 FPS.
- Limite de bitrate adaptado ao perfil escolhido para tentar preservar a qualidade no WebRTC.
- A qualidade final ainda depende da resolução da janela/tela de origem, desempenho do PC e conexão P2P entre os participantes.


## Múltiplas transmissões (v1.7)

- Mais de uma pessoa pode compartilhar a tela ao mesmo tempo.
- Quem assiste pode usar **Ver todas** para colocar as transmissões em grade ou clicar no nome de alguém para focar só naquela tela.
- Cada transmissão remota tem **mute próprio** e **volume próprio**, independentes da call e das outras telas.
- 720p / 1080p / 1440p e 15 / 30 / 60 FPS continuam configuráveis por quem transmite.

Como a conexão é P2P, várias telas em alta qualidade aumentam bastante o uso de upload/download.


## Servidor persistente e call independente (v1.9)

- Um único servidor por instalação; não existe fluxo de criar um servidor novo a cada abertura.
- Código de convite usado apenas na primeira entrada de cada amigo.
- O aplicativo reabre automaticamente o servidor salvo nas próximas execuções.
- Histórico de até 500 mensagens salvo no PC do dono.
- Nome do servidor, nomes/estado dos canais, cargos e atribuições de cargos persistem entre reinicializações.
- Todos entram no servidor fora da call; o microfone só é solicitado quando a pessoa clica para entrar na call.
- Sair da call não fecha o servidor nem o chat e libera o microfone.
- Se o anfitrião cair, os convidados mantêm o vínculo salvo e tentam reconectar automaticamente quando ele voltar.


## Novidades da v1.9

- Foto do servidor persistente, editável por administradores.
- Engrenagem ao lado dos controles do usuário para editar nome e foto.
- Seleção do microfone e supressão de ruído Desligada / Leve / Média / Alta.
- Alteração de microfone aplicada durante a call sem precisar sair.
- Som de notificação ao enviar/receber uma nova mensagem e sons de entrada/saída da call, reproduzidos a partir dos links do Myinstants.


## Novidades da v2.0

- Mensagens próprias podem ser **editadas** ou **apagadas** pelo autor.
- Envio de até **4 anexos por mensagem**, com limite de **25 MB por arquivo**.
- Fotos aparecem direto no chat, vídeos ganham player com controles e outros arquivos aparecem como cartão para baixar.
- Os anexos do histórico ficam armazenados no PC do dono do servidor; ao reabrir o app, clientes pedem o arquivo ao host quando precisam exibi-lo/baixá-lo.
- Clique no avatar ou nome de alguém no chat ou na lista de membros para abrir um **perfil rápido estilo Discord**.
- O perfil rápido mostra nome, estado da call, dono do servidor e todos os cargos com suas cores.
- No próprio perfil há atalho para editar suas configurações; no perfil de outra pessoa há atalho para volume/moderação conforme suas permissões.


## Novidades da v2.1

- Confirmação de exclusão de mensagem feita dentro do próprio app, com prévia da mensagem e atalho **Shift + excluir** para pular a confirmação.
- Perfil com banner em GIF/PNG/JPG/WebP e bio personalizada.
- Banner, bio e avatar são salvos localmente no computador de cada usuário e republicados quando ele reconecta.
- Novo ícone preto e branco do Resenhazinha com a letra R.

## Novidades da v2.2

- Corrigido o scroll da janela **Seu perfil e áudio**. O conteúdo agora rola corretamente mesmo em telas menores.
- O botão **Salvar configurações** fica preso na parte de baixo da janela para não ficar inacessível.
- Cada usuário pode escolher um **GIF ou imagem de fundo do aplicativo**. Essa aparência é somente local e não é enviada para os outros participantes.
- Controle individual de desfoque do fundo de **0 a 30 px**, com prévia ao vivo.
- Botão **Usar fundo padrão** restaura o visual original a qualquer momento.
- O fundo e o nível de desfoque ficam salvos no PC de cada pessoa.


## Novidades da v2.4

- Três temas locais por pessoa: **Claro**, **Escuro** e **Ultra escuro**.
- O modo **Ultra escuro** usa laterais, cabeçalhos e painéis praticamente pretos, seguindo a referência do Discord modificado.
- O fundo personalizado continua funcionando em qualquer tema e permanece apenas no PC de quem escolheu.
- Controle de **zoom do fundo/GIF de 85% a 160%**, logo abaixo do desfoque.
- Controle de **tamanho da fonte de 85% a 130%** sem precisar alterar a resolução ou escala do Windows.
- Prévia de texto dentro das configurações para ajustar o tamanho da fonte visualmente.
- Tema, zoom, desfoque e escala de fonte ficam salvos individualmente no perfil local de cada usuário.


## v2.4
- Ultra escuro com barra lateral, centro e painel de membros praticamente no mesmo preto.
- Fundos GIF/imagem agora são exibidos por uma camada de mídia local real, preservando animação.
- Limite de fundo aumentado para 40 MB.
- Desfoque e zoom continuam individuais por usuário.


## v2.5 — Sidebars e digitação contínua

- Sidebar esquerda ampliada para ficar mais próxima da proporção do Discord.
- Painel de membros fica compacto mostrando avatares e expande automaticamente ao passar o mouse ou focar um membro.
- Após enviar uma mensagem com Enter ou pelo botão, o campo de texto recupera o foco automaticamente.
- Mantém temas, fundo GIF/imagem, zoom/desfoque, fonte, perfis, áudio, cargos, arquivos e múltiplas transmissões das versões anteriores.


## v2.6 — painel animado, status e menções

- O painel de membros da direita continua compacto com avatares e agora abre **por cima do chat com animação suave**, semelhante à referência do Discord modificado.
- Status individuais: **Disponível**, **Ausente**, **Não perturbe** e **Offline**. O status é salvo no perfil local e enviado ao servidor quando a pessoa entra.
- O ponto no avatar e o texto do perfil/lista mudam de cor conforme o status. **Não perturbe** silencia sons e avisos de menção locais.
- Ao digitar `@` no chat aparece uma lista de membros. Setas ↑/↓ navegam, Enter/Tab selecionam e a menção fica destacada na mensagem.
- Mensagens que mencionam você recebem destaque visual; fora de Não perturbe também aparece um aviso local.
- Mantém a digitação contínua após enviar mensagens e todos os recursos anteriores.


## Novidades da v2.7.0

- O seletor de status saiu de **Editar perfil** e agora fica no próprio cartão do usuário, no estilo do Discord.
- Ao abrir seu perfil pelo bloco inferior da lateral, aparece o status atual e um submenu com **Disponível**, **Ausente**, **Não perturbar** e **Invisível/Offline**.
- No tema **Ultra escuro**, as divisórias visíveis entre a lateral esquerda, cabeçalho, chat e painel de membros foram praticamente removidas para deixar a interface contínua.
- Todo o restante da v2.6 foi mantido, incluindo menções com @, painel de membros animado, GIF de fundo, temas, fonte, perfis, chat, call e transmissões.


## Novidades da v2.8.0

- A lista de membros da direita agora é organizada por **cargo principal**, com cabeçalhos e contagem no estilo Discord. Membros em modo Offline ficam reunidos no grupo **Offline**.
- O modo compacto da lateral mantém os nomes dos grupos e os avatares; ao passar o mouse, o painel continua expandindo com a animação das versões anteriores.
- Mensagens consecutivas da mesma pessoa, enviadas em até 7 minutos sem outra pessoa falar no meio, são agrupadas em um único bloco visual com um só cabeçalho/horário. Cada mensagem continua podendo ser editada ou apagada individualmente.
- Corrigido o fundo GIF/imagem nos temas **Claro** e **Escuro**: o shell e a área central agora deixam a mídia local aparecer por trás da interface, assim como no Ultra escuro.


## Novidades da v2.9
- Aro/brilho branco em tempo real em quem estiver falando, tanto na lista da call quanto na grade.
- Sons de entrada e saída agora tocam também quando outros membros entram ou saem da call enquanto você está nela.
- Sons de início e fim de compartilhamento de tela para todos os participantes da call.


## Menu de contexto da call (v2.10)

- Clique com o **botão direito** em qualquer pessoa da call, tanto na lista lateral quanto no modo grade.
- Para outras pessoas, o menu mostra um **slider de volume local do microfone**, de 0% a 100%. Esse ajuste só muda o que você ouve.
- O menu também permite **silenciar localmente**, abrir o perfil e mencionar a pessoa no chat.
- Administradores recebem atalhos para **silenciar voz no servidor** e **tirar da call**.
- No próprio usuário, o ajuste de volume não aparece; o atalho abre as configurações do perfil.


## v2.11 — contexto no chat, Offline persistente e áudio estilo Discord

- Botão direito nas mensagens abre o mesmo menu de membro usado na call.
- Se a pessoa estiver na call, o menu do chat mostra volume local e silenciar localmente.
- ADMs ganham acesso rápido a cargos/permissões, mute de servidor e remoção da call.
- Pessoas que já entraram no servidor passam a permanecer na lista Offline após desconectar e após reiniciar o host.
- Desativar áudio (deafen) muta também o microfone, restaurando o estado anterior ao reativar.
- O deafen afeta somente a voz da call: o áudio das transmissões continua independente.
- A lista da call e a grade mostram ícones separados de microfone mutado e áudio desativado.


## Novidades da v2.12

- ADM pode **Expulsar do servidor** pelo menu de contexto ou tela de gerenciamento. A pessoa perde o vínculo salvo naquele PC e pode voltar usando o código de convite novamente.
- O **Owner** virou uma permissão especial acima de ADM e não pode ser punido por outro administrador.
- O perfil do Owner mostra `Owner · OWNER` e a lista de membros pode separá-lo no grupo Owner.
- Mutar/desmutar o próprio microfone toca um efeito local estilo Discord.
- Desativar/ativar o áudio da call também toca um efeito local. Esses efeitos não são enviados para ninguém.
- Desativar o áudio continua mutando o próprio microfone junto, mas não altera o volume/mute das transmissões de tela.


## v2.13
- Owner continua protegido, mas visualmente usa apenas uma coroa amarela; o agrupamento segue o cargo visual (ex.: Mineiro).
- ADM pode expulsar membros online ou offline. O ID expulso é revogado até o cliente abrir o app, limpar o vínculo e gerar uma nova identidade local; depois pode entrar de novo com o código.
- Avatar e banner passam a ser sincronizados em blocos menores pelo P2P e o host mantém cache visual local dos membros.
- Atualizador portátil preparado para GitHub Releases. Depois de configurar/publicar releases em `Yazzdyz/resenhazinha`, versões novas podem ser baixadas e instaladas pelo próprio app.
## Atualizações automáticas

O projeto já inclui um atualizador portátil e um workflow em `.github/workflows/release.yml`. O alvo é o repositório público `Yazzdyz/resenhazinha`. Para configurar pela primeira vez, leia `ATUALIZACOES.md` e execute `CONFIGURAR_GITHUB.ps1`. Para versões futuras, basta aumentar a versão e executar `PUBLICAR_ATUALIZACAO.ps1`.
