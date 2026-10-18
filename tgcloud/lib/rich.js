// Auxiliares da mensagem rica (Bot API 10.3, campo `html`): só `<`, `>`, `&` e `"` precisam de escape.
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Título do aviso enviado ao chat depois de criar um pacote ou adicionar uma figurinha a ele (mensagem rica).
export const tituloDoAviso = ({ created }) => `<h1>${created ? 'Pacote criado' : 'Pacote atualizado'}:</h1>`;

// Linha do hiperlink, em mensagem de texto comum (parse_mode HTML: `<a href>`; só `<`, `>`, `&` e `"` pedem escape).
export const linkDoPacote = ({ title, link }) => `<a href="${esc(link)}">${esc(title)}</a>`;

// Opções de prévia do link (LinkPreviewOptions): a prévia do próprio pacote, em tamanho grande.
export const previaDoPacote = (link) => ({ url: link, prefer_large_media: true });
