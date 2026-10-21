// Mini App: escolhe o arquivo, converte no aparelho e envia ao endpoint `addSticker`.
// Nada aqui fala com GitHub ou com servidor próprio: só com o serverless do bot.
import { converterImagem, converterVideo, ehVideo, podeGerarVideo, ErroDeConversao, FORMAS, caminhoSquirclePrevia } from "./convert.js";

const tg = window.Telegram?.WebApp;
const $ = (s) => document.querySelector(s);
const st = { carregando: $("#st-carregando"), pronto: $("#st-pronto"), erro: $("#st-erro") };
$("#clip-squircle-d").setAttribute("d", caminhoSquirclePrevia());
const NOVO = "novo";
const CODIGOS_DE_LISTA = new Set(["PACK_UNAVAILABLE", "PACK_FULL", "FORMAT_MISMATCH"]);

let arquivo = null;
let figurinha = null; // { blob, mime, tipo, url }
let pacotes = [];
let ocupado = false;
let ultimoLink = "";
let forma = "square";

// ── Telegram: tema e cores da barra ───────────────────────────────────────────
function aplicarTema() {
  const esquema = tg?.colorScheme;
  if (esquema === "light" || esquema === "dark") document.documentElement.dataset.theme = esquema;
  const borda = getComputedStyle(document.documentElement).getPropertyValue("--page-edge").trim();
  try {
    if (borda) { tg?.setHeaderColor?.(borda); tg?.setBackgroundColor?.(borda); tg?.setBottomBarColor?.(borda); }
  } catch {}
}
try {
  tg?.ready(); // sem expand(): respeita o modo compacto (meia altura)
  aplicarTema();
  tg?.onEvent?.("themeChanged", aplicarTema);
} catch {}

// ── Estado visual ─────────────────────────────────────────────────────────────
function estado(qual, motivo = "") {
  for (const [k, el] of Object.entries(st)) el.hidden = k !== qual;
  $("#sep").hidden = qual === "vazio";
  $("#converter").disabled = qual === "carregando" || !arquivo;
  $("#motivo").textContent = motivo;
  $("#motivo").hidden = true;
}
const dica = (texto) => { $("#dica").textContent = texto; $("#dica").hidden = !texto; };

function chamar(nome, entrada) {
  return new Promise((ok, falha) => {
    if (!tg?.Serverless?.call) return falha(new Error("Abra este app pelo Telegram."));
    tg.Serverless.call(nome, entrada, (err, resultado) => (err ? falha(err) : ok(resultado)));
  });
}
const mensagemDe = (e) => (e && e.message) || "Algo deu errado.";

// ── Contorno ──────────────────────────────────────────────────────────────────
try {
  const salvo = localStorage.getItem("forma");
  if (FORMAS.includes(salvo)) forma = salvo;
} catch {}
function marcarForma() {
  for (const b of document.querySelectorAll("#forma button")) b.setAttribute("aria-checked", String(b.dataset.forma === forma));
}
marcarForma();
$("#forma").addEventListener("click", (e) => {
  const botao = e.target.closest("button[data-forma]");
  if (!botao || botao.dataset.forma === forma) return;
  forma = botao.dataset.forma;
  try { localStorage.setItem("forma", forma); } catch {}
  marcarForma();
  if (figurinha && !ocupado) converter(); // já convertida: refaz com o novo contorno
});

// ── Escolha do arquivo ────────────────────────────────────────────────────────
const escolher = () => $("#arquivo").click();
$("#anexar").addEventListener("click", escolher);
$("#nome-arquivo").addEventListener("click", escolher);
$("#arquivo").addEventListener("change", (e) => {
  arquivo = e.target.files[0] || null;
  limparFigurinha();
  // confirma a escolha pelo tipo de figurinha que vai sair, não pelo nome do arquivo
  $("#nome-arquivo").value = arquivo ? (ehVideo(arquivo) ? "criar sticker animado" : "criar sticker estático") : "";
  estado("vazio");
  dica("");
  if (arquivo && ehVideo(arquivo)) {
    podeGerarVideo().then((ok) => {
      if (!ok && arquivo && ehVideo(arquivo)) dica("Este aparelho não gera figurinha de vídeo. Escolha uma imagem.");
    });
  }
});

function limparFigurinha() {
  if (figurinha) URL.revokeObjectURL(figurinha.url);
  figurinha = null;
  $("#moldura").classList.remove("on", "video");
  $("#video").removeAttribute("src");
  $("#imagem").removeAttribute("src");
  for (const id of ["#destino-bar", "#campo-bar", "#abrir"]) $(id).hidden = true;
  ultimoLink = "";
}

// ── Conversão ─────────────────────────────────────────────────────────────────
$("#form").addEventListener("submit", (e) => {
  e.preventDefault();
  converter();
});

async function converter() {
  if (!arquivo || ocupado) return;
  ocupado = true;
  limparFigurinha();
  dica(""); // apaga o aviso de aparelho sem suporte, se houver
  estado("carregando");
  try {
    figurinha = ehVideo(arquivo) ? await converterVideo(arquivo, forma) : await converterImagem(arquivo, forma);
    figurinha.url = URL.createObjectURL(figurinha.blob);
    figurinha.forma = forma;
    mostrarPrevia();
    await prepararDestino();
    estado("pronto");
  } catch (erro) {
    limparFigurinha();
    estado("erro", erro instanceof ErroDeConversao ? erro.message : "Não consegui converter esse arquivo.");
    if (!(erro instanceof ErroDeConversao)) console.error(erro);
  } finally {
    ocupado = false;
  }
}
st.erro.addEventListener("click", () => ($("#motivo").hidden = !$("#motivo").hidden));

function mostrarPrevia() {
  const moldura = $("#moldura");
  moldura.dataset.forma = figurinha.forma;
  if (figurinha.tipo === "video") {
    moldura.classList.add("video");
    $("#video").src = figurinha.url;
    $("#video").play?.().catch(() => {});
  } else {
    moldura.classList.remove("video");
    $("#imagem").src = figurinha.url;
  }
  moldura.classList.add("on");
}

// ── Destino: uma lista só (seus pacotes e "novo pacote") ─────────────────────
// Escolher "novo pacote" troca a lista, no mesmo lugar, pelo campo do nome.
async function prepararDestino() {
  try {
    pacotes = await chamar("getPacks", {});
  } catch (e) {
    pacotes = [];
    if (e?.type === "UNAUTHORIZED") throw new ErroDeConversao("Abra este app pelo Telegram.");
  }
  const sel = $("#destino");
  sel.replaceChildren();
  const opcao = (valor, texto, extra = {}) =>
    sel.append(Object.assign(document.createElement("option"), { value: valor, textContent: texto }, extra));
  opcao("", "Adicionar ao pacote…", { disabled: true, hidden: true });
  // o formato é de cada figurinha (InputSticker.format), não do pacote: todos os pacotes aceitam qualquer formato
  for (const p of pacotes) opcao(String(p.id), p.full ? `${p.title} (cheio)` : p.title, { disabled: !!p.full });
  opcao(NOVO, "+ Novo pacote…");
  mostrarLista();
}

function mostrarLista() {
  $("#destino").value = "";
  $("#campo").value = "";
  $("#campo-bar").hidden = true;
  $("#destino-bar").hidden = false;
}

function abrirCampo() {
  $("#destino-bar").hidden = true;
  $("#campo-bar").hidden = false;
  $("#campo").focus();
}

// Escolher um pacote da lista já adiciona a figurinha; "novo" abre o campo do nome.
$("#destino").addEventListener("change", () => {
  const v = $("#destino").value;
  if (v === NOVO) return abrirCampo();
  if (v) enviar({ packId: Number(v) });
});

function enviarCampo() {
  const texto = $("#campo").value.trim();
  return texto ? enviar({ title: texto }) : aviso("Dê um nome ao pacote.");
}
$("#enviar").addEventListener("click", enviarCampo);
$("#cancelar").addEventListener("click", () => {
  $("#campo").blur();
  mostrarLista();
});

// ── Teclado ──────────────────────────────────────────────────────────────────
// O campo fica na própria barra da lista e a página não muda. O teclado só reduz a área visível,
// então mantemos a barra à vista enquanto o campo está em uso.
let campoAtivo = false;
const mostrarCampo = () => $("#campo").scrollIntoView({ block: "center", behavior: "smooth" });
$("#campo").addEventListener("focus", () => { campoAtivo = true; mostrarCampo(); });
$("#campo").addEventListener("blur", () => { campoAtivo = false; });
$("#campo").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); $("#campo").blur(); enviarCampo(); }
});
tg?.onEvent?.("viewportChanged", () => { if (campoAtivo) mostrarCampo(); });
window.visualViewport?.addEventListener("resize", () => { if (campoAtivo) mostrarCampo(); });

// ── Envio ────────────────────────────────────────────────────────────────────
function base64(buffer) {
  const bytes = new Uint8Array(buffer);
  let texto = "";
  for (let i = 0; i < bytes.length; i += 0x8000) texto += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(texto);
}

async function enviar(destino) {
  if (!figurinha || ocupado) return;
  $("#campo").blur(); // fecha o teclado
  ocupado = true;
  estado("carregando");
  try {
    const entrada = { ...destino, mime: figurinha.mime, data: base64(await figurinha.blob.arrayBuffer()) };
    const r = await chamar("addSticker", entrada);
    ultimoLink = r.link; // o botão "Abrir pacote" já confirma o resultado
    $("#destino-bar").hidden = true;
    $("#campo-bar").hidden = true;
    $("#abrir").hidden = false;
    tg?.HapticFeedback?.notificationOccurred?.("success");
    estado("pronto");
  } catch (erro) {
    estado("erro", mensagemDe(erro));
    if ($("#campo-bar").hidden) $("#destino").value = ""; // lista de volta ao início: dá para tentar de novo
    if (CODIGOS_DE_LISTA.has(erro?.parameters?.code)) {
      // a situação do pacote mudou no Telegram: mostra o motivo e recarrega a lista, que já vem atualizada
      $("#motivo").hidden = false;
      await prepararDestino().catch(() => {});
    }
    tg?.HapticFeedback?.notificationOccurred?.("error");
  } finally {
    ocupado = false;
  }
}

function aviso(texto) {
  estado("erro", texto);
  $("#motivo").hidden = false;
}

$("#abrir").addEventListener("click", () => {
  if (!ultimoLink) return;
  if (tg?.openTelegramLink) tg.openTelegramLink(ultimoLink);
  else window.open(ultimoLink, "_blank", "noopener");
});

estado("vazio");
