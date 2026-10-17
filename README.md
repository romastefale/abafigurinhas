# abafigurinhas

Bot de figurinhas para Telegram, 100% **Telegram Serverless** (sem servidor próprio e sem Actions no caminho do usuário).

O Telegram não converte mídia e o runtime serverless não roda ffmpeg. Por isso a conversão acontece **no aparelho**, dentro de um Mini App hospedado pelo próprio serverless; o resultado (já em formato de figurinha) vai para um *endpoint*, que o entrega ao Bot API.

## Como funciona

| Parte | Onde | O que faz |
|---|---|---|
| `web/` | Mini App (hospedado em `https://app<id>.tgcloud.ai/`) | Escolhe imagem/vídeo, converte com WebCodecs ([Mediabunny](https://mediabunny.dev)) e mostra a prévia. Visual adaptado da página do `romastefale/realista`. |
| `tgcloud/endpoints/addSticker.js` | serverless | Valida o arquivo, cria o pacote ou adiciona a um existente e avisa no chat com uma única mensagem rica ("Pacote criado" / "Pacote atualizado:" em H1 e, na linha de baixo, o nome do pacote como hiperlink para o pacote), com a prévia do link. |
| `tgcloud/endpoints/getPacks.js` | serverless | Lista os pacotes do usuário. |
| `tgcloud/handlers/message.js` | serverless | No chat, responde com uma mensagem rica (`sendRichMessage`, Bot API 10.1) e um botão verde (Bot API 10.3) que abre o app; se o Telegram recusar a mensagem rica, cai para texto simples. |
| `tgcloud/schema.js` | serverless | Tabela `packs`. |
| `.github/workflows/deploy.yml` | GitHub Actions | A cada push em `main`: `fetch`, `push`, `migrate --safe`, `webhook`. |

Contorno (escolhido na tela): **square** (cantos vivos), **rounded** (raio de 14% do lado) ou **squircle** (superelipse |x|⁴+|y|⁴=1). Fora do contorno a figurinha fica transparente (WebP/PNG com alpha; WebM VP9 com alpha).

Conversões (todas no aparelho):
- **Imagem** → WebP (ou PNG, se o navegador não codifica WebP) 512×512, até 512 KB.
- **Vídeo** → WebM VP9 512×512, sem áudio, até 3 s e 256 KB, com ajuste automático de taxa.

## Montar (uma vez)

1. No [@BotFather](https://t.me/BotFather): bot → **Serverless** → ligar. Em **CLI Access**, copie o *Access token* (`app<id>:<secret>`; não é o token da Bot API).
2. No GitHub: Settings → Secrets and variables → Actions → secret **`TGCLOUD_TOKEN`** com esse valor.
3. Faça merge na `main` (ou Actions → *Deploy* → Run workflow). O passo `push` imprime o endereço do Mini App.
4. No BotFather, use esse endereço como **Menu Button** / Mini App do bot e coloque-o em `tgcloud/lib/config.js` (`MINI_APP_URL`) para o `/start` mostrar o botão.

Outros comandos (sempre com o CLI local, nunca `npx tgcloud` fora do projeto):

```bash
npm ci
npm run status                    # o que mudou
npm run run -- endpoints/getPacks '{}' --ctx '{ initData: { user: { id: 1 } } }'
```

## Modo compacto

O app não chama `expand()` e o layout cabe em meia altura (usa `--tg-viewport-stable-height`). Para abrir compacto, configure o modo de abertura no @BotFather (Mini App) ou use `mode=compact` no link direto. Segundo a documentação do Telegram, o padrão é altura total; há relato de que o Android às vezes expande mesmo em modo compacto.

Ao digitar o nome de um pacote, o app esconde o título, a prévia e o seletor, deixando só o campo e o botão acima do teclado; Enter envia.

## Limitações

- Vídeo depende de WebCodecs com VP9 no WebView do Telegram. O app detecta e avisa quando o aparelho não suporta (imagens continuam funcionando).
- Entrada de vídeo depende do que o aparelho decodifica (MP4/H.264 e MOV costumam funcionar em celulares). `.gif` puro não é lido; envie como vídeo.
- Sem conversão de vídeo em áudio (não há como encodar Opus de forma confiável no WebView).
- A lista de pacotes vem da tabela `packs` (só os criados pelo app) e é conferida no Telegram a cada abertura com `getStickerSet`: pacotes que o Bot API não devolve ficam fora da lista (nada é apagado da tabela), o formato mostrado é o real (`is_video`/`is_animated`) e pacotes com 120 figurinhas aparecem desabilitados como "(cheio)". Nenhuma dessas decisões depende do texto de um erro, que a documentação não garante.
- O app só enxerga os pacotes criados por ele. Pacotes de versões anteriores do bot não aparecem e não há como adicioná-los por link.
- A prévia do link vem de `editMessageText`, o único método do Bot API que aceita `rich_message` junto de `link_preview_options`: o bot envia a mensagem rica e edita essa mesma mensagem (continua sendo uma só). Se a edição falhar, a mensagem com o hiperlink permanece. O Telegram mostra o aviso "Abrir este link?" ao tocar num link embutido.

## Proteção dos dados

Os pacotes dos usuários ficam na tabela `packs` e sobrevivem a qualquer deploy: segundo o documento do Serverless, o deploy nunca toca no banco, o `migrate --safe` só aplica mudanças aditivas e apagar algo do `schema.js` não apaga a tabela. Para que nenhum commit coloque isso em risco, o workflow roda `npm run check:schema` (barra schema sem a tabela/colunas de `packs` ou com `.deprecated()`) e não oferece a opção `--yes` do `migrate`.
