// Mini App: escolhe o arquivo, converte no aparelho e envia ao endpoint `addSticker`.
// Nada aqui fala com GitHub ou com servidor próprio: só com o serverless do bot.
import { converterImagem, converterVideo, ehVideo, podeGerarVideo, ErroDeConversao, FORMAS, caminhoSquirclePrevia } from "./convert.js";

const tg = window.Telegram?.WebApp;
const $ = (s) => document.querySelector(s);
const st = { carregando: $("#st-carregando"), pronto: $("#st-pronto"), erro: $("#st-erro") };
$("#clip-squircle-d").setAttribute("d", caminhoSquirclePrevia());
const NOVO = "novo";
const EXISTENTE = "existente";

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
  $("#nome-arquivo").value = arquivo ? (ehVideo(arquivo) ? "sticker animado" : "sticker estática") : "";
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
  estado("carregando");
  try {
    if (ehVideo(arquivo)) {
      dica("Convertendo vídeo… 0%");
      figurinha = await converterVideo(arquivo, forma, (p) => dica(`Convertendo vídeo… ${Math.min(99, Math.round(p * 100))}%`));
    } else {
      dica("Convertendo imagem…");
      figurinha = await converterImagem(arquivo, forma);
    }
    figurinha.url = URL.createObjectURL(figurinha.blob);
    figurinha.forma = forma;
    mostrarPrevia();
    await prepararDestino();
    dica("");
    estado("pronto");
  } catch (erro) {
    limparFigurinha();
    dica("");
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

// ── Destino: uma lista só (seus pacotes, novo pacote, pacote por link) ───────
let modoCampo = null; // NOVO | EXISTENTE enquanto o campo de texto está aberto

async function prepararDestino() {
  try {
    pacotes = await chamar("getPacks", {});
  } catch (e) {
    pacotes = [];
    if (e?.type === "UNAUTHORIZED") throw new ErroDeConversao("Abra este app pelo Telegram.");
  }
  const compativeis = pacotes.filter((p) => p.format === figurinha.tipo);
  const sel = $("#destino");
  sel.replaceChildren();
  const opcao = (valor, texto, extra = {}) =>
    sel.append(Object.assign(document.createElement("option"), { value: valor, textContent: texto }, extra));
  opcao("", "Adicionar ao pacote…", { disabled: true, hidden: true });
  for (const p of compativeis) opcao(String(p.id), p.title);
  opcao(NOVO, "+ Novo pacote…");
  opcao(EXISTENTE, "Pacote existente por link…");
  reiniciarDestino();
  $("#destino-bar").hidden = false;
}

function reiniciarDestino() {
  $("#destino").value = "";
  modoCampo = null;
  $("#campo-bar").hidden = true;
  $("#campo").value = "";
}

function abrirCampo(modo) {
  modoCampo = modo;
  const campo = $("#campo");
  campo.value = "";
  campo.placeholder = modo === NOVO ? "Nome do novo pacote" : "Link ou nome do pacote";
  campo.inputMode = modo === EXISTENTE ? "url" : "text";
  $("#campo-bar").hidden = false;
  campo.focus();
}

// Escolher um pacote da lista já adiciona a figurinha; "novo" e "por link" pedem um texto antes.
$("#destino").addEventListener("change", () => {
  const v = $("#destino").value;
  if (v === NOVO || v === EXISTENTE) return abrirCampo(v);
  $("#campo-bar").hidden = true;
  modoCampo = null;
  if (v) enviar({ packId: Number(v) });
});

function enviarCampo() {
  const texto = $("#campo").value.trim();
  if (modoCampo === NOVO) return texto ? enviar({ title: texto }) : aviso("Dê um nome ao pacote.");
  if (modoCampo === EXISTENTE) return texto ? enviar({ packRef: texto }) : aviso("Cole o link ou o nome do pacote.");
}
$("#enviar").addEventListener("click", enviarCampo);

// ── Teclado: enquanto digita, só o campo e o botão ficam visíveis ─────────────
const raiz = document.documentElement;
let saiuDoCampo = 0;
const mostrarCampo = () => $("#campo").scrollIntoView({ block: "center", behavior: "smooth" });
$("#campo").addEventListener("focus", () => {
  clearTimeout(saiuDoCampo);
  raiz.classList.add("editando");
  mostrarCampo();
});
$("#campo").addEventListener("blur", () => {
  // atraso: tocar no botão de envio tira o foco antes do clique; o layout só volta depois dele
  saiuDoCampo = setTimeout(() => raiz.classList.remove("editando"), 300);
});
$("#campo").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); $("#campo").blur(); enviarCampo(); }
});
// o teclado muda a altura visível: recentraliza o campo
tg?.onEvent?.("viewportChanged", () => { if (raiz.classList.contains("editando")) mostrarCampo(); });
window.visualViewport?.addEventListener("resize", () => { if (raiz.classList.contains("editando")) mostrarCampo(); });

// ── Envio ────────────────────────────────────────────────────────────────────
function base64(buffer) {
  const bytes = new Uint8Array(buffer);
  let texto = "";
  for (let i = 0; i < bytes.length; i += 0x8000) texto += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(texto);
}

// Sai do modo de digitação na hora (o blur nem sempre dispara quando o campo some ou o teclado fecha).
function sairDaEdicao() {
  clearTimeout(saiuDoCampo);
  $("#campo").blur();
  raiz.classList.remove("editando");
}

async function enviar(destino) {
  if (!figurinha || ocupado) return;
  sairDaEdicao();
  ocupado = true;
  estado("carregando");
  dica("Enviando…");
  try {
    const entrada = { ...destino, mime: figurinha.mime, data: base64(await figurinha.blob.arrayBuffer()) };
    const r = await chamar("addSticker", entrada);
    ultimoLink = r.link;
    dica(""); // o botão "Abrir pacote" já confirma
    $("#destino-bar").hidden = true;
    $("#campo-bar").hidden = true;
    $("#abrir").hidden = false;
    tg?.HapticFeedback?.notificationOccurred?.("success");
    estado("pronto");
  } catch (erro) {
    dica("");
    estado("erro", mensagemDe(erro));
    $("#destino").value = modoCampo || ""; // volta a lista para o início: dá para tentar de novo
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
