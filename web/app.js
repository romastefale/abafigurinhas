// Mini App: escolhe o arquivo, converte no aparelho e envia ao endpoint `addSticker`.
// Nada aqui fala com GitHub ou com servidor próprio: só com o serverless do bot.
import { converterImagem, converterVideo, ehVideo, podeGerarVideo, ErroDeConversao, MAX_VIDEO } from "./convert.js";

const tg = window.Telegram?.WebApp;
const $ = (s) => document.querySelector(s);
const st = { carregando: $("#st-carregando"), pronto: $("#st-pronto"), erro: $("#st-erro") };
const NOVO = "novo";
const EXISTENTE = "existente";

let arquivo = null;
let figurinha = null; // { blob, mime, tipo, url }
let pacotes = [];
let ocupado = false;
let ultimoLink = "";

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
  for (const id of ["#destino-bar", "#campo-bar", "#adicionar", "#abrir"]) $(id).hidden = true;
  ultimoLink = "";
}

// ── Conversão ─────────────────────────────────────────────────────────────────
$("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!arquivo || ocupado) return;
  ocupado = true;
  limparFigurinha();
  estado("carregando");
  try {
    if (ehVideo(arquivo)) {
      dica("Convertendo vídeo… 0%");
      figurinha = await converterVideo(arquivo, (p) => dica(`Convertendo vídeo… ${Math.min(99, Math.round(p * 100))}%`));
    } else {
      dica("Convertendo imagem…");
      figurinha = await converterImagem(arquivo);
    }
    figurinha.url = URL.createObjectURL(figurinha.blob);
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
});
st.erro.addEventListener("click", () => ($("#motivo").hidden = !$("#motivo").hidden));

function mostrarPrevia() {
  const moldura = $("#moldura");
  moldura.style.setProperty("--ratio", "1");
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

// ── Destino: pacote existente, novo ou por link ──────────────────────────────
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
  const opcao = (valor, texto) => sel.append(Object.assign(document.createElement("option"), { value: valor, textContent: texto }));
  for (const p of compativeis) opcao(String(p.id), p.title);
  opcao(NOVO, "Novo pacote…");
  opcao(EXISTENTE, "Pacote existente por link…");
  sel.value = compativeis.length ? String(compativeis[0].id) : NOVO;
  atualizarCampo();
  $("#destino-bar").hidden = false;
  $("#adicionar").hidden = false;
}

function atualizarCampo() {
  const v = $("#destino").value;
  const campo = $("#campo");
  const mostrar = v === NOVO || v === EXISTENTE;
  $("#campo-bar").hidden = !mostrar;
  campo.value = "";
  campo.placeholder = v === NOVO ? "Nome do novo pacote" : "Link ou nome do pacote";
  campo.inputMode = v === EXISTENTE ? "url" : "text";
}
$("#destino").addEventListener("change", atualizarCampo);

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
  // atraso: tocar em "Adicionar" tira o foco antes do clique; o layout só volta depois dele
  saiuDoCampo = setTimeout(() => raiz.classList.remove("editando"), 300);
});
$("#campo").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); $("#campo").blur(); $("#adicionar").click(); }
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

$("#adicionar").addEventListener("click", async () => {
  if (!figurinha || ocupado) return;
  const destino = $("#destino").value;
  const texto = $("#campo").value.trim();
  const entrada = { mime: figurinha.mime };
  if (destino === NOVO) {
    if (!texto) return aviso("Dê um nome ao pacote.");
    entrada.title = texto;
  } else if (destino === EXISTENTE) {
    if (!texto) return aviso("Cole o link ou o nome do pacote.");
    entrada.packRef = texto;
  } else {
    entrada.packId = Number(destino);
  }
  ocupado = true;
  $("#adicionar").disabled = true;
  estado("carregando");
  dica("Enviando…");
  try {
    entrada.data = base64(await figurinha.blob.arrayBuffer());
    const r = await chamar("addSticker", entrada);
    ultimoLink = r.link;
    dica(r.created ? `Pacote “${r.title}” criado.` : `Adicionada a “${r.title}”.`);
    $("#abrir").hidden = false;
    tg?.HapticFeedback?.notificationOccurred?.("success");
    estado("pronto");
  } catch (erro) {
    dica("");
    estado("erro", mensagemDe(erro));
    tg?.HapticFeedback?.notificationOccurred?.("error");
  } finally {
    ocupado = false;
    $("#adicionar").disabled = false;
  }
});

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
